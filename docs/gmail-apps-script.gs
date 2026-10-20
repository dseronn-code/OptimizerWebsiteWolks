/**
 * ITCOMTECH Estoque — envio dos códigos de cadastro pelo seu Gmail.
 *
 * Como usar (passo a passo completo em docs/PUBLICAR.md):
 *  1. script.google.com → Novo projeto → apague tudo e cole este código.
 *  2. Troque SEGREDO abaixo por uma senha longa só sua (a mesma vai no Railway em GMAIL_SCRIPT_SECRET).
 *  3. Implantar → Nova implantação → tipo "App da Web" → Executar como: Eu → Quem pode acessar: Qualquer pessoa.
 *  4. Autorize o acesso ao Gmail e copie a URL do app da Web (termina em /exec) para GMAIL_SCRIPT_URL.
 */
const SEGREDO = 'TROQUE-POR-UMA-SENHA-LONGA';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (!data.secret || data.secret !== SEGREDO) return resposta({ ok: false, error: 'segredo inválido' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.to || '')) return resposta({ ok: false, error: 'destinatário inválido' });
    MailApp.sendEmail({
      to: data.to,
      subject: String(data.subject || '').slice(0, 200),
      body: String(data.text || ''),
      htmlBody: String(data.html || ''),
      name: String(data.name || 'ITCOMTECH Estoque'),
    });
    return resposta({ ok: true, restantesHoje: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return resposta({ ok: false, error: String(err) });
  }
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
