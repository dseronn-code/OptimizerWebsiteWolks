/**
 * Números de WhatsApp: guardados só com dígitos, no formato internacional (ex.: 5511987654321).
 */

/** Converte o que o administrador digitar ("(11) 98765-4321", "+55 11 98765-4321"…) para dígitos com DDI. */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (!d) return null;
  d = d.replace(/^00/, ''); // 0055…
  if (d.startsWith('0')) d = d.replace(/^0+/, ''); // 011…
  // número brasileiro sem DDI (DDD + 8 ou 9 dígitos)
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 10 || d.length > 15) return null;
  if (d.startsWith('55') && !(d.length === 12 || d.length === 13)) return null;
  return d;
}

/**
 * Variações do mesmo número brasileiro. O WhatsApp às vezes identifica celulares antigos sem o 9
 * depois do DDD (5511 8765-4321 em vez de 5511 98765-4321); os dois precisam ser reconhecidos.
 */
export function phoneVariants(waId: string): string[] {
  const d = waId.replace(/\D/g, '');
  const out = new Set([d]);
  if (d.startsWith('55')) {
    if (d.length === 13 && d[4] === '9') out.add(d.slice(0, 4) + d.slice(5));
    if (d.length === 12) out.add(`${d.slice(0, 4)}9${d.slice(4)}`);
  }
  return [...out];
}

/** Mostra o número de forma legível: +55 (11) 98765-4321. */
export function formatPhone(d: string | null | undefined): string {
  if (!d) return '—';
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    return `+55 (${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
  }
  return `+${d}`;
}
