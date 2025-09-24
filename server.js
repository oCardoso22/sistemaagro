const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

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

// Função para processar PDF diretamente com Gemini
async function processPDFWithGemini(pdfBuffer) {
    try {
        console.log('🤖 Processando PDF diretamente com Gemini...');

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `Você é um especialista em análise de notas fiscais brasileiras (NFe). Analise este documento PDF de uma nota fiscal e extraia EXATAMENTE os seguintes dados em formato JSON válido.

INSTRUÇÕES CRÍTICAS:
- Use 'null' se a informação não for encontrada
- Para datas, use formato YYYY-MM-DD
- Para valores monetários, use apenas números (sem R$ e vírgulas, use somente ponto para separador para casas decimais)
- Para CNPJ/CPF, mantenha apenas números
- Para classificação de despesa, analise os produtos/serviços e escolha UMA categoria mais adequada

ATENÇÃO ESPECIAL - NÃO CONFUNDA ESTES CAMPOS:
- NÚMERO DA NOTA FISCAL: Aparece como "NF-e N°:" ou "N°:" seguido de números (exemplo: "000.207.590")
- CNPJ DO FORNECEDOR: Formato XX.XXX.XXX/XXXX-XX (exemplo: "18.944.113/0002-91") - geralmente na seção do emitente/fornecedor
- CNPJ/CPF DO DESTINATÁRIO: Na seção "DESTINATÁRIO/REMETENTE"

ESTRUTURA TÍPICA DE UMA NFe:
1. CABEÇALHO: Contém o número da NFe (N°:)
2. EMITENTE/FORNECEDOR: Razão social, CNPJ do fornecedor
3. DESTINATÁRIO: Nome e CNPJ/CPF de quem recebe
4. PRODUTOS/SERVIÇOS: Descrição e valores
5. TOTAIS: Valor total da nota

CATEGORIAS DE DESPESAS DISPONÍVEIS:
${CATEGORIAS_DESPESAS.map((cat, index) => `${index + 1}. ${cat}`).join('\n')}

FORMATO DE RESPOSTA (JSON):
{
    "fornecedor": {
        "razao_social": "string ou null (nome da empresa emitente)",
        "fantasia": "string ou null (nome fantasia se houver)", 
        "cnpj": "apenas números ou null (CNPJ da empresa EMITENTE/FORNECEDORA)"
    },
    "faturado": {
        "nome_completo": "string ou null (nome do DESTINATÁRIO)",
        "cpf": "apenas números ou null (CPF/CNPJ do DESTINATÁRIO)"
    },
    "numero_nota_fiscal": "string ou null (número que aparece após 'N°:' ou 'NF-e N°:')",
    "data_emissao": "YYYY-MM-DD ou null",
    "descricao_produtos": "descrição detalhada dos produtos/serviços ou null",
    "quantidade_parcelas": 1,
    "data_vencimento": "YYYY-MM-DD ou null", 
    "valor_total": "número ou null (valor em centavos, ex: 344900 para R$ 3.449,00)",
    "classificacao_despesa": "uma das categorias acima ou null"
}

EXEMPLOS PARA EVITAR CONFUSÃO:
- Se vir "N°: 000.207.590", então numero_nota_fiscal = "000207590"
- Se vir CNPJ "18.944.113/0002-91" na seção do emitente, então fornecedor.cnpj = "18944113000291"
- Se vir CPF "709.046.011-88" na seção destinatário, então faturado.cpf = "70904601188"

RESPOSTA: Retorne APENAS o JSON válido, sem comentários, explicações ou formatação markdown.`;

        // Converte o buffer do PDF para base64
        const pdfBase64 = pdfBuffer.toString('base64');

        // Cria o objeto de arquivo para o Gemini
        const filePart = {
            inlineData: {
                data: pdfBase64,
                mimeType: 'application/pdf'
            }
        };

        const result = await model.generateContent([prompt, filePart]);
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

        // Processa PDF diretamente com Gemini
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
        categories: CATEGORIAS_DESPESAS,
        processing_method: 'Direct PDF to Gemini',
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
    console.log(`📄 Método: Processamento direto de PDF`);
    console.log(`📊 Categorias: ${CATEGORIAS_DESPESAS.length} disponíveis`);
    console.log('='.repeat(60));

    if (!process.env.GEMINI_API_KEY) {
        console.log('⚠️  ATENÇÃO: Configure a API key do Gemini no arquivo .env');
        console.log('   GEMINI_API_KEY=sua_chave_aqui');
    }
});