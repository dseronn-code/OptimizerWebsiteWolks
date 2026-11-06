/**
 * Prévia visual do bot de WhatsApp: roda conversas de exemplo contra o banco local (demonstração),
 * captura as mensagens que o bot enviaria e gera um HTML no estilo do WhatsApp.
 * Uso: npx tsx scripts/whatsapp-preview.ts <arquivo-saida.html> <telefone-de-um-usuario-demo>
 * Não chama a Meta e não envia nada.
 */
import { writeFileSync } from 'node:fs';
import { pool } from '../src/db/pool.js';
import { setWhatsAppTransportForTests } from '../src/whatsapp/api.js';
import { handleIncoming } from '../src/whatsapp/bot.js';

const [out, phone] = process.argv.slice(2);
if (!out || !phone) throw new Error('uso: whatsapp-preview.ts <saida.html> <telefone>');

type Bubble = { from: 'user' | 'bot'; html: string; buttons?: string[]; list?: { button: string; rows: { title: string; description?: string }[] } };
const bubbles: Bubble[] = [];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wa = (s: string) =>
  esc(s)
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<i>$2</i>')
    .replace(/\n/g, '<br>');

setWhatsAppTransportForTests(async (p: any) => {
  if (p.type === 'text') bubbles.push({ from: 'bot', html: wa(p.text.body) });
  else if (p.type === 'interactive' && p.interactive.type === 'button')
    bubbles.push({ from: 'bot', html: wa(p.interactive.body.text), buttons: p.interactive.action.buttons.map((b: any) => b.reply.title) });
  else if (p.type === 'interactive' && p.interactive.type === 'list')
    bubbles.push({ from: 'bot', html: wa(p.interactive.body.text), list: { button: p.interactive.action.button, rows: p.interactive.action.sections[0].rows } });
  return { ok: true, status: 200, body: {} };
});

let n = 0;
async function say(text: string, show = text) {
  bubbles.push({ from: 'user', html: esc(show) });
  await handleIncoming({ id: `preview.${Date.now()}.${++n}`, from: phone, type: 'text', text });
}
async function tap(id: string, label: string) {
  bubbles.push({ from: 'user', html: esc(label) });
  await handleIncoming({ id: `preview.${Date.now()}.${++n}`, from: phone, type: 'interactive', replyId: id, replyTitle: label });
}

const conversations: { title: string; steps: () => Promise<void> }[] = [
  { title: 'Boas-vindas e menu', steps: async () => { await say('oi'); } },
  { title: 'Consulta de produto', steps: async () => { await say('quanto tem do teclado?'); } },
  { title: 'Posso vender?', steps: async () => { await say('consigo vender 20 GAV-3?'); await say('consigo vender 10 cabo hdmi?'); } },
  {
    title: 'Reserva em uma mensagem',
    steps: async () => {
      await say('reservar 5 MES-120 para Construtora Alfa');
      await tap('ok', '✅ Confirmar');
    },
  },
  { title: 'Lista de disponíveis', steps: async () => { await tap('m:disponiveis', '✅ Disponíveis'); } },
  {
    title: 'Solicitação de compra',
    steps: async () => {
      await say('solicitar compra 30 CAD-GAM');
      await tap('skip', 'Sem cliente');
      await say('Urgente, cliente aguardando');
      await tap('ok', '✅ Enviar');
    },
  },
];

const sections: string[] = [];
for (const conv of conversations) {
  bubbles.length = 0;
  await pool.query("DELETE FROM whatsapp_sessions WHERE wa_id = $1", [phone]);
  await conv.steps();
  const body = bubbles
    .map((b) => {
      const extra = b.buttons
        ? `<div class="btns">${b.buttons.map((t) => `<div class="btn">${esc(t)}</div>`).join('')}</div>`
        : b.list
          ? `<div class="btns"><div class="btn">☰ ${esc(b.list.button)}</div></div><div class="sheet">${b.list.rows.map((r) => `<div class="row"><div class="rt">${esc(r.title)}</div>${r.description ? `<div class="rd">${esc(r.description)}</div>` : ''}</div>`).join('')}</div>`
          : '';
      return `<div class="msg ${b.from}"><div class="bubble">${b.html}<span class="time">10:4${n % 10} ${b.from === 'user' ? '<span class="tick">✓✓</span>' : ''}</span></div>${extra}</div>`;
    })
    .join('');
  sections.push(`<section class="phone"><div class="cap">${esc(conv.title)}</div><header><div class="av">IT</div><div><div class="name">ITCOMTECH Estoque</div><div class="sub">conta comercial</div></div></header><div class="chat">${body}</div></section>`);
}

writeFileSync(
  out,
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Prévia do bot</title><style>
  body{margin:0;background:#0b141a;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:24px;display:flex;flex-wrap:wrap;gap:24px;justify-content:center}
  .phone{width:380px;border-radius:28px;overflow:hidden;background:#efeae2;box-shadow:0 20px 60px rgba(0,0,0,.5);display:flex;flex-direction:column;position:relative}
  .cap{position:absolute;top:-1px;right:12px;background:#25d366;color:#04331a;font-size:11px;font-weight:700;padding:3px 10px;border-radius:0 0 10px 10px}
  header{background:#008069;color:#fff;display:flex;align-items:center;gap:10px;padding:14px 14px 12px}
  .av{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#3a55a8,#060e35);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px}
  .name{font-weight:600;font-size:15px}.sub{font-size:12px;opacity:.8}
  .chat{padding:12px 10px 16px;display:flex;flex-direction:column;gap:6px;background-image:radial-gradient(rgba(0,0,0,.035) 1px,transparent 1px);background-size:14px 14px;flex:1}
  .msg{display:flex;flex-direction:column;max-width:86%}.msg.user{align-self:flex-end}.msg.bot{align-self:flex-start}
  .bubble{font-size:14px;line-height:1.38;color:#111b21;padding:6px 8px 18px;border-radius:8px;position:relative;box-shadow:0 1px .5px rgba(0,0,0,.13);word-wrap:break-word}
  .user .bubble{background:#d9fdd3;border-top-right-radius:2px}.bot .bubble{background:#fff;border-top-left-radius:2px}
  .time{position:absolute;right:7px;bottom:3px;font-size:10.5px;color:#667781}.tick{color:#53bdeb}
  .btns{display:flex;flex-direction:column;gap:2px;margin-top:2px}
  .btn{background:#fff;color:#027eb5;text-align:center;font-size:14px;padding:9px;border-radius:8px;box-shadow:0 1px .5px rgba(0,0,0,.13)}
  .sheet{margin-top:6px;background:#fff;border-radius:10px;box-shadow:0 1px .5px rgba(0,0,0,.13);padding:4px 0}
  .row{padding:7px 12px;border-bottom:1px solid #f0f2f5}.row:last-child{border:0}.rt{font-size:14px;color:#111b21}.rd{font-size:12px;color:#667781}
  </style></head><body>${sections.join('')}</body></html>`,
);
await pool.end();
console.log(`prévia gerada: ${out}`);
