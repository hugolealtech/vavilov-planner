const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'vavilov.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log("[AUDITORIA FÍSICA] Verificando e aplicando a estrutura relacional completa...");

    // Ativação do modo WAL para mitigar travamentos concorrentes de escrita no contêiner
    db.run("PRAGMA journal_mode = WAL");

    // 1. Tabela de Concursos Workspaces
    db.run(`CREATE TABLE IF NOT EXISTS concursos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        banca TEXT,
        data_prova DATE,
        status TEXT DEFAULT 'Ativo',
        icone TEXT DEFAULT '🎯',
        is_default BOOLEAN DEFAULT 0
    )`);

    db.run(`INSERT OR IGNORE INTO concursos (id, nome, is_default) VALUES (1, 'Workspace Principal', 1)`);

    // 2. Tabela Principal do Planejamento (Edital Atual)
    db.run(`CREATE TABLE IF NOT EXISTS edital_atual (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        semana TEXT, 
        disciplina TEXT, 
        topico TEXT,
        peso INTEGER DEFAULT 1, 
        concluido BOOLEAN DEFAULT 0, 
        rev1 BOOLEAN DEFAULT 0, 
        rev2 BOOLEAN DEFAULT 0, 
        rev3 BOOLEAN DEFAULT 0, 
        data_execucao DATE, 
        ordem INTEGER DEFAULT 0
    )`);

    // Bloco de Migrações Incrementais Protegidas
    const addCol = (columnDef) => {
        db.run(`ALTER TABLE edital_atual ADD COLUMN ${columnDef}`, (err) => {
            if (err && !err.message.includes("duplicate column name") && !err.message.includes("already exists")) {
                console.error(`[MIGRATION ERRO]: ${columnDef}`, err.message);
            }
        });
    };

    addCol("horario_inicio TEXT");
    addCol("duracao_minutos INTEGER DEFAULT 60");
    addCol("prioridade TEXT DEFAULT 'Normal'");
    addCol("dificuldade INTEGER DEFAULT 3");
    addCol("cor_hex TEXT DEFAULT '#58a6ff'");
    addCol("data_agendada TEXT");
    addCol("is_deleted BOOLEAN DEFAULT 0");
    addCol("deleted_at DATETIME");
    addCol("concurso_id INTEGER DEFAULT 1");
    addCol("parent_id INTEGER DEFAULT NULL");  // suporte a subtópicos filhos ilimitados

    // 3. Tabela de Logs e Auditoria de Lixeira
    db.run(`CREATE TABLE IF NOT EXISTS lixeira_eventos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entidade_tipo TEXT NOT NULL,
        entidade_id INTEGER,
        dados_json TEXT NOT NULL,
        data_exclusao DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 4. Tabela de Rastro e Histórico Analítico (Heatmap)
    db.run(`CREATE TABLE IF NOT EXISTS study_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topico_id INTEGER NOT NULL,
        data_inicio TEXT NOT NULL, 
        duracao_minutos INTEGER DEFAULT 60,
        tipo_evento TEXT DEFAULT 'concluido',
        origem TEXT DEFAULT 'Vavilov-OS-Core'
    )`);

    // 5. Tabela de Memória Global Compartilhada (Simbiose)
    db.run(`CREATE TABLE IF NOT EXISTS global_memory (
        hash_id TEXT PRIMARY KEY, 
        disciplina TEXT, 
        topico TEXT, 
        nivel_dominio INTEGER DEFAULT 0, 
        ultima_revisao DATE,
        acertos INTEGER DEFAULT 0, 
        erros INTEGER DEFAULT 0
    )`);

    console.log("[AUDITORIA FÍSICA] Integridade estrutural do banco de dados assegurada.");
});

module.exports = db;