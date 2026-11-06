/** Registro simples no log do servidor (aparece nos logs do Railway). Nunca registra conteúdo sensível. */
export function log(msg: string, err?: unknown) {
  if (process.env.NODE_ENV === 'test') return;
  const detail = err instanceof Error ? `: ${err.message}` : err ? `: ${String(err)}` : '';
  console.error(`[${new Date().toISOString()}] ${msg}${detail}`);
}
