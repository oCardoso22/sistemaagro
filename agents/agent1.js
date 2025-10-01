const { GoogleGenerativeAI } = require('@google/generative-ai');

// O nome do modelo foi atualizado para uma versão estável e robusta.
const MODELO_GEMINI = "gemini-2.5-pro";

// Configuração do Google Gemini
// Assumimos que a variável de ambiente GEMINI_API_KEY foi carregada no arquivo principal.
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Categorias de despesas (mantidas aqui por serem parte integral da lógica do prompt)
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

/**
 * Função principal para processar um buffer de PDF diretamente com o Gemini.
 * @param {Buffer} pdfBuffer - O buffer de dados do arquivo PDF.
 * @returns {Promise<Object>} Os dados extraídos no formato JSON.
 */
async function processPDFWithGemini(pdfBuffer) {
    try {
        console.log(`🤖 Processando PDF diretamente com Gemini (${MODELO_GEMINI})...`);

        const model = genAI.getGenerativeModel({ model: MODELO_GEMINI });

        // O prompt inteiro com as instruções detalhadas
        const prompt = `Você é um especialista em análise de notas fiscais brasileiras (NFe). Analise este documento PDF de uma nota fiscal e extraia EXATAMENTE os seguintes dados em formato JSON válido.

INSTRUÇÕES CRÍTICAS:
- Use 'null' se a informação não for encontrada
- Para datas, use formato YYYY-MM-DD
- Para valores monetários, use apenas números (sem R$ e vírgulas, use somente ponto para separador para casas decimais, exemplo: 3012,00 vira 3012.00)
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

        // Cria o objeto de arquivo para o Gemini (é aqui que o PDF é enviado)
        const filePart = {
            inlineData: {
                data: pdfBase64,
                mimeType: 'application/pdf'
            }
        };

        const result = await model.generateContent([prompt, filePart]);
        const response = await result.response;
        let text = response.text().replace(/```json|```/g, '').trim();

        // Extrai apenas o JSON da resposta (Garante que só o JSON seja parseado)
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

// Função auxiliar para exemplos de categorias (mantida por ser útil ao agente ou rotas de informação)
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

// Exporta as funções e constantes necessárias para o server.js
module.exports = {
    processPDFWithGemini,
    MODELO_GEMINI,
    CATEGORIAS_DESPESAS,
    getCategoryExamples
};