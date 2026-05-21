// ═══════════════════════════════════════════════════════════════
// VAVILOV OS — app.js  (versão corrigida)
// Correções aplicadas:
//   1. Aninhamento automático por disciplina no Grid (agrupa e ordena)
//   2. Novas disciplinas aparecem imediatamente no Backlog do Timeblock
//   3. Marcar "Estudo" no Grid propaga estado visual ao evento do Calendário
// ═══════════════════════════════════════════════════════════════

// ── Alternância de Abas ─────────────────────────────────────────


// ═══════════════════════════════════════════════════════════════
// VAVILOV OS — app.js  (versão corrigida)
// Correções aplicadas:
//   1. Aninhamento automático por disciplina no Grid (agrupa e ordena)
//   2. Novas disciplinas aparecem imediatamente no Backlog do Timeblock
//   3. Marcar "Estudo" no Grid propaga estado visual ao evento do Calendário
// ═══════════════════════════════════════════════════════════════

// ── Alternância de Abas ─────────────────────────────────────────
window.switchView = function(viewName, e) {
    const currentEvent = e || window.event;
    document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) targetView.classList.add('active');

    if (currentEvent && currentEvent.target) {
        currentEvent.target.classList.add('active');
    }

    if (viewName === 'calendar' && window.calendarInstance) {
        window.calendarInstance.render();
        // CORREÇÃO: Usando a referência global e validando se ela já existe
        if (window.syncCalendarBacklog) window.syncCalendarBacklog();
    }
    if (viewName === 'analytics') {
        if (typeof window.renderHeatmap === 'function') window.renderHeatmap();
        if (typeof window.renderRastro  === 'function') window.renderRastro();
        if (typeof window.renderRevisoesInteligentes === 'function') window.renderRevisoesInteligentes(); // NOVA LINHA
    }
};

document.addEventListener('DOMContentLoaded', () => {
    let localData = [];
    let filtroDisciplina = "";
    window.calendarInstance = null;
    let draggableInstance = null;

    const toast = document.getElementById('toast');
    let toastTimeout;

    // ── Toast ────────────────────────────────────────────────────
    function showToast(msg, isError = false) {
        if (!toast) return;
        clearTimeout(toastTimeout);
        toast.innerText = msg;
        toast.style.borderColor = isError ? 'var(--danger)' : 'var(--brd)';
        toast.style.opacity = 1;
        toastTimeout = setTimeout(() => toast.style.opacity = 0, 2500);
    }

    // ── Filtro ───────────────────────────────────────────────────
    window.filtrarPorDisciplina = function(disc) {
        filtroDisciplina = disc;
        renderGrid();
        syncCalendar();          // propaga filtro ao timeblock imediatamente
    };

    // ── Adição Manual ────────────────────────────────────────────
    window.adicionarTopicoManual = async function() {
        const disciplina = document.getElementById('manDisciplina').value.trim();
        const topico     = document.getElementById('manTopico').value.trim();
        const peso       = document.getElementById('manPeso').value;

        if (!disciplina || !topico) {
            showToast("Preencha a Disciplina e o Tópico para continuar!", true);
            return;
        }

        // Herda a cor da disciplina já existente (se houver)
        const discExistente = localData.find(
            t => t.disciplina.toLowerCase().trim() === disciplina.toLowerCase().trim()
        );
        const corHex = discExistente ? discExistente.cor_hex : "#58a6ff";

        const payload = {
            semana: "Caixa de Entrada",
            disciplina,
            topico,
            peso: parseInt(peso) || 1,
            prioridade: "Normal",
            cor_hex: corHex
        };

        try {
            const res = await fetch('/api/topics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                showToast("Tópico inserido com sucesso!");
                document.getElementById('manTopico').value = "";
                await loadData();
            } else {
                showToast("Erro do servidor ao gravar dados manuais", true);
            }
        } catch (err) {
            showToast("Falha de rede ao registrar tópico", true);
        }
    };

    // ── Salvar Inline (checkbox / texto) ─────────────────────────
    // FIX 3: após gravar "concluido", propaga estado ao evento do calendário
    window.salvarInline = async function(id, field, element) {
        let value = element.type === 'checkbox' ? element.checked : (element.tagName === 'SELECT' ? element.value : element.innerText.trim());
        if (element.type === 'checkbox') value = value ? 1 : 0;

        try {
            const res = await fetch(`/api/topics/${id}/inline`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ field, value })
            });
            if (res.ok) {
                showToast("Alteração gravada!");
                const idx = localData.findIndex(t => t.id === id);
                if (idx !== -1) localData[idx][field] = value;
                recalcularProgresso();

                // Sincroniza calendário (syncCalendar já recria eventos com estilos corretos)
                // FIX B8: removida chamada redundante a atualizarEstiloEventoCalendario
                if (window.calendarInstance) {
                    syncCalendar();
                }
            }
        } catch (e) {
            showToast("Erro ao processar salvamento automático", true);
        }
    };

    // FIX 3: altera aparência do evento no calendário (riscado = concluído)
    function atualizarEstiloEventoCalendario(id, concluido) {
        if (!window.calendarInstance) return;
        const event = window.calendarInstance.getEventById(id.toString());
        if (!event) return;
        if (concluido) {
            event.setProp('backgroundColor', '#238636');
            event.setProp('title', '✅ ' + event.title.replace(/^✅ /, ''));
        } else {
            const item = localData.find(t => t.id === id);
            event.setProp('backgroundColor', item ? (item.cor_hex || '#58a6ff') : '#58a6ff');
            event.setProp('title', event.title.replace(/^✅ /, ''));
        }
    }

    // ── Deletar item (com filhos — FIX B5 frontend) ─────────────
    window.deletarItem = async function(id) {
        const item = localData.find(t => t.id === id);
        const temFilhos = localData.some(t => t.parent_id === id);
        const msg = temFilhos
            ? `⚠️ Este tópico tem subtópicos. Deletar "${item?.topico}" removerá também todos os filhos. Confirmar?`
            : `Confirmar envio de "${item?.topico}" para a lixeira?`;
        if (!confirm(msg)) return;
        try {
            const res = await fetch(`/api/topics/${id}`, { method: 'DELETE' });
            if (res.ok) {
                // Remove do localData o item E todos os seus descendentes
                function coletarIds(pid) {
                    const ids = [pid];
                    localData.filter(t => t.parent_id === pid).forEach(f => ids.push(...coletarIds(f.id)));
                    return ids;
                }
                const idsRemover = coletarIds(id);
                localData = localData.filter(t => !idsRemover.includes(t.id));
                showToast(temFilhos ? `Item e ${idsRemover.length - 1} filho(s) removidos.` : "Item removido.");
                renderGrid();
                populateFilters();
                syncCalendar();
                syncCalendarBacklog();
            }
        } catch (e) {
            showToast("Erro ao processar deleção", true);
        }
    };

    // ── Limpar Tudo ──────────────────────────────────────────────
    window.excluirTudoGlobal = async function() {
        if (!confirm("⚠️ ALERTA MÁXIMO: Mover todo o planejamento ativo para a lixeira?")) return;
        try {
            const res = await fetch('/api/topics/hierarchy/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tipo: 'tudo' })
            });
            if (res.ok) {
                showToast("Limpeza global concluída.");
                localData = [];
                renderGrid();
                populateFilters();
                syncCalendar();
                syncCalendarBacklog();
            }
        } catch (e) {
            showToast("Erro na limpeza em massa", true);
        }
    };

    // ── Carga de dados ───────────────────────────────────────────
    async function loadData() {
        try {
            const res = await fetch('/api/topics');
            localData = await res.json();
            renderGrid();
            populateFilters();
            initCalendar();
        } catch (e) {
            showToast("Falha na sincronização inicial de dados", true);
        }
    }

    // ── Filtros do Select ────────────────────────────────────────
    function populateFilters() {
        const select = document.getElementById('filtoDisciplinaHead');
        if (!select) return;
        const disciplinas = [...new Set(localData.map(t => t.disciplina))].sort();
        select.innerHTML = '<option value="">Todas as Disciplinas</option>';
        disciplinas.forEach(d => {
            select.innerHTML += `<option value="${d}" ${filtroDisciplina === d ? 'selected' : ''}>${d}</option>`;
        });
    }

    // ── Barra de progresso ───────────────────────────────────────
    function recalcularProgresso() {
        const fill = document.getElementById('progressBarFill');
        const text = document.getElementById('progressBarPercent');
        if (!fill || !text) return;
        if (localData.length === 0) { fill.style.width = '0%'; text.innerText = '0%'; return; }
        const totais    = localData.length;
        const concluidos = localData.filter(t => t.concluido === 1 || t.concluido === true).length;
        const porc = Math.round((concluidos / totais) * 100);
        fill.style.width = `${porc}%`;
        text.innerText   = `${porc}%`;
    }

    // ══════════════════════════════════════════════════════════════
    // renderGrid — Aninhamento automático por disciplina + filhos recursivos
    // Estrutura: Disciplina (cabeçalho) > Tópicos raiz > Filhos > Netos ...
    // ══════════════════════════════════════════════════════════════
    function renderGrid() {
        const body = document.getElementById('gridBody');
        if (!body) return;
        body.innerHTML = '';

        const dadosFiltrados = filtroDisciplina
            ? localData.filter(t => t.disciplina === filtroDisciplina)
            : localData;

        recalcularProgresso();

        // Mapa id→item para lookup rápido
        const idMap = {};
        localData.forEach(t => { idMap[t.id] = t; });

        // Agrupa apenas os itens RAIZ (sem parent) por disciplina
        const grupos = {};
        dadosFiltrados.filter(t => !t.parent_id).forEach(t => {
            if (!grupos[t.disciplina]) grupos[t.disciplina] = [];
            grupos[t.disciplina].push(t);
        });

        const disciplinasOrdenadas = Object.keys(grupos).sort((a, b) => a.localeCompare(b, 'pt-BR'));

        // Conta TODOS os descendentes de um item (recursivo)
        function contarDescendentes(id) {
            const filhos = dadosFiltrados.filter(t => t.parent_id === id);
            let total = filhos.length;
            filhos.forEach(f => { total += contarDescendentes(f.id); });
            return total;
        }

        // Renderiza uma linha do grid com indentação proporcional ao nível
        function criarLinha(t, nivel) {
            const indent = nivel * 24; // px de indentação por nível
            const corBorda = t.cor_hex || '#58a6ff';
            const opacidade = t.concluido ? '0.65' : '1';
            const textoStyle = t.concluido ? 'text-decoration:line-through;color:#8b949e;' : '';

            const row = document.createElement('div');
            row.className = 'grid-row';
            row.setAttribute('data-id', t.id);
            row.style.borderLeft = `4px solid ${corBorda}`;
            row.style.opacity = opacidade;
            if (nivel > 0) {
                row.style.paddingLeft = `${indent}px`;
                row.style.background = nivel % 2 === 1 ? '#0d1117' : '#11151c';
            }

            // Seta indicando nível hierárquico
            const nivelIcon = nivel === 0 ? '↳' : '⤷'.repeat(nivel);

            row.innerHTML = `
                <div class="grid-cell drag-handle" style="cursor:grab;padding-left:${indent}px;">⠿</div>
                <div class="grid-cell" style="color:#8b949e;font-size:11px;padding-left:4px;">${nivelIcon}</div>
                <div class="grid-cell editable" contenteditable="true"
                     onblur="salvarInline(${t.id}, 'topico', this)"
                     style="${textoStyle}">${t.topico}</div>
                <div class="grid-cell" style="padding: 0;">
                    <select onchange="salvarInline(${t.id}, 'peso', this)" style="background: transparent; color: #fff; border: 1px solid transparent; cursor: pointer; font-size: 13px; width: 100%; height: 100%; outline: none; appearance: none; text-align: center;">
                        <option value="1" style="background: #0d1117;" ${t.peso == 1 ? 'selected' : ''}>Baixo (1)</option>
                        <option value="3" style="background: #0d1117;" ${t.peso == 3 ? 'selected' : ''}>Médio (3)</option>
                        <option value="5" style="background: #0d1117;" ${t.peso == 5 ? 'selected' : ''}>Alto (5)</option>
                    </select>
                </div>
                     
                <div class="grid-cell center-cell">
                    <input type="checkbox" ${t.concluido ? 'checked' : ''} onchange="toggleRevisao(${t.id}, 'concluido', this)">
                </div>
                <div class="grid-cell center-cell"><input type="checkbox" ${t.rev1 ? 'checked' : ''} onchange="toggleRevisao(${t.id}, 'rev1', this)"></div>
                <div class="grid-cell center-cell"><input type="checkbox" ${t.rev2 ? 'checked' : ''} onchange="toggleRevisao(${t.id}, 'rev2', this)"></div>
                <div class="grid-cell center-cell"><input type="checkbox" ${t.rev3 ? 'checked' : ''} onchange="toggleRevisao(${t.id}, 'rev3', this)"></div>
                <div class="grid-cell center-cell" style="gap:4px;display:flex;">
                    <button class="btn-del" title="Adicionar subtópico filho" 
                            onclick="adicionarFilho(${t.id})"
                            style="color:#58a6ff;font-size:14px;">+</button>
                    <button class="btn-del" onclick="deletarItem(${t.id})">🗑️</button>
                </div>
            `;
            return row;
        }

        // Renderiza item + todos os seus filhos recursivamente numa lista
        function renderItemRecursivo(container, t, nivel) {
            container.appendChild(criarLinha(t, nivel));
            // Filhos diretos deste item, ordenados por id
            const filhos = dadosFiltrados
                .filter(f => f.parent_id === t.id)
                .sort((a, b) => a.id - b.id);
            filhos.forEach(filho => renderItemRecursivo(container, filho, nivel + 1));
        }

        disciplinasOrdenadas.forEach(disciplina => {
            const itensRaiz = grupos[disciplina];

            // Conta tudo incluindo descendentes para o cabeçalho
            const todosNaDisc = dadosFiltrados.filter(t => t.disciplina === disciplina);
            const totalDisc      = todosNaDisc.length;
            const concluidosDisc = todosNaDisc.filter(t => t.concluido === 1 || t.concluido === true).length;
            const percDisc       = totalDisc ? Math.round((concluidosDisc / totalDisc) * 100) : 0;

            const grupoEl = document.createElement('div');
            grupoEl.className = 'semana-group';
            grupoEl.setAttribute('data-disciplina', disciplina);

            const header = document.createElement('div');
            header.className = 'semana-title';
            header.style.cursor = 'pointer';
            header.innerHTML = `
                <span>
                    <span class="disc-toggle" style="font-size:10px;margin-right:6px;color:#8b949e;">▼</span>
                    <span style="border-left:4px solid ${itensRaiz[0].cor_hex || '#58a6ff'};padding-left:8px;">${disciplina}</span>
                </span>
                <span style="font-size:12px;color:#8b949e;">${concluidosDisc}/${totalDisc} • ${percDisc}%</span>
            `;

            const listEl = document.createElement('div');
            listEl.className = 'sortable-list';
            listEl.setAttribute('data-disc', disciplina);

            header.addEventListener('click', () => {
                const collapsed = listEl.style.display === 'none';
                listEl.style.display = collapsed ? '' : 'none';
                header.querySelector('.disc-toggle').textContent = collapsed ? '▼' : '▶';
            });

            grupoEl.appendChild(header);
            grupoEl.appendChild(listEl);
            body.appendChild(grupoEl);

            // Renderiza cada item raiz com seus filhos recursivos
            itensRaiz.forEach(t => renderItemRecursivo(listEl, t, 0));

            // Sortable apenas nos itens raiz (arrastar entre raízes)
            if (typeof Sortable !== 'undefined') {
                Sortable.create(listEl, {
                    handle: '.drag-handle',
                    animation: 150,
                    ghostClass: 'ghost',
                    onEnd: async function(evt) {
                        const movedId  = evt.item.getAttribute('data-id');
                        const novaOrdem = evt.newIndex;
                        await fetch('/api/topics/reorder', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: movedId, novaSemana: disciplina, novaOrdem })
                        });
                    }
                });
            }
        });
    }

    // ── Adicionar filho — modal inline no grid (FIX B10: sem prompt() nativo) ──
    window.adicionarFilho = function(parentId) {
        // Remove qualquer modal anterior
        const existing = document.getElementById('modal-filho');
        if (existing) existing.remove();

        const item = localData.find(t => t.id === parentId);
        const label = item ? item.topico : `#${parentId}`;

        const modal = document.createElement('div');
        modal.id = 'modal-filho';
        modal.style.cssText = `
            position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
            background:var(--surf); border:1px solid var(--acc); border-radius:10px;
            padding:24px 28px; z-index:10000; min-width:380px; box-shadow:0 8px 32px rgba(0,0,0,0.6);
        `;
        modal.innerHTML = `
            <div style="font-size:13px;color:#8b949e;margin-bottom:6px;">Adicionar subtópico em:</div>
            <div style="font-size:14px;color:var(--acc);font-weight:bold;margin-bottom:16px;border-left:3px solid var(--acc);padding-left:8px;">${label}</div>
            <input id="modal-filho-input" type="text" placeholder="Nome do subtópico..."
                style="width:100%;background:#0d1117;color:#fff;border:1px solid var(--brd);
                       padding:10px;border-radius:5px;font-size:13px;box-sizing:border-box;margin-bottom:14px;">
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button onclick="document.getElementById('modal-filho').remove()"
                    style="background:transparent;color:#8b949e;border:1px solid var(--brd);
                           padding:8px 16px;border-radius:5px;cursor:pointer;">Cancelar</button>
                <button id="modal-filho-btn"
                    style="background:var(--acc);color:#000;font-weight:bold;border:none;
                           padding:8px 16px;border-radius:5px;cursor:pointer;">Criar Filho</button>
            </div>
        `;
        document.body.appendChild(modal);

        const input = document.getElementById('modal-filho-input');
        input.focus();

        async function confirmar() {
            const topico = input.value.trim();
            if (!topico) { input.style.borderColor = 'var(--danger)'; return; }
            modal.remove();
            try {
                const res = await fetch(`/api/topics/${parentId}/child`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topico })
                });
                if (res.ok) { showToast("Subtópico filho criado!"); await loadData(); }
                else showToast("Erro ao criar subtópico", true);
            } catch(e) { showToast("Falha de rede ao criar filho", true); }
        }

        document.getElementById('modal-filho-btn').addEventListener('click', confirmar);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') confirmar(); if (e.key === 'Escape') modal.remove(); });
    };

    // ── Analytics: Heatmap ───────────────────────────────────────
    window.renderHeatmap = async function() {
        const container = document.getElementById('heatmapContainer');
        if (!container) return;
        container.innerHTML = 'Buscando métricas...';
        try {
            const res  = await fetch('/api/analytics/heatmap');
            const data = await res.json();
            container.innerHTML = '';
            if (data.length === 0) {
                container.innerHTML = '<p style="font-size:11px;color:#8b949e;">Sem sessões registradas.</p>';
                return;
            }
            data.forEach(d => {
                const block = document.createElement('div');
                block.style.cssText = 'width:30px;height:30px;border-radius:4px;';
                const alpha = Math.min(d.count * 0.25, 1);
                block.style.backgroundColor = `rgba(35,134,54,${alpha})`;
                block.title = `${d.date}: ${d.count} execução(ões)`;
                container.appendChild(block);
            });
        } catch (e) { container.innerHTML = 'Erro ao processar mapa.'; }
    };

    // ── Analytics: Rastro ────────────────────────────────────────
    window.renderRastro = async function() {
        const timeline = document.getElementById('rastroTimeline');
        if (!timeline) return;
        timeline.innerHTML = 'Buscando logs...';
        try {
            const res  = await fetch('/api/analytics/rastro');
            const data = await res.json();
            timeline.innerHTML = '';
            if (data.length === 0) {
                timeline.innerHTML = '<p style="font-size:11px;color:#8b949e;">Linha do tempo vazia.</p>';
                return;
            }
            data.forEach(s => {
                const item = document.createElement('div');
                item.style.cssText = 'background:#21262d;padding:8px;border-radius:4px;font-size:12px;';
                item.innerHTML = `⏱️ <b>${s.data_inicio}</b> — Ação [<b>${s.tipo_evento}</b>] em <span style="color:var(--acc)">${s.disciplina}</span>: <i>${s.topico}</i>`;
                timeline.appendChild(item);
            });
        } catch (e) { timeline.innerHTML = 'Erro ao ler rastro.'; }
    };

    // ══════════════════════════════════════════════════════════════
    // FIX 2 — syncCalendarBacklog separado e chamado sempre que
    // localData muda (loadData, deletar, limpar tudo, trocar de aba)
    // ══════════════════════════════════════════════════════════════
    function syncCalendarBacklog() {
        const backlogEl = document.getElementById('calendar-backlog');
        if (!backlogEl) return;

        backlogEl.innerHTML = '';

        // Itens sem agendamento vão para o backlog (respeitando filtro de disciplina)
        const dadosBacklog = filtroDisciplina
            ? localData.filter(t => !t.data_agendada && t.disciplina === filtroDisciplina)
            : localData.filter(t => !t.data_agendada);
        dadosBacklog.forEach(t => {
            const item = document.createElement('div');
            item.className = 'fc-event-item';
            item.style.borderLeftColor = t.cor_hex || '#58a6ff';
            item.innerHTML = `<span style="font-size:10px;color:#8b949e;">${t.disciplina}</span><br>${t.topico}`;
            item.setAttribute('data-id', t.id);
            const paiBack = t.parent_id ? localData.find(p => p.id === t.parent_id) : null;
            item.setAttribute('data-title', paiBack
                ? `[${t.disciplina}] ${paiBack.topico} › ${t.topico}`
                : `[${t.disciplina}] ${t.topico}`);
            backlogEl.appendChild(item);
        });

        // Recria o Draggable do FullCalendar para os novos elementos
        if (typeof FullCalendar !== 'undefined' && FullCalendar.Draggable) {
            if (draggableInstance) draggableInstance.destroy();
            draggableInstance = new FullCalendar.Draggable(backlogEl, {
                itemSelector: '.fc-event-item',
                eventData: function(eventEl) {
                    return {
                        id: eventEl.getAttribute('data-id'),
                        title: eventEl.getAttribute('data-title'),
                        backgroundColor: '#58a6ff',
                        borderColor: 'transparent',
                        duration: { hours: 1 }
                    };
                }
            });
        }
    }
    
    // CORREÇÃO: Expondo a função para o escopo global para o switchView conseguir encontrá-la
    window.syncCalendarBacklog = syncCalendarBacklog; 

    // ══════════════════════════════════════════════════════════════
    // initCalendar — inicializa o FullCalendar e chama syncCalendarBacklog
    // ══════════════════════════════════════════════════════════════
    function initCalendar() {
        const el = document.getElementById('calendar');
        if (!el) return;

        // FIX 2: sempre atualiza o backlog ao (re)carregar dados
        syncCalendarBacklog();

        // Monta lista de eventos agendados com indicador de concluído (FIX 3)
        const eventos = localData.filter(t => t.data_agendada).map(t => ({
            id: t.id.toString(),
            title: (t.concluido ? '✅ ' : '') + (() => {
                const pai = t.parent_id ? localData.find(p => p.id === t.parent_id) : null;
                return pai
                    ? `[${t.disciplina}] ${pai.topico} › ${t.topico}`
                    : `[${t.disciplina}] ${t.topico}`;
            })(),
            start: `${t.data_agendada}T${t.horario_inicio || '08:00'}:00`,
            duration: { minutes: t.duracao_minutos || 60 },
            backgroundColor: t.concluido ? '#238636' : (t.cor_hex || '#58a6ff'),
            borderColor: 'transparent'
        }));

        if (typeof FullCalendar === 'undefined') return;

        if (!window.calendarInstance) {
            window.calendarInstance = new FullCalendar.Calendar(el, {
                initialView: 'timeGridWeek',
                headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth' },
                views: {
                    listMonth:    { buttonText: '☰ Lista'  },
                    dayGridMonth: { buttonText: 'Mês'      },
                    timeGridWeek: { buttonText: 'Semana'   },
                    timeGridDay:  { buttonText: 'Dia'      }
                },
                locale: 'pt-br',
                editable: true,
                droppable: true,
                events: eventos,

                // Arrasto dentro do calendário (reposicionar)
                eventDrop: async function(info) {
                    const id = info.event.id;
                    const dateObj = info.event.start;
                    const data_agendada  = dateObj.toISOString().split('T')[0];
                    const horario_inicio = dateObj.toTimeString().split(' ')[0].substring(0, 5);
                    await fetch(`/api/topics/${id}/schedule`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ data_agendada, horario_inicio, duracao_minutos: 60, semana: 'Sincronizado' })
                    });
                    showToast("Agendamento modificado!");
                },

                // Drop do backlog para o calendário
                eventReceive: async function(info) {
                    const id = info.event.id;
                    const dateObj = info.event.start;
                    const data_agendada  = dateObj.toISOString().split('T')[0];
                    const horario_inicio = dateObj.toTimeString().split(' ')[0].substring(0, 5);
                    try {
                        const res = await fetch(`/api/topics/${id}/schedule`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ data_agendada, horario_inicio, duracao_minutos: 60, semana: 'Sincronizado' })
                        });
                        if (res.ok) {
                            showToast("Item integrado ao Calendário!");
                            await loadData();
                        }
                    } catch (err) {
                        showToast("Falha na sincronização do timeblock", true);
                    }
                },

                // Clique num evento do calendário abre confirmação de estudo (FIX 3)
                eventClick: function(info) {
                    const id = parseInt(info.event.id);
                    const item = localData.find(t => t.id === id);
                    if (!item) return;
                    const novoConcluido = item.concluido ? 0 : 1;
                    const label = novoConcluido ? 'Marcar como estudado hoje?' : 'Desmarcar como estudado?';
                    if (confirm(`${info.event.title}\n\n${label}`)) {
                        // Simula o mesmo fluxo do checkbox do grid
                        fetch(`/api/topics/${id}/inline`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ field: 'concluido', value: novoConcluido })
                        }).then(res => {
                            if (res.ok) {
                                const idx = localData.findIndex(t => t.id === id);
                                if (idx !== -1) localData[idx].concluido = novoConcluido;
                                recalcularProgresso();
                                atualizarEstiloEventoCalendario(id, novoConcluido);
                                renderGrid();
                                showToast(novoConcluido ? "Sessão marcada como estudada! ✅" : "Sessão desmarcada.");
                            }
                        });
                    }
                }
            });
            window.calendarInstance.render();
        } else {
            syncCalendar();
        }
    }

    // ── syncCalendar: atualiza eventos sem recriar o calendário ──
    function syncCalendar() {
        if (!window.calendarInstance) return;
        window.calendarInstance.removeAllEvents();

        // Respeita o filtro de disciplina ativo
        const dadosFiltrados = filtroDisciplina
            ? localData.filter(t => t.data_agendada && t.disciplina === filtroDisciplina)
            : localData.filter(t => t.data_agendada);

        const eventos = dadosFiltrados.map(t => ({
            id: t.id.toString(),
            title: (t.concluido ? '✅ ' : '') + (() => {
                const pai = t.parent_id ? localData.find(p => p.id === t.parent_id) : null;
                return pai
                    ? `[${t.disciplina}] ${pai.topico} › ${t.topico}`
                    : `[${t.disciplina}] ${t.topico}`;
            })(),
            start: `${t.data_agendada}T${t.horario_inicio || '08:00'}:00`,
            duration: { minutes: t.duracao_minutos || 60 },
            backgroundColor: t.concluido ? '#238636' : (t.cor_hex || '#58a6ff'),
            borderColor: 'transparent'
        }));
        window.calendarInstance.addEventSource(eventos);

        // FIX 2: sempre re-sincroniza o backlog junto
        syncCalendarBacklog();
    }

    // FIX 3: helper para propagar estilo ao evento do calendário
    function atualizarEstiloEventoCalendario(id, concluido) {
        if (!window.calendarInstance) return;
        const event = window.calendarInstance.getEventById(id.toString());
        if (!event) return;
        const item = localData.find(t => t.id === id);
        if (concluido) {
            event.setProp('backgroundColor', '#238636');
            event.setProp('title', '✅ ' + event.title.replace(/^✅ /, ''));
        } else {
            event.setProp('backgroundColor', item ? (item.cor_hex || '#58a6ff') : '#58a6ff');
            event.setProp('title', event.title.replace(/^✅ /, ''));
        }
    }

    // ── Upload de Edital PDF ─────────────────────────────────────
const fileInput = document.getElementById('pdfFile');
if (fileInput) {
    fileInput.addEventListener('change', async function() {
        const file = this.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append("edital", file);
        showToast("Iniciando Ingestão Adaptativa...");
        try {
            const response = await fetch('/api/upload-edital', { method: 'POST', body: formData });
            if (response.ok) {
                showToast("Edital processado com sucesso!");
                
                // 🚀 O POP-UP DE ALERTA CIRÚRGICO E OBRIGATÓRIO
                alert("⚠️ ATENÇÃO OPERADOR:\n\nTodas as disciplinas extraídas deste edital foram cadastradas com o peso padrão MÍNIMO (Baixo Peso - 1).\n\nPara que o motor Iudex XII calcule suas revisões com precisão, você DEVE ajustar o peso de cada disciplina no Grid conforme a relevância real no certame.");
                
                // O carregamento do Grid só ocorre após o usuário dar o 'OK' no alerta
                await loadData();
            } else {
                showToast("Falha estrutural no processamento do arquivo", true);
            }
        } catch (e) {
            showToast("Erro crítico de comunicação", true);
        }
        this.value = '';
    });
}

    // ══════════════════════════════════════════════════════════════
    // VAVILOV IUDEX XII - Ações de Revisão e Painel Inteligente
    // ══════════════════════════════════════════════════════════════

    // ── Motor SM-2 Adaptado (Vavilov Iudex XII) ────────────────
    // FIX B7: escala corrigida — peso 1-5 mapeado para qualidade 0-5 (SM-2 nativo)
    // Tabela: peso 1→q=1, peso 2→q=2, peso 3→q=3, peso 4→q=4, peso 5→q=5
    // A condição 'pontos < 3' (q<3) dispara reset, tornando o motor útil para todos os pesos
    function calcularVavilovIudex(qualidade, intervaloAnterior, fatorFacilidade = 2.5, estagioAtual = 1) {
        // qualidade agora é diretamente o peso (1-5), sem multiplicação
        let novoIntervalo;
        let novoEstagio = estagioAtual;
        let novoFator = fatorFacilidade + (0.1 - (5 - qualidade) * (0.08 + (5 - qualidade) * 0.02));
        if (novoFator < 1.3) novoFator = 1.3;

        if (qualidade < 3) {
            // Abaixo de 3: reset — revisar amanhã, regredir estágio
            novoIntervalo = 1;
            novoEstagio = Math.max(1, estagioAtual - 1);
        } else {
            if (estagioAtual === 1) novoIntervalo = 1;
            else if (estagioAtual === 2) novoIntervalo = 3;
            else if (estagioAtual === 3) novoIntervalo = 7;
            else novoIntervalo = Math.round(intervaloAnterior * novoFator);
            novoEstagio = Math.min(12, estagioAtual + 1);
        }
        return {
            novoIntervalo: Math.min(365, novoIntervalo),
            novoFator: parseFloat(novoFator.toFixed(3)),
            novoEstagio: novoEstagio
        };
    }

    // ── Interceptador de cliques nas revisões e conclusão (Grid Excel) ──
    // FIX B2: se usuário cancela o confirm, reverte o checkbox visualmente sem salvar
    // FIX B3: ao marcar 'concluido', agenda o item no timeblock para HOJE automaticamente
    // FIX B11: data_execucao é atualizada no banco ao concluir
    window.toggleRevisao = async function(id, field, checkbox) {
        const isChecked = checkbox.checked;
        const item = localData.find(t => t.id === id);
        if (!item) return;

        // ── Caso 1: Marcando como CONCLUÍDO ─────────────────────────
        if (field === 'concluido' && isChecked) {
            const hoje = new Date().toISOString().split('T')[0];
            const hojeHora = new Date().toTimeString().split(' ')[0].substring(0, 5);

            // Atualiza estilo visual imediato
            checkbox.closest('.grid-row').style.opacity = '0.65';
            const editavel = checkbox.closest('.grid-row').querySelectorAll('[contenteditable]')[0];
            if (editavel) editavel.style.textDecoration = 'line-through';

            // Salva concluido no banco
            await salvarInline(id, 'concluido', checkbox);

            // FIX B3: agenda automaticamente no timeblock para HOJE
            // (só agenda se ainda não tinha data, para não sobrescrever planejamento futuro)
            if (!item.data_agendada) {
                await fetch(`/api/topics/${id}/schedule`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data_agendada: hoje,
                        horario_inicio: hojeHora,
                        duracao_minutos: item.duracao_minutos || 60,
                        semana: 'Estudado Hoje'
                    })
                });
                item.data_agendada = hoje;
                item.horario_inicio = hojeHora;
                syncCalendar();
                showToast(`✅ Concluído! Marcado no Timeblock de hoje.`);
            } else {
                showToast(`✅ Tópico marcado como concluído!`);
            }
            return;
        }

        // ── Caso 2: Desmarcando CONCLUÍDO ────────────────────────────
        if (field === 'concluido' && !isChecked) {
            checkbox.closest('.grid-row').style.opacity = '1';
            const editavel = checkbox.closest('.grid-row').querySelectorAll('[contenteditable]')[0];
            if (editavel) editavel.style.textDecoration = 'none';
            await salvarInline(id, 'concluido', checkbox);
            return;
        }

        // ── Caso 3: Clicando em REVISÃO (rev1/rev2/rev3) ─────────────
        if (isChecked && (field === 'rev1' || field === 'rev2' || field === 'rev3')) {
            const mapDias = { 'rev1': 1, 'rev2': 7, 'rev3': 30 };
            const diasTarget = mapDias[field];
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() + diasTarget);
            const novaDataStr = targetDate.toISOString().split('T')[0];

            const confirma = confirm(
                `Revisão de ${diasTarget} dia(s)

` +
                `Tópico: "${item.topico}"
` +
                `Data calculada: ${novaDataStr}

` +
                `Deseja agendar esta revisão no Timeblock?`
            );

            if (confirma) {
                await fetch(`/api/topics/${id}/schedule`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data_agendada: novaDataStr,
                        horario_inicio: item.horario_inicio || '08:00',
                        duracao_minutos: item.duracao_minutos || 60,
                        semana: 'Revisão Espaçada'
                    })
                });
                item.data_agendada = novaDataStr;
                syncCalendar();
                showToast(`🔁 Revisão agendada para ${novaDataStr}!`);
                // Salva o estado do checkbox após confirmar
                await salvarInline(id, field, checkbox);
            } else {
                // FIX B2: usuário cancelou — reverte o checkbox visualmente
                checkbox.checked = false;
                // NÃO chama salvarInline, estado permanece como estava
            }
            return;
        }

        // ── Caso 4: Desmarcando revisão — salva normalmente ──────────
        await salvarInline(id, field, checkbox);
    };

    // Montador do Novo Grid de Inteligência na aba Analytics
    window.renderRevisoesInteligentes = function() {
        const container = document.getElementById('iudexContainer');
        if (!container) return;

        // Pega apenas as disciplinas já marcadas como estudadas (concluído)
        let candidatos = localData.filter(t => t.concluido); // is_deleted já filtrado pela API

        if(candidatos.length === 0) {
            container.innerHTML = '<p style="font-size:11px;color:#8b949e;">Você precisa concluir estudos no Grid para a inteligência processar o espaçamento.</p>';
            return;
        }

        // Roda o motor Iudex em cada disciplina para prever o próximo passo
        candidatos = candidatos.map(t => {
            // Conversão matemática: o Peso do edital vira os "pontos" de qualidade (escala x2)
            let qualidade = (t.peso || 1); // FIX B7: escala direta 1-5
            let intervaloAtual = 1;
            let estagio = 1;

            if (t.rev3) { intervaloAtual = 30; estagio = 4; }
            else if (t.rev2) { intervaloAtual = 7; estagio = 3; }
            else if (t.rev1) { intervaloAtual = 1; estagio = 2; }

            const iudexData = calcularVavilovIudex(qualidade, intervaloAtual, 2.5, estagio);
            return { ...t, _iudex: iudexData };
        });

        // Ordenação Mestra: 1º Peso (maior para menor), 2º Menor intervalo (urgência)
        candidatos.sort((a, b) => {
            if (b.peso !== a.peso) return (b.peso || 1) - (a.peso || 1);
            return a._iudex.novoIntervalo - b._iudex.novoIntervalo;
        });

        // Monta a Tabela (idêntica ao estilo Excel do Grid principal)
        const urgentes = candidatos.filter(t => t._iudex.novoIntervalo <= 1);
        let html = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div>
                    <span style="font-size:13px;color:#fff;font-weight:bold;">${candidatos.length} tópico(s) para revisar</span>
                    ${urgentes.length > 0 ? `<span style="margin-left:10px;font-size:11px;color:var(--danger);">🔴 ${urgentes.length} urgente(s) hoje</span>` : ''}
                </div>
                ${urgentes.length > 0 ? `<button class="upload-btn" style="padding:6px 12px;font-size:11px;background:var(--danger);color:#fff;" onclick="agendarTodosUrgentes()">Agendar ${urgentes.length} Urgente(s)</button>` : ''}
            </div>
            <div class="grid-container" style="border: 1px solid var(--brd); border-radius: 8px; overflow: hidden;">
                <div class="grid-header" style="background: #11151c; display: flex; padding: 10px; font-weight: bold; font-size: 12px; color: #8b949e; border-bottom: 1px solid var(--brd);">
                    <div style="flex: 2;">Disciplina</div>
                    <div style="flex: 3;">Tópico de Revisão</div>
                    <div style="flex: 1; text-align: center;">Peso do Edital</div>
                    <div style="flex: 1.5; text-align: center;">Motor Iudex</div>
                    <div style="flex: 1; text-align: center;">Ação Timeblock</div>
                </div>
        `;

        candidatos.forEach(t => {
            html += `
                <div class="grid-row" style="display: flex; padding: 10px; align-items: center; border-bottom: 1px solid var(--surf); background: var(--bg); font-size: 13px; border-left: 4px solid ${t.cor_hex || '#58a6ff'};">
                    <div style="flex: 2; color: #8b949e; font-size: 11px;">${t.disciplina}</div>
                    <div style="flex: 3; color: var(--txt);">${t.topico}</div>
                    <div style="flex: 1; text-align: center;">
                        <span class="badge ${t.peso >= 3 ? 'alta' : ''}">${t.peso || 1}</span>
                    </div>
                    <div style="flex: 1.5; text-align: center; font-size: 11px;">
                        ${(() => {
                            const d = t._iudex.novoIntervalo;
                            const cor = d <= 1 ? 'var(--danger)' : d <= 3 ? '#d29922' : 'var(--succ)';
                            const label = d <= 1 ? '🔴 Urgente hoje' : d <= 3 ? `⚠️ Em ${d} dias` : `✅ Em ${d} dias`;
                            return `<span style="font-weight:bold;color:${cor};">${label}</span>`;
                        })()}<br>
                        <span style="font-size:9px; color:#8b949e;">Fator: ${t._iudex.novoFator} | Nível: ${t._iudex.novoEstagio}</span>
                    </div>
                    <div style="flex: 1; text-align: center;">
                        <button class="upload-btn" style="padding: 4px 8px; font-size: 10px; background-color: var(--succ); color: white;"
                            onclick="agendarViaIudex(${t.id}, ${t._iudex.novoIntervalo})">+ Agendar</button>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        container.innerHTML = html;
    };

    // V2.0: Agenda todos os urgentes (intervalo <= 1 dia) de uma só vez
    window.agendarTodosUrgentes = async function() {
        const urgentes = localData.filter(t => {
            if (!t.concluido) return false;
            let q = t.peso || 1;
            let intervalo = 1, estagio = 1;
            if (t.rev3) { intervalo = 30; estagio = 4; }
            else if (t.rev2) { intervalo = 7; estagio = 3; }
            else if (t.rev1) { intervalo = 1; estagio = 2; }
            const iudex = calcularVavilovIudex(q, intervalo, 2.5, estagio);
            return iudex.novoIntervalo <= 1;
        });
        if (!urgentes.length) { showToast("Nenhum urgente encontrado.", true); return; }
        const hoje = new Date().toISOString().split('T')[0];
        let count = 0;
        for (const item of urgentes) {
            await fetch(`/api/topics/${item.id}/schedule`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data_agendada: hoje, horario_inicio: '08:00', duracao_minutos: 60, semana: 'Iudex XII' })
            });
            item.data_agendada = hoje;
            count++;
        }
        syncCalendar();
        window.renderRevisoesInteligentes();
        showToast(`🧠 ${count} revisões urgentes agendadas para hoje!`);
    };

    // Botão "+ Agendar" de dentro do painel Iudex
    window.agendarViaIudex = async function(id, dias) {
        const item = localData.find(t => t.id === id);
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + dias);
        const novaDataStr = targetDate.toISOString().split('T')[0];

        await fetch(`/api/topics/${id}/schedule`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data_agendada: novaDataStr,
                horario_inicio: item.horario_inicio || '08:00',
                duracao_minutos: item.duracao_minutos || 60,
                semana: 'Iudex XII'   // FIX B4: semana não pode ficar NULL
            })
        });
        item.data_agendada = novaDataStr;
        syncCalendar();
        showToast(`🧠 Iudex XII: Agendado para ${novaDataStr} (+${dias} dias)!`);
    };

    // ── Boot ─────────────────────────────────────────────────────
    loadData();
});
