const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdf = require('pdf-parse');
const db = require('../database');
const EventEmitter = require('events');

class VavilovEventBus extends EventEmitter {}
const eventBus = new VavilovEventBus();

const upload = multer({ storage: multer.memoryStorage() });

// Barramento de Eventos Assíncronos para População do Rastro e Memória Global
eventBus.on('estudo_computado', ({ id, campo, valor, disciplina, topico }) => {
    const hoje = new Date().toISOString().split('T')[0];
    if (valor === 1 || valor === true || valor === "1") {
        db.run(
            `INSERT INTO study_sessions (topico_id, data_inicio, duracao_minutos, tipo_evento) VALUES (?, ?, 60, ?)`,
            [id, hoje, campo]
        );

        const hashId = `${disciplina.toLowerCase().trim()}_${topico.toLowerCase().trim()}`;
        db.run(
            `INSERT INTO global_memory (hash_id, disciplina, topico, nivel_dominio, ultima_revisao) 
             VALUES (?, ?, ?, 20, ?) 
             ON CONFLICT(hash_id) DO UPDATE SET 
                nivel_dominio = MIN(nivel_dominio + 15, 100), 
                ultima_revisao = ?`,
            [hashId, disciplina, topico, hoje, hoje]
        );
    }
});

// 1. GET /api/topics - Listagem Ativa Protegida
router.get('/topics', (req, res) => {
    db.all(
        "SELECT * FROM edital_atual WHERE is_deleted = 0 ORDER BY semana ASC, ordem ASC, id ASC",
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

// 2. POST /api/topics - Criação e Inclusão Manual Controlada pelo Usuário
router.post('/topics', (req, res) => {
    const { semana, disciplina, topico, peso, prioridade, cor_hex } = req.body;
    const sem = semana || "Caixa de Entrada";
    const disc = disciplina || "Geral";
    const top = topico || "Tópico Customizado";
    const pes = parseInt(peso) || 1;
    const pri = prioridade || "Normal";
    const cor = cor_hex || "#58a6ff";

    const query = `INSERT INTO edital_atual (semana, disciplina, topico, peso, prioridade, cor_hex, is_deleted, concluido, rev1, rev2, rev3) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0)`;
    db.run(query, [sem, disc, top, pes, pri, cor], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

// 3. DELETE /api/topics/:id - Soft Delete Compatível com app.js
router.delete('/topics/:id', (req, res) => {
    const id = req.params.id;
    const timestamp = new Date().toISOString();

    db.get("SELECT * FROM edital_atual WHERE id = ?", [id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: "Registro não encontrado." });

        db.run(`UPDATE edital_atual SET is_deleted = 1, deleted_at = ? WHERE id = ?`, [timestamp, id], function(upErr) {
            if (upErr) return res.status(500).json({ error: upErr.message });

            db.run(`INSERT INTO lixeira_eventos (entidade_tipo, entidade_id, dados_json) VALUES (?, ?, ?)`,
                ['topico', id, JSON.stringify(row)]);

            res.json({ success: true, message: "Movido para a lixeira." });
        });
    });
});

// 4. POST /api/topics/hierarchy/bulk - Remoção Hierárquica e Limpeza de Painel
router.post('/topics/hierarchy/bulk', (req, res) => {
    const { tipo, disciplina } = req.body;
    const timestamp = new Date().toISOString();
    let query = "";
    let params = [];

    if (tipo === 'disciplina') {
        query = `UPDATE edital_atual SET is_deleted = 1, deleted_at = ? WHERE disciplina = ? AND is_deleted = 0`;
        params = [timestamp, disciplina];
    } else if (tipo === 'tudo') {
        query = `UPDATE edital_atual SET is_deleted = 1, deleted_at = ? WHERE is_deleted = 0`;
        params = [timestamp];
    } else {
        return res.status(400).json({ error: "Escopo operacional desconhecido." });
    }

    db.run(query, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        db.run(`INSERT INTO lixeira_eventos (entidade_tipo, dados_json) VALUES (?, ?)`,
            [tipo, JSON.stringify({ tipo, disciplina, mudancas: this.changes })]);
        res.json({ success: true, alterados: this.changes });
    });
});

// 5. PATCH /api/topics/:id/inline - Edição de Células Grid (AutoSave) com Barramento Concorrente
router.patch('/topics/:id/inline', (req, res) => {
    const { field, value } = req.body;
    const id = req.params.id;

    db.get("SELECT * FROM edital_atual WHERE id = ?", [id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: "Registro inválido." });

        db.run(`UPDATE edital_atual SET ${field} = ? WHERE id = ?`, [value, id], function(upErr) {
            if (upErr) return res.status(500).json({ error: upErr.message });

            if (field === 'concluido' || field.startsWith('rev')) {
                eventBus.emit('estudo_computado', { id, campo: field, valor: value, disciplina: row.disciplina, topico: row.topico });
            }
            res.sendStatus(200);
        });
    });
});

// 6. GET /api/analytics/heatmap - Sumarização do Painel de Calor
router.get('/analytics/heatmap', (req, res) => {
    db.all(`SELECT data_inicio as date, COUNT(id) as count FROM study_sessions GROUP BY data_inicio ORDER BY data_inicio ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// 7. GET /api/analytics/rastro - Histórico de Tracing Longitudinal
router.get('/analytics/rastro', (req, res) => {
    db.all(`SELECT s.id, s.data_inicio, s.tipo_evento, e.disciplina, e.topico 
            FROM study_sessions s 
            JOIN edital_atual e ON s.topico_id = e.id 
            WHERE e.is_deleted = 0
            ORDER BY s.id DESC LIMIT 15`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// 8. PATCH /api/topics/reorder - Movimentação Física Drag and Drop Grid
router.patch('/topics/reorder', (req, res) => {
    const { id, novaSemana, novaOrdem } = req.body;
    db.run("UPDATE edital_atual SET semana = ?, ordem = ? WHERE id = ?", [novaSemana, novaOrdem, id], () => res.sendStatus(200));
});

// 9. PATCH /api/topics/:id/schedule - Sincronização de Metadados do Timeblock Calendário
router.patch('/topics/:id/schedule', (req, res) => {
    const { data_agendada, horario_inicio, duracao_minutos, semana } = req.body;
    db.run(`UPDATE edital_atual SET data_agendada = ?, horario_inicio = ?, duracao_minutos = ?, semana = ? WHERE id = ?`,
        [data_agendada, horario_inicio, duracao_minutos, semana, req.params.id], () => res.sendStatus(200));
});

// 10. POST /api/upload-edital - MOTOR DUPLO COM BLINDAGEM DE TRANSAÇÃO ATÔMICA ANTILOCK
router.post('/upload-edital', upload.single('edital'), async (req, res) => {
    console.log("[PARSER AUDIT] Iniciando processamento de upload de arquivo...");
    try {
        if (!req.file) {
            console.error("[PARSER ERROR] Buffer de arquivo nulo.");
            return res.status(400).json({ error: "Arquivo nulo ou ausente." });
        }

        const data = await pdf(req.file.buffer);
        console.log(`[PARSER AUDIT] PDF extraído. Caracteres totais: ${data.text.length}`);
        
        const linhas = data.text.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(l => l.length > 0);
        console.log(`[PARSER AUDIT] Total de linhas detectadas após normalização: ${linhas.length}`);

        let extraidos = [];
        let discAtual = "Geral";

        // MOTOR LÓGICO A: ABORDAGEM RÍGIDA ORIGINAL
        linhas.forEach(linha => {
            if (linha === linha.toUpperCase() && linha.length > 5 && !linha.startsWith('-') && !/^[\u2022\u25CF\u25CB\u25AA\u25FE\u2013\-\*\▪\•]/.test(linha)) {
                discAtual = linha.replace(/ \(Aula.*\)/g, '');
            } else if (linha.startsWith('-') || (discAtual !== "Geral" && linha.length > 10)) {
                if (!linha.toLowerCase().includes('page') && !linha.toLowerCase().includes('cronograma')) {
                    extraidos.push({
                        disciplina: discAtual,
                        topico: linha.replace(/^-/, '').trim()
                    });
                }
            }
        });

        // MOTOR LÓGICO B: ABORDAGEM NATURAL ADAPTATIVA (FALLBACK)
        if (extraidos.length === 0) {
            console.log("[PARSER AUDIT] Motor A retornou 0 resultados. Ativando Motor B Adaptativo...");
            discAtual = "Geral";
            
            const palavrasChaveDisciplina = [
                'direito', 'processual', 'português', 'portugues', 'informática', 'informatica', 
                'civil', 'penal', 'constitucional', 'administrativo', 'previdenciário', 'previdenciario', 
                'trabalho', 'legislação', 'legislacao', 'administração', 'raciocínio', 'matemática'
            ];

            linhas.forEach(linha => {
                if (linha.toLowerCase().includes('page') || linha.toLowerCase().includes('cronograma')) {
                    return; // Ignora tags estruturais de paginação do leitor
                }

                const textoLimpo = linha.replace(/^[\u2022\u25CF\u25CB\u25AA\u25FE\u2013\-\*\▪\•\◦\–\-]|\b\d+[\.\)]/g, '').trim();
                const temMarcadorLista = /^[\u2022\u25CF\u25CB\u25AA\u25FE\u2013\-\*\▪\•\◦\–\-]/.test(linha) || /^\d+[\.\)]/.test(linha);

                const ehNomeDisciplina = !temMarcadorLista && (linha.length < 60) && (
                    palavrasChaveDisciplina.some(termo => linha.toLowerCase().includes(termo))
                );

                if (ehNomeDisciplina) {
                    discAtual = linha.replace(/[\(\[-]\s*Aula.*\s*[\)\]-]/gi, '').trim();
                } else if (textoLimpo.length > 2 && discAtual !== "Geral") {
                    extraidos.push({
                        disciplina: discAtual,
                        topico: textoLimpo
                    });
                }
            });
        }

        console.log(`[PARSER AUDIT] Processamento concluído. Itens estruturados: ${extraidos.length}`);

        if (extraidos.length === 0) {
            return res.status(422).json({ error: "O layout do PDF não atende aos requisitos mínimos de extração." });
        }

        // SOLUÇÃO DA CONCORRÊNCIA: Execução atômica blindada por transação isolada
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            
            const stmt = db.prepare("INSERT INTO edital_atual (semana, disciplina, topico, cor_hex, is_deleted) VALUES (?, ?, ?, ?, 0)");
            const cores = ['#58a6ff', '#238636', '#d29922', '#f85149', '#8957e5'];
            
            extraidos.forEach((item, index) => {
                stmt.run("Caixa de Entrada", item.disciplina, item.topico, cores[index % cores.length]);
            });
            
            stmt.finalize();
            
            db.run("COMMIT", (commitErr) => {
                if (commitErr) {
                    console.error("[TRANSACTION ERROR] Falha ao fechar commit:", commitErr.message);
                    return res.status(500).json({ error: "Erro na persistência transacional." });
                }
                console.log("[PARSER AUDIT] Transação gravada com sucesso absoluto.");
                res.json({ success: true, total: extraidos.length });
            });
        });

    } catch (err) { 
        console.error(`[PARSER CRITICAL ERROR] ${err.message}`);
        res.status(500).json({ error: err.message }); 
    }
});

module.exports = router;