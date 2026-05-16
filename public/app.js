// Gerenciamento e Alternância de Abas Globais
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
    }
    if (viewName === 'analytics') {
        if (typeof window.renderHeatmap === 'function') window.renderHeatmap();
        if (typeof window.renderRastro === 'function') window.renderRastro();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    let localData = [];
    let filtroDisciplina = "";
    window.calendarInstance = null;
    let draggableInstance = null; // Instância de controle do motor de arrasto

    const toast = document.getElementById('toast');
    let toastTimeout;

    function showToast(msg, isError = false) {
        if (!toast) return;
        clearTimeout(toastTimeout);
        toast.innerText = msg;
        toast.style.borderColor = isError ? 'var(--danger)' : 'var(--brd)';
        toast.style.opacity = 1;
        toastTimeout = setTimeout(() => toast.style.opacity = 0, 2500);
    }

    window.filtrarPorDisciplina = function(disc) {
        filtroDisciplina = disc;
        renderGrid();
    };

    window.adicionarTopicoManual = async function() {
        const disciplina = document.getElementById('manDisciplina').value.trim();
        const topico = document.getElementById('manTopico').value.trim();
        const peso = document.getElementById('manPeso').value;

        if (!disciplina || !topico) {
            showToast("Preencha a Disciplina e o Tópico para continuar!", true);
            return;
        }

        const payload = {
            semana: "Caixa de Entrada",
            disciplina: disciplina,
            topico: topico,
            peso: parseInt(peso) || 1,
            prioridade: "Normal",
            cor_hex: "#58a6ff"
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
                if (window.calendarInstance) syncCalendar();
            }
        } catch (e) {
            showToast("Erro ao processar salvamento automático", true);
        }
    };

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
            }
        } catch (e) {
            showToast("Erro ao processar deleção", true);
        }
    };

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
            }
        } catch (e) {
            showToast("Erro na limpeza em massa", true);
        }
    };

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

    function populateFilters() {
        const select = document.getElementById('filtoDisciplinaHead');
        if (!select) return;
        const disciplinas = [...new Set(localData.map(t => t.disciplina))].sort();
        select.innerHTML = '<option value="">Todas as Disciplinas</option>';
        disciplinas.forEach(d => {
            select.innerHTML += `<option value="${d}" ${filtroDisciplina === d ? 'selected' : ''}>${d}</option>`;
        });
    }

    function recalcularProgresso() {
        const fill = document.getElementById('progressBarFill');
        const text = document.getElementById('progressBarPercent');
        if (!fill || !text) return;

        if (localData.length === 0) {
            fill.style.width = '0%';
            text.innerText = '0%';
            return;
        }
        const totais = localData.length;
        const concluidos = localData.filter(t => t.concluido === 1 || t.concluido === true).length;
        const porc = Math.round((concluidos / totais) * 100);
        fill.style.width = `${porc}%`;
        text.innerText = `${porc}%`;
    }

    function renderGrid() {
        const body = document.getElementById('gridBody');
        if (!body) return;
        body.innerHTML = '';
        
        const dadosFiltrados = filtroDisciplina ? localData.filter(t => t.disciplina === filtroDisciplina) : localData;
        recalcularProgresso();

        dadosFiltrados.forEach(t => {
            const row = document.createElement('div');
            row.className = 'grid-row';
            row.style.borderLeft = `4px solid ${t.cor_hex || '#58a6ff'}`;
            row.innerHTML = `
                <div class="grid-cell drag-handle" style="cursor:grab;">⠿</div>
                <div class="grid-cell">${t.disciplina}</div>
                <div class="grid-cell">${t.topico}</div>
                <div class="grid-cell editable" contenteditable="true" onblur="salvarInline(${t.id}, 'peso', this)">${t.peso || 1}</div>
                <div class="grid-cell"><input type="checkbox" ${t.concluido ? 'checked' : ''} onchange="salvarInline(${t.id}, 'concluido', this)"></div>
                <div class="grid-cell"><input type="checkbox" ${t.rev1 ? 'checked' : ''} onchange="salvarInline(${t.id}, 'rev1', this)"></div>
                <div class="grid-cell"><input type="checkbox" ${t.rev2 ? 'checked' : ''} onchange="salvarInline(${t.id}, 'rev2', this)"></div>
                <div class="grid-cell"><input type="checkbox" ${t.rev3 ? 'checked' : ''} onchange="salvarInline(${t.id}, 'rev3', this)"></div>
                <div class="grid-cell"><button class="btn-del" onclick="deletarItem(${t.id})">🗑️</button></div>
            `;
            body.appendChild(row);
        });
    }

    window.renderHeatmap = async function() {
        const container = document.getElementById('heatmapContainer');
        if (!container) return;
        container.innerHTML = 'Buscando métricas...';
        try {
            const res = await fetch('/api/analytics/heatmap');
            const data = await res.json();
            container.innerHTML = '';
            
            if (data.length === 0) {
                container.innerHTML = '<p style="font-size:11px; color:#8b949e;">Sem sessões registradas.</p>';
                return;
            }

            data.forEach(d => {
                const block = document.createElement('div');
                block.style.width = '30px';
                block.style.height = '30px';
                block.style.borderRadius = '4px';
                const alpha = Math.min(d.count * 0.25, 1);
                block.style.backgroundColor = `rgba(35, 134, 54, ${alpha})`;
                block.title = `${d.date}: ${d.count} execução(ões)`;
                container.appendChild(block);
            });
        } catch (e) { container.innerHTML = 'Erro ao processar mapa.'; }
    };

    window.renderRastro = async function() {
        const timeline = document.getElementById('rastroTimeline');
        if (!timeline) return;
        timeline.innerHTML = 'Buscando logs...';
        try {
            const res = await fetch('/api/analytics/rastro');
            const data = await res.json();
            timeline.innerHTML = '';

            if (data.length === 0) {
                timeline.innerHTML = '<p style="font-size:11px; color:#8b949e;">Linha do tempo vazia.</p>';
                return;
            }

            data.forEach(s => {
                const item = document.createElement('div');
                item.style.background = '#21262d';
                item.style.padding = '8px';
                item.style.borderRadius = '4px';
                item.style.fontSize = '12px';
                item.innerHTML = `⏱️ <b>${s.data_inicio}</b> - Ação [<b>${s.tipo_evento}</b>] processada em <span style="color:var(--acc)">${s.disciplina}</span>: <i>${s.topico}</i>`;
                timeline.appendChild(item);
            });
        } catch (e) { timeline.innerHTML = 'Erro ao ler rastro.'; }
    };

    function initCalendar() {
        const el = document.getElementById('calendar');
        const backlogEl = document.getElementById('calendar-backlog');
        if (!el || !backlogEl) return;

        const eventos = localData.filter(t => t.data_agendada).map(t => ({
            id: t.id.toString(),
            title: `[${t.disciplina}] ${t.topico}`,
            start: `${t.data_agendada}T${t.horario_inicio || '08:00'}:00`,
            backgroundColor: t.cor_hex || '#58a6ff',
            borderColor: 'transparent'
        }));

        // RECONEXÃO DA POPULAÇÃO DA LISTA LATERAL DE BACKLOG PENDENTE
        backlogEl.innerHTML = '';
        localData.filter(t => !t.data_agendada).forEach(t => {
            const item = document.createElement('div');
            item.className = 'fc-event-item';
            item.innerText = `[${t.disciplina}] ${t.topico}`;
            item.setAttribute('data-id', t.id);
            item.setAttribute('data-title', `[${t.disciplina}] ${t.topico}`);
            backlogEl.appendChild(item);
        });

        // ARRASTADOR EXTERNO DO FULLCALENDAR ATIVADO EXPLICITAMENTE
        if (typeof FullCalendar !== 'undefined' && FullCalendar.Draggable) {
            if (draggableInstance) {
                draggableInstance.destroy(); 
            }
            draggableInstance = new FullCalendar.Draggable(backlogEl, {
                itemSelector: '.fc-event-item',
                eventData: function(eventEl) {
                    return {
                        id: eventEl.getAttribute('data-id'),
                        title: eventEl.getAttribute('data-title'),
                        backgroundColor: '#58a6ff',
                        borderColor: 'transparent'
                    };
                }
            });
        }

        if (typeof FullCalendar !== 'undefined') {
            if (!window.calendarInstance) {
                window.calendarInstance = new FullCalendar.Calendar(el, {
                    initialView: 'timeGridWeek',
                    headerToolbar: { left: 'prev,next today', center: 'title', right: 'timeGridWeek,timeGridDay' },
                    locale: 'pt-br',
                    editable: true,
                    droppable: true, // Habilitação explícita para aceitar drops de elementos do backlog
                    events: eventos,
                    eventDrop: async function(info) {
                        const id = info.event.id;
                        const dateObj = info.event.start;
                        const data_agendada = dateObj.toISOString().split('T')[0];
                        const horario_inicio = dateObj.toTimeString().split(' ')[0].substring(0,5);
                        
                        await fetch(`/api/topics/${id}/schedule`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ data_agendada, horario_inicio, duracao_minutos: 60, semana: 'Sincronizado' })
                        });
                        showToast("Agendamento modificado!");
                    },
                    eventReceive: async function(info) {
                        // Método acionado no momento exato do drop do backlog para o calendário
                        const id = info.event.id;
                        const dateObj = info.event.start;
                        const data_agendada = dateObj.toISOString().split('T')[0];
                        const horario_inicio = dateObj.toTimeString().split(' ')[0].substring(0,5);

                        try {
                            const res = await fetch(`/api/topics/${id}/schedule`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ data_agendada, horario_inicio, duracao_minutos: 60, semana: 'Sincronizado' })
                            });
                            if (res.ok) {
                                showToast("Item do backlog integrado ao Calendário!");
                                await loadData(); // Recarga atômica limpa o nó da barra lateral imediatamente
                            }
                        } catch (err) {
                            showToast("Falha na sincronização do timeblock", true);
                        }
                    }
                });
                window.calendarInstance.render();
            } else {
                syncCalendar();
            }
        }
    }

    function syncCalendar() {
        if (!window.calendarInstance) return;
        window.calendarInstance.removeAllEvents();
        const eventos = localData.filter(t => t.data_agendada).map(t => ({
            id: t.id.toString(),
            title: `[${t.disciplina}] ${t.topico}`,
            start: `${t.data_agendada}T${t.horario_inicio || '08:00'}:00`,
            backgroundColor: t.cor_hex || '#58a6ff',
            borderColor: 'transparent'
        }));
        window.calendarInstance.addEventSource(eventos);
    }

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

    loadData();
});