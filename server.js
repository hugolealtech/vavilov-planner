const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');

const app = express();
app.use(cors());
app.use(express.json());

// Servindo a pasta pública como raiz estática do ecossistema
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRoutes);

const PORT = 5059;
app.listen(PORT, () => console.log(`Vavilov OS modularizado na porta ${PORT}`));