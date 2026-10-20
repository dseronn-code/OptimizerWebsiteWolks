import { config, isProduction } from '../config.js';

/**
 * Envio de e-mails transacionais por API HTTPS (Brevo ou Resend).
 * SMTP não é usado porque várias hospedagens (ex.: Railway fora do plano Pro) bloqueiam as portas SMTP.
 * Em desenvolvimento, sem provedor configurado, o e-mail é apenas registrado no log ("console").
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type Transport = (msg: EmailMessage) => Promise<void>;

let testTransport: Transport | null = null;

/** Testes capturam as mensagens em vez de enviá-las. */
export function setEmailTransportForTests(t: Transport | null) {
  testTransport = t;
}

export function emailConfigured(): boolean {
  if (testTransport) return true;
  if (config.EMAIL_PROVIDER === 'brevo') return Boolean(config.BREVO_API_KEY && config.EMAIL_FROM);
  if (config.EMAIL_PROVIDER === 'resend') return Boolean(config.RESEND_API_KEY && config.EMAIL_FROM);
  // "console" só vale fora de produção (o código aparece no log do servidor)
  return !isProduction;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (testTransport) return testTransport(msg);
  const fromName = config.EMAIL_FROM_NAME;
  let res: Response;
  if (config.EMAIL_PROVIDER === 'brevo') {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.BREVO_API_KEY!, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: config.EMAIL_FROM, name: fromName },
        to: [{ email: msg.to }],
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } else if (config.EMAIL_PROVIDER === 'resend') {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: `${fromName} <${config.EMAIL_FROM}>`, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      signal: AbortSignal.timeout(15000),
    });
  } else {
    if (isProduction) throw new Error('Envio de e-mail não configurado (EMAIL_PROVIDER).');
    console.log(`\n[e-mail de desenvolvimento] para ${msg.to}\nAssunto: ${msg.subject}\n${msg.text}\n`);
    return;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Falha ao enviar e-mail (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function verificationEmail(name: string, code: string, minutes: number): Omit<EmailMessage, 'to'> {
  const app = config.EMAIL_FROM_NAME;
  return {
    subject: `${code} é o seu código de confirmação — ${app}`,
    text: `Olá, ${name}!\n\nSeu código para confirmar o cadastro no ${app} é: ${code}\n\nEle vale por ${minutes} minutos. Se você não pediu este cadastro, ignore este e-mail.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#0f172a">
  <div style="background:#060e35;color:#fff;padding:16px 20px;border-bottom:4px solid #294292;font-weight:bold">${escapeHtml(app)}</div>
  <div style="padding:20px">
    <p>Olá, ${escapeHtml(name)}!</p>
    <p>Use este código para confirmar o seu cadastro:</p>
    <p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#294292;margin:16px 0">${code}</p>
    <p style="color:#475569;font-size:13px">O código vale por ${minutes} minutos. Se você não pediu este cadastro, ignore este e-mail.</p>
  </div>
</div>`,
  };
}
