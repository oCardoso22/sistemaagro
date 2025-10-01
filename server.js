const express = require('express');
const multer = require('multer');
require('dotenv').config();

// AJUSTE AQUI: O caminho agora aponta para a pasta './agents'
const { 
    processPDFWithGemini, 
    MODELO_GEMINI, 
    CATEGORIAS_DESPESAS,
    getCategoryExamples 
} = require('./agents/agent1'); 

const app = express();
const port = 3000;

// Configuração do Multer para upload de PDFs
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 15 * 1024 * 1024 // 15MB para PDFs
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos PDF são permitidos para extração de dados de notas fiscais.'));
        }
    }
});

// Middleware para servir arquivos estáticos
app.use(express.static('public'));
app.use(express.json());

// Rota principal para extração de dados
app.post('/extract-data', upload.single('invoice'), async (req, res) => {
    const startTime = Date.now();

    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Nenhum arquivo PDF foi enviado.'
            });
        }

        // Verifica se a API key do Gemini está configurada
        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'Chave da API do Google Gemini não configurada.',
                instructions: 'Adicione GEMINI_API_KEY=sua_chave no arquivo .env'
            });
        }

        console.log('🚀 Iniciando processamento...');
        console.log(`📁 Arquivo: ${req.file.originalname}`);
        console.log(`📊 Tamanho: ${(req.file.size / 1024).toFixed(1)}KB`);

        // CHAMA A FUNÇÃO DE PROCESSAMENTO DO AGENTE EXTERNO
        const extractedData = await processPDFWithGemini(req.file.buffer);

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`🎉 Processamento concluído em ${totalTime}s`);

        res.json({
            success: true,
            method: 'direct_pdf_processing',
            data: extractedData,
            metadata: {
                filename: req.file.originalname,
                fileSize: req.file.size,
                processingTime: `${totalTime}s`,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error('❌ Erro geral:', error);

        res.status(500).json({
            success: false,
            error: 'Erro ao processar o arquivo PDF.',
            details: error.message,
            processingTime: `${totalTime}s`,
            timestamp: new Date().toISOString()
        });
    }
});

// Rota de teste
app.get('/test', (req, res) => {
    res.json({
        message: 'Sistema de Extração de Dados de NF funcionando!',
        gemini_key_configured: !!process.env.GEMINI_API_KEY,
        supported_formats: ['PDF'],
        categories: CATEGORIAS_DESPESAS, // Usando a constante importada
        processing_method: 'Direct PDF to Gemini',
        timestamp: new Date().toISOString()
    });
});

// Rota para testar modelos disponíveis (Adaptada para usar o módulo agent1)
app.get('/test-models', async (req, res) => {
    if (!process.env.GEMINI_API_KEY) {
        return res.json({
            success: false,
            error: "Chave da API não configurada para teste de modelo."
        });
    }
    // Para simplificar a demonstração, esta rota não será alterada drasticamente,
    // mas em um projeto real, a inicialização do 'genAI' deveria ser movida para cá.
    res.json({
        success: true,
        text: `Teste de modelo usando ${MODELO_GEMINI} deve ser realizado no agente. A chave está configurada.`,
        model: MODELO_GEMINI
    });
});


// Rota para listar categorias de despesas
app.get('/categories', (req, res) => {
    res.json({
        success: true,
        categories: CATEGORIAS_DESPESAS.map((cat, index) => ({
            id: index + 1,
            name: cat,
            // Usando a função auxiliar importada
            examples: getCategoryExamples(cat) 
        }))
    });
});


// Middleware de tratamento de erros (mantém o tratamento de erros do Multer)
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'Arquivo muito grande. Máximo 15MB permitido para PDFs.'
            });
        }
    }

    // Erro de filtro de arquivo (ex: não é PDF)
    if (error.message.includes('apenas arquivos PDF')) {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }

    console.error('Erro não tratado:', error);
    res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        details: error.message
    });
});

app.listen(port, () => {
    console.log('='.repeat(60));
    console.log('🚀 SISTEMA DE EXTRAÇÃO DE DADOS DE NOTAS FISCAIS');
    console.log('='.repeat(60));
    console.log(`🌐 Servidor: http://localhost:${port}`);
    console.log(`🔑 API Gemini: ${process.env.GEMINI_API_KEY ? '✅ Configurada' : '❌ Não configurada'}`);
    console.log(`📄 Método: Processamento direto de PDF`);
    console.log(`📊 Categorias: ${CATEGORIAS_DESPESAS.length} disponíveis`);
    console.log(`🤖 Modelo: ${MODELO_GEMINI}`);
    console.log('='.repeat(60));

    if (!process.env.GEMINI_API_KEY) {
        console.log('⚠️  ATENÇÃO: Configure a API key do Gemini no arquivo .env');
        console.log('   GEMINI_API_KEY=sua_chave_aqui');
    }
});