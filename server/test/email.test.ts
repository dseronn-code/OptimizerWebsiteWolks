import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { emailConfigured, sendEmail } from '../src/lib/email.js';

/** Simula o Web App do Google Apps Script: o POST executa e responde 302 para uma URL com o resultado. */
describe('envio de e-mail pelo Gmail (Google Apps Script)', () => {
  const received: any[] = [];
  let result = { ok: true };
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/exec') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.writeHead(302, { location: '/echo' });
        res.end();
      });
    } else if (req.method === 'GET' && req.url === '/echo') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(result));
    } else {
      res.writeHead(404).end();
    }
  });
  const saved = { ...config };

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, r));
    Object.assign(config, {
      EMAIL_PROVIDER: 'gmail_script',
      GMAIL_SCRIPT_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/exec`,
      GMAIL_SCRIPT_SECRET: 'segredo-teste',
    });
  });
  afterAll(() => {
    Object.assign(config, saved);
    server.close();
  });

  it('envia com o segredo e segue o redirecionamento do Google', async () => {
    expect(emailConfigured()).toBe(true);
    await sendEmail({ to: 'a@b.com', subject: 'Código', text: '123456', html: '<b>123456</b>' });
    expect(received[0]).toMatchObject({ secret: 'segredo-teste', to: 'a@b.com', subject: 'Código', text: '123456' });
  });

  it('erro do script vira falha clara', async () => {
    result = { ok: false, error: 'segredo inválido' } as any;
    await expect(sendEmail({ to: 'a@b.com', subject: 'x', text: 'x', html: 'x' })).rejects.toThrow(/segredo inválido/);
  });
});
