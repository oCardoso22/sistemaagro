const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Tesseract = require('tesseract.js');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf');
require('dotenv').config();

const app = express();
const port = 3000;

// Configuração do PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');

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

// Configuração do Google Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Middleware para servir arquivos estáticos
app.use(express.static('public'));
app.use(express.json());

// Categorias de despesas conforme especificação
const CATEGORIAS_DESPESAS = [
    'INSUMOS AGRÍCOLAS',
    'MANUTENÇÃO E OPERAÇÃO',
    'RECURSOS HUMANOS',
    'SERVIÇOS OPERACIONAIS',
    'INFRAESTRUTURA E UTILIDADES',
    'ADMINISTRATIVAS',
    'SEGUROS E PROTEÇÃO',
    'IMPOSTOS E TAXAS',
    'INVESTIMENTOS'
];

// Função para extrair texto do PDF usando PDF.js
async function extractTextFromPDF(pdfBuffer) {
    try {
        console.log('📄 Extraindo texto do PDF...');
        const startTime = Date.now();

        const loadingTask = pdfjsLib.getDocument({
            data: new Uint8Array(pdfBuffer),
            verbosity: 0
        });

        const pdf = await loadingTask.promise;
        console.log(`📊 PDF carregado. Páginas: ${pdf.numPages}`);

        let fullText = '';

        // Extrai texto de todas as páginas
        for (let pageNum = 1; pageNum <= Math.min(pdf.numPages, 3); pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();

            const pageText = textContent.items
                .map(item => item.str)
                .join(' ');

            fullText += pageText + '\n\n';
            console.log(`📝 Página ${pageNum} processada: ${pageText.length} caracteres`);
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ Texto extraído em ${duration}s. Total: ${fullText.length} caracteres`);

        return fullText.trim();
    } catch (error) {
        console.error('❌ Erro na extração de texto do PDF:', error);
        throw new Error(`Falha na extração de texto do PDF: ${error.message}`);
    }
}

// Função para processar dados com Gemini
async function processWithGemini(extractedText, method = 'text') {
    try {
        console.log(`🤖 Processando com Gemini (método: ${method})...`);

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `Você é um especialista em análise de notas fiscais brasileiras. Analise o texto abaixo extraído de uma nota fiscal e extraia EXATAMENTE os seguintes dados em formato JSON válido.

TEXTO DA NOTA FISCAL:
${extractedText}

INSTRUÇÕES IMPORTANTES:
- Use 'null' se a informação não for encontrada
- Para datas, use formato YYYY-MM-DD
- Para valores monetários, use apenas números (sem R$, pontos ou vírgulas)
- Para CNPJ/CPF, mantenha apenas números
- Para classificação de despesa, analise os produtos/serviços e escolha UMA categoria mais adequada
- Se não conseguir identificar uma data específica, use 'null'
- Para parcelas, se não especificado, considere 1 parcela

CATEGORIAS DE DESPESAS DISPONÍVEIS:
${CATEGORIAS_DESPESAS.map((cat, index) => `${index + 1}. ${cat}`).join('\n')}

FORMATO DE RESPOSTA (JSON):
{
    "fornecedor": {
        "razao_social": "string ou null",
        "fantasia": "string ou null", 
        "cnpj": "apenas números ou null"
    },
    "faturado": {
        "nome_completo": "string ou null",
        "cpf": "apenas números ou null"
    },
    "numero_nota_fiscal": "string ou null",
    "data_emissao": "YYYY-MM-DD ou null",
    "descricao_produtos": "descrição detalhada dos produtos/serviços ou null",
    "quantidade_parcelas": 1,
    "data_vencimento": "YYYY-MM-DD ou null", 
    "valor_total": "número ou null",
    "classificacao_despesa": "uma das categorias acima ou null"
}

RESPOSTA: Retorne APENAS o JSON válido, sem comentários, explicações ou formatação markdown.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text().replace(/```json|```/g, '').trim();

        // Extrai apenas o JSON da resposta
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            text = jsonMatch[0];
        }

        const extractedData = JSON.parse(text);
        console.log('✅ Dados processados com sucesso pelo Gemini');

        return extractedData;
    } catch (error) {
        console.error('❌ Erro no processamento Gemini:', error);
        throw new Error(`Falha no processamento IA: ${error.message}`);
    }
}

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

        // Extrai texto do PDF
        const extractedText = await extractTextFromPDF(req.file.buffer);

        if (!extractedText || extractedText.length < 50) {
            throw new Error('Texto extraído do PDF é muito curto ou vazio. Verifique se o PDF não está corrompido.');
        }

        // Processa com Gemini
        const extractedData = await processWithGemini(extractedText);

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`🎉 Processamento concluído em ${totalTime}s`);

        res.json({
            success: true,
            method: 'pdf_text_extraction',
            data: extractedData,
            metadata: {
                filename: req.file.originalname,
                fileSize: req.file.size,
                textLength: extractedText.length,
                processingTime: `${totalTime}s`,
                timestamp: new Date().toISOString()
            },
            debug: {
                textPreview: extractedText.substring(0, 300) + '...'
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
        categories: CATEGORIAS_DESPESAS,
        timestamp: new Date().toISOString()
    });
});

// Rota para listar categorias de despesas
app.get('/categories', (req, res) => {
    res.json({
        success: true,
        categories: CATEGORIAS_DESPESAS.map((cat, index) => ({
            id: index + 1,
            name: cat,
            examples: getCategoryExamples(cat)
        }))
    });
});

// Função auxiliar para exemplos de categorias
function getCategoryExamples(category) {
    const examples = {
        'INSUMOS AGRÍCOLAS': ['Sementes', 'Fertilizantes', 'Defensivos Agrícolas', 'Corretivos'],
        'MANUTENÇÃO E OPERAÇÃO': ['Combustíveis', 'Lubrificantes', 'Peças', 'Manutenção de Máquinas'],
        'RECURSOS HUMANOS': ['Mão de Obra Temporária', 'Salários e Encargos'],
        'SERVIÇOS OPERACIONAIS': ['Frete', 'Transporte', 'Colheita Terceirizada'],
        'INFRAESTRUTURA E UTILIDADES': ['Energia Elétrica', 'Arrendamento', 'Construções'],
        'ADMINISTRATIVAS': ['Honorários Contábeis', 'Despesas Bancárias'],
        'SEGUROS E PROTEÇÃO': ['Seguro Agrícola', 'Seguro de Ativos'],
        'IMPOSTOS E TAXAS': ['ITR', 'IPTU', 'IPVA', 'INCRA-CCIR'],
        'INVESTIMENTOS': ['Máquinas', 'Implementos', 'Veículos', 'Imóveis']
    };

    return examples[category] || [];
}

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'Arquivo muito grande. Máximo 15MB permitido para PDFs.'
            });
        }
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
    console.log(`📄 Formatos: PDF`);
    console.log(`📊 Categorias: ${CATEGORIAS_DESPESAS.length} disponíveis`);
    console.log('='.repeat(60));

    if (!process.env.GEMINI_API_KEY) {
        console.log('⚠️  ATENÇÃO: Configure a API key do Gemini no arquivo .env');
        console.log('   GEMINI_API_KEY=sua_chave_aqui');
    }
});