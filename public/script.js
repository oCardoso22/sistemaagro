const fileInput = document.getElementById('invoice-file');
const fileNameSpan = document.getElementById('file-name');
const extractButton = document.getElementById('extract-button');
const resultContainer = document.getElementById('result-container');
const jsonOutput = document.getElementById('json-output');
const copyButton = document.getElementById('copy-button');
const messageP = document.getElementById('message');

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
        fileNameSpan.textContent = fileInput.files[0].name;
        extractButton.disabled = false;
    } else {
        fileNameSpan.textContent = 'Nenhum arquivo escolhido';
        extractButton.disabled = true;
    }
    resultContainer.style.display = 'none';
    messageP.textContent = '';
});

extractButton.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) {
        alert('Por favor, selecione um arquivo.');
        return;
    }

    const formData = new FormData();
    formData.append('invoice', file);

    messageP.textContent = 'Extraindo dados...';
    extractButton.disabled = true;

    try {
        const response = await fetch('/extract-data', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            jsonOutput.textContent = JSON.stringify(data, null, 2);
            resultContainer.style.display = 'block';
            messageP.textContent = 'Dados extraídos com sucesso!';
        } else {
            messageP.textContent = `Erro: ${data.error}`;
        }

    } catch (error) {
        console.error('Erro na requisição:', error);
        messageP.textContent = 'Erro ao se conectar com o servidor.';
    } finally {
        extractButton.disabled = false;
    }
});

copyButton.addEventListener('click', () => {
    navigator.clipboard.writeText(jsonOutput.textContent)
        .then(() => {
            alert('JSON copiado para a área de transferência!');
        })
        .catch(err => {
            console.error('Erro ao copiar texto: ', err);
        });
});