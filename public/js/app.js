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
        syncCalendarBacklog();   // FIX 2: garante backlog atualizado ao trocar de aba
    }
    if (viewName === 'analytics') {
        if (typeof window.renderHeatmap === 'function') window.renderHeatmap();
        if (typeof window.renderRastro  === 'function') window.renderRastro();
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
        let value = element.type === 'checkbox' ? element.checked : element.innerText.trim();
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

                // FIX 3: propaga estado "concluido" visualmente ao calendário
                if (window.calendarInstance) {
                    syncCalendar();
                    if (field === 'concluido') {
                        atualizarEstiloEventoCalendario(id, value);
                    }
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

    // ── Deletar item ─────────────────────────────────────────────
    window.deletarItem = async function(id) {
        if (!confirm("Confirmar envio deste item para a lixeira?")) return;
        try {
            const res = await fetch(`/api/topics/${id}`, { method: 'DELETE' });
            if (res.ok) {
                showToast("Item removido.");
                localData = localData.filter(t => t.id !== id);
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
    // FIX 1 — renderGrid com ANINHAMENTO AUTOMÁTICO POR DISCIPLINA
    // Ordena os dados por disciplina (A→Z) e sub-ordena por id dentro
    // de cada disciplina, criando seções visuais colapsáveis.
    // ══════════════════════════════════════════════════════════════
    function renderGrid() {
        const body = document.getElementById('gridBody');
        if (!body) return;
        body.innerHTML = '';

        const dadosFiltrados = filtroDisciplina
            ? localData.filter(t => t.disciplina === filtroDisciplina)
            : localData;

        recalcularProgresso();

        // Agrupa por disciplina mantendo a ordem de primeira aparição
        // mas reordenando disciplinas alfabeticamente
        const grupos = {};
        dadosFiltrados.forEach(t => {
            const key = t.disciplina;
            if (!grupos[key]) grupos[key] = [];
            grupos[key].push(t);
        });
        const disciplinasOrdenadas = Object.keys(grupos).sort((a, b) => a.localeCompare(b, 'pt-BR'));

        disciplinasOrdenadas.forEach(disciplina => {
            const itens = grupos[disciplina];

            // Cabeçalho colapsável da disciplina
            const grupoEl = document.createElement('div');
            grupoEl.className = 'semana-group';
            grupoEl.setAttribute('data-disciplina', disciplina);

            const totalDisc    = itens.length;
            const concluidosDisc = itens.filter(t => t.concluido === 1 || t.concluido === true).length;
            const percDisc     = totalDisc ? Math.round((concluidosDisc / totalDisc) * 100) : 0;

            const header = document.createElement('div');
            header.className = 'semana-title';
            header.style.cursor = 'pointer';
            header.innerHTML = `
                <span>
                    <span class="disc-toggle" style="font-size:10px; margin-right:6px; color:#8b949e;">▼</span>
                    <span style="border-left: 4px solid ${itens[0].cor_hex || '#58a6ff'}; padding-left: 8px;">${disciplina}</span>
                </span>
                <span style="font-size:12px; color:#8b949e;">${concluidosDisc}/${totalDisc} • ${percDisc}%</span>
            `;

            const listEl = document.createElement('div');
            listEl.className = 'sortable-list';
            listEl.setAttribute('data-disc', disciplina);

            // Toggle colapso
            header.addEventListener('click', () => {
                const collapsed = listEl.style.display === 'none';
                listEl.style.display = collapsed ? '' : 'none';
                header.querySelector('.disc-toggle').textContent = collapsed ? '▼' : '▶';
            });

            grupoEl.appendChild(header);
            grupoEl.appendChild(listEl);
            body.appendChild(grupoEl);

            // Linhas da disciplina
            itens.forEach(t => {
                const row = document.createElement('div');
                row.className = 'grid-row';
                row.setAttribute('data-id', t.id);
                row.style.borderLeft = `4px solid ${t.cor_hex || '#58a6ff'}`;
                if (t.concluido) row.style.opacity = '0.65';

                row.innerHTML = `
                    <div class="grid-cell drag-handle" style="cursor:grab;">⠿</div>
                    <div class="grid-cell" style="color:#8b949e; font-size:12px;">↳</div>
                    <div class="grid-cell editable" contenteditable="true" onblur="salvarInline(${t.id}, 'topico', this)" style="${t.concluido ? 'text-decoration:line-through;color:#8b949e;' : ''}">${t.topico}</div>
                    <div class="grid-cell editable" contenteditable="true" onblur="salvarInline(${t.id}, 'peso', this)">${t.peso || 1}</div>
                    <div class="grid-cell center-cell"><input type="checkbox" ${t.concluido ? 'checked' : ''} onchange="salvarInline(${t.id}, 'concluido', this); this.closest('.grid-row').style.opacity=this.checked?'0.65':'1'; this.closest('.grid-row').querySelector('[contenteditable]').style.textDecoration=this.checked?'line-through':'none';"></div>
                    <div class="grid-cell center-cell"><input type="checkbox" ${t.rev1 ? 'checked' : ''} onchange="salvarInline(${t.id}, 'rev1', this)"></div>
                    <div class="grid-cell center-cell"><input type="checkbox" ${t.rev2 ? 'checked' : ''} onchange="salvarInline(${t.id}, 'rev2', this)"></div>
                    <div class="grid-cell center-cell"><input type="checkbox" ${t.rev3 ? 'checked' : ''} onchange="salvarInline(${t.id}, 'rev3', this)"></div>
                    <div class="grid-cell center-cell"><button class="btn-del" onclick="deletarItem(${t.id})">🗑️</button></div>
                `;
                listEl.appendChild(row);
            });

            // Sortable dentro de cada grupo de disciplina
            if (typeof Sortable !== 'undefined') {
                Sortable.create(listEl, {
                    handle: '.drag-handle',
                    animation: 150,
                    ghostClass: 'ghost',
                    onEnd: async function(evt) {
                        const movedId = evt.item.getAttribute('data-id');
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

    // ── Analytics: Heatmap com grade de calendário ──────────────
    window.renderHeatmap = async function() {
        const container = document.getElementById('heatmapContainer');
        if (!container) return;
        container.innerHTML = '<p style="font-size:11px;color:#8b949e;">Carregando heatmap...</p>';
        try {
            const res  = await fetch('/api/analytics/heatmap');
            const data = await res.json();

            // Constrói mapa de data→count para lookup rápido
            const countMap = {};
            data.forEach(d => { countMap[d.date] = d.count; });

            // Gera os últimos 84 dias (12 semanas)
            const hoje = new Date();
            const dias = [];
            for (let i = 83; i >= 0; i--) {
                const d = new Date(hoje);
                d.setDate(hoje.getDate() - i);
                dias.push(d.toISOString().split('T')[0]);
            }

            const maxCount = Math.max(1, ...data.map(d => d.count));

            // Monta HTML da grade
            const diasSemana = ['D','S','T','Q','Q','S','S'];
            let html = '<div style="font-size:10px;color:#8b949e;margin-bottom:8px;">Últimas 12 semanas de atividade</div>';
            
            // Labels dos dias da semana
            html += '<div style="display:grid;grid-template-columns:18px repeat(12,1fr);gap:3px;margin-bottom:2px;">';
            html += '<div></div>';
            // labels das semanas (mês abreviado quando muda)
            let mesAtual = '';
            for (let col = 0; col < 12; col++) {
                const diaCol = new Date(hoje);
                diaCol.setDate(hoje.getDate() - (11 - col) * 7);
                const mes = diaCol.toLocaleDateString('pt-BR', { month: 'short' });
                if (mes !== mesAtual) {
                    html += `<div style="font-size:9px;color:#8b949e;text-align:center;">${mes}</div>`;
                    mesAtual = mes;
                } else {
                    html += '<div></div>';
                }
            }
            html += '</div>';

            // Grade 7 linhas × 12 colunas
            html += '<div style="display:grid;grid-template-columns:18px repeat(12,1fr);gap:3px;">';
            for (let row = 0; row < 7; row++) {
                html += `<div style="font-size:9px;color:#8b949e;display:flex;align-items:center;">${diasSemana[row]}</div>`;
                for (let col = 0; col < 12; col++) {
                    const idx = col * 7 + row;
                    if (idx >= dias.length) { html += '<div></div>'; continue; }
                    const dateStr = dias[idx];
                    const count = countMap[dateStr] || 0;
                    const alpha = count === 0 ? 0 : 0.2 + (count / maxCount) * 0.8;
                    const bg = count === 0
                        ? '#21262d'
                        : `rgba(35,134,54,${alpha.toFixed(2)})`;
                    const label = count === 0
                        ? `${dateStr}: nenhuma sessão`
                        : `${dateStr}: ${count} sessão(ões)`;
                    html += `<div title="${label}" style="width:100%;aspect-ratio:1;border-radius:3px;background:${bg};cursor:default;"></div>`;
                }
            }
            html += '</div>';

            // Legenda
            html += '<div style="display:flex;align-items:center;gap:4px;margin-top:10px;font-size:10px;color:#8b949e;">';
            html += '<span>Menos</span>';
            ['#21262d','rgba(35,134,54,0.3)','rgba(35,134,54,0.55)','rgba(35,134,54,0.75)','rgba(35,134,54,1)'].forEach(c => {
                html += `<div style="width:12px;height:12px;border-radius:2px;background:${c};"></div>`;
            });
            html += '<span>Mais</span></div>';

            container.innerHTML = html;

            // Cards de resumo abaixo do heatmap
            await renderSummaryCards();

        } catch (e) { container.innerHTML = '<p style="color:var(--danger);font-size:12px;">Erro ao processar heatmap.</p>'; }
    };

    // ── Cards de resumo geral (independe de ter sessões registradas) ──
    async function renderSummaryCards() {
        let summaryEl = document.getElementById('analyticsCards');
        if (!summaryEl) return;
        try {
            const res  = await fetch('/api/analytics/summary');
            const data = await res.json();
            const t = data.totais || {};
            const total     = t.total || 0;
            const concluidos = t.concluidos || 0;
            const perc      = total > 0 ? Math.round((concluidos / total) * 100) : 0;

            let cardsHtml = `
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px;">
                    <div style="background:#21262d;border-radius:8px;padding:14px;text-align:center;">
                        <div style="font-size:24px;font-weight:bold;color:#fff;">${total}</div>
                        <div style="font-size:11px;color:#8b949e;margin-top:4px;">Tópicos no Edital</div>
                    </div>
                    <div style="background:#21262d;border-radius:8px;padding:14px;text-align:center;">
                        <div style="font-size:24px;font-weight:bold;color:var(--succ);">${concluidos}</div>
                        <div style="font-size:11px;color:#8b949e;margin-top:4px;">Estudados</div>
                    </div>
                    <div style="background:#21262d;border-radius:8px;padding:14px;text-align:center;">
                        <div style="font-size:24px;font-weight:bold;color:var(--acc);">${perc}%</div>
                        <div style="font-size:11px;color:#8b949e;margin-top:4px;">Progresso Geral</div>
                    </div>
                    <div style="background:#21262d;border-radius:8px;padding:14px;text-align:center;">
                        <div style="font-size:24px;font-weight:bold;color:#d29922;">${t.rev1_total || 0}</div>
                        <div style="font-size:11px;color:#8b949e;margin-top:4px;">Revisões 24h</div>
                    </div>
                </div>`;

            // Top disciplinas
            if (data.disciplinas && data.disciplinas.length > 0) {
                cardsHtml += '<div style="margin-top:16px;"><div style="font-size:12px;color:#8b949e;margin-bottom:8px;">Progresso por Disciplina</div>';
                data.disciplinas.forEach(d => {
                    const p = d.total > 0 ? Math.round((d.concluidos / d.total) * 100) : 0;
                    cardsHtml += `
                        <div style="margin-bottom:8px;">
                            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
                                <span>${d.disciplina}</span>
                                <span style="color:#8b949e;">${d.concluidos}/${d.total} • ${p}%</span>
                            </div>
                            <div style="background:#30363d;height:5px;border-radius:3px;overflow:hidden;">
                                <div style="background:var(--succ);width:${p}%;height:100%;transition:width 0.4s;"></div>
                            </div>
                        </div>`;
                });
                cardsHtml += '</div>';
            }

            summaryEl.innerHTML = cardsHtml;
        } catch(e) { /* silencioso */ }
    }

    // ── Analytics: Rastro ────────────────────────────────────────
    window.renderRastro = async function() {
        const timeline = document.getElementById('rastroTimeline');
        if (!timeline) return;
        timeline.innerHTML = '<p style="font-size:11px;color:#8b949e;">Carregando rastro...</p>';
        try {
            const res  = await fetch('/api/analytics/rastro');
            const data = await res.json();
            timeline.innerHTML = '';
            if (data.length === 0) {
                timeline.innerHTML = `
                    <div style="text-align:center;padding:20px;color:#8b949e;">
                        <div style="font-size:24px;margin-bottom:8px;">📭</div>
                        <div style="font-size:12px;">Nenhuma sessão registrada ainda.</div>
                        <div style="font-size:11px;margin-top:4px;">Marque tópicos como estudados no Grid para popular o rastro.</div>
                    </div>`;
                return;
            }
            const labels = { concluido: '✅ Estudo', rev1: '🔁 Rev. 24h', rev2: '🔁 Rev. 7d', rev3: '🔁 Rev. 30d' };
            data.forEach(s => {
                const item = document.createElement('div');
                item.style.cssText = 'background:#21262d;padding:10px 12px;border-radius:6px;font-size:12px;border-left:3px solid var(--acc);';
                const label = labels[s.tipo_evento] || s.tipo_evento;
                item.innerHTML = `
                    <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                        <span style="color:var(--acc);font-weight:bold;">${label}</span>
                        <span style="color:#8b949e;font-size:11px;">${s.data_inicio}</span>
                    </div>
                    <div style="color:#c9d1d9;">${s.disciplina}</div>
                    <div style="color:#8b949e;font-size:11px;margin-top:2px;">${s.topico}</div>`;
                timeline.appendChild(item);
            });
        } catch (e) { timeline.innerHTML = '<p style="color:var(--danger);font-size:12px;">Erro ao ler rastro.</p>'; }
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
            item.setAttribute('data-title', `[${t.disciplina}] ${t.topico}`);
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
            title: (t.concluido ? '✅ ' : '') + `[${t.disciplina}] ${t.topico}`,
            start: `${t.data_agendada}T${t.horario_inicio || '08:00'}:00`,
            duration: { minutes: t.duracao_minutos || 60 },
            backgroundColor: t.concluido ? '#238636' : (t.cor_hex || '#58a6ff'),
            borderColor: 'transparent'
        }));

        if (typeof FullCalendar === 'undefined') return;

        if (!window.calendarInstance) {
            window.calendarInstance = new FullCalendar.Calendar(el, {
                initialView: 'timeGridWeek',
                headerToolbar: { left: 'prev,next today', center: 'title', right: 'timeGridWeek,timeGridDay' },
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
            title: (t.concluido ? '✅ ' : '') + `[${t.disciplina}] ${t.topico}`,
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

    // ── Boot ─────────────────────────────────────────────────────
    loadData();
});
