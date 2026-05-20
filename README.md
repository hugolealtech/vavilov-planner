# vavilov-planner
======================================================
     GUIA INICIAL DE USO - VAVILOV OS PLANNER
======================================================
Bem-vindo ao Vavilov OS, o seu ecossistema inteligente
de planejamento, timeblock e revisão espaçada (Iudex XII).

Este guia foi feito passo a passo para que qualquer 
pessoa possa instalar e começar a estudar imediatamente.

------------------------------------------------------
1. O QUE VOCÊ PRECISA TER INSTALADO (PRÉ-REQUISITO)
------------------------------------------------------
Para rodar o Vavilov OS sem complicação, você só precisa
de um programa de contêineres chamado Docker.
- Se usa Windows ou Mac: Pesquise no Google por "Docker 
  Desktop", baixe e instale. É só seguir o "Avançar".
- Mantenha o Docker aberto (o ícone de uma baleia 
  aparecerá perto do relógio do seu computador).

------------------------------------------------------
2. COMO BAIXAR O PROJETO DO GITHUB
------------------------------------------------------
- Acesse a página oficial do projeto:
  https://github.com/hugolealtech/vavilov-planner
- Clique no botão verde "Code" e escolha "Download ZIP".
- Extraia a pasta que você baixou em um local fácil
  de achar (ex: dentro da pasta Documentos).

------------------------------------------------------
3. COMO LIGAR O SISTEMA PELA PRIMEIRA VEZ
------------------------------------------------------
- Abra o Terminal (Linux/Mac) ou o Prompt de Comando (CMD 
  no Windows).
- Acesse a pasta do projeto que você extraiu.
- Copie, cole e aperte "Enter" nestes dois comandos:

  PASSO A (Prepara a máquina virtual do app):
  docker build -t vavilov-os .

  PASSO B (Inicia o sistema e salva seus dados):
  * No Linux/Mac ou PowerShell:
    docker run -d -p 5059:5059 -v $(pwd)/data:/app/data --name vavilov-app vavilov-os
  * No Windows (CMD comum):
    docker run -d -p 5059:5059 -v "%cd%/data:/app/data" --name vavilov-app vavilov-os

------------------------------------------------------
4. ACESSANDO O SEU PLANEJADOR
------------------------------------------------------
Com o comando finalizado, abra seu navegador de 
internet (Chrome, Firefox, Safari) e digite a URL:

🔗 http://localhost:5059

Pronto! A interface azul e preta do Vavilov OS abrirá.

------------------------------------------------------
5. COMO USAR O VAVILOV OS NA PRÁTICA (O BÁSICO)
------------------------------------------------------

👉 ABA 1: GRID EXCEL (A Central de Entrada)
- Use o botão "Carregar Edital" para enviar um PDF do seu
  concurso. O sistema vai extrair e organizar tudo!
- Ou preencha manualmente escolhendo a Disciplina, Tópico
  e o Peso (Importância) e clique no botão '+'.
- Concluiu um estudo? Marque a caixinha de "Estudo".

👉 ABA 2: CALENDÁRIO (Sua Agenda - Timeblock)
- Na esquerda, fica a lista de matérias não agendadas.
- Arraste a matéria da lista para o calendário no dia
  e horário que você quer estudar.
- Estudou? Clique no evento agendado para marcá-lo 
  como concluído (ele ficará verde com um ✅).

👉 ABA 3: PAINEL ANALÍTICO (Inteligência Artificial Iudex)
- Veja a "Zona de Calor" que mapeia seus dias mais produtivos.
- Na parte de baixo, está o MOTOR VAVILOV IUDEX XII. 
  Ele lê o peso da matéria e o que você já estudou, 
  calcula a curva de esquecimento da sua memória e 
  mostra uma tabela dizendo EXATAMENTE o que revisar.
- Basta clicar em "+ Agendar" e o sistema jogará a revisão
  no seu calendário automaticamente!

------------------------------------------------------
6. LIGANDO E DESLIGANDO NO DIA A DIA
------------------------------------------------------
Você não precisa instalar tudo de novo amanhã.
Seus dados estão a salvo!

- Para parar o sistema: 
  docker stop vavilov-app

- Para ligar o sistema para estudar (basta rodar isso):
  docker start vavilov-app