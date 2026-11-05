import type { z } from 'zod';
import { HttpError } from '../auth/guard.js';

/** Nomes dos campos como aparecem para quem usa o sistema. */
const FIELD: Record<string, string> = {
  username: 'Usuário', password: 'Senha', current: 'Senha atual', next: 'Nova senha', name: 'Nome', email: 'E-mail',
  code: 'Código', question: 'Pergunta', quantity: 'Quantidade', qty: 'Quantidade', customerName: 'Cliente', customer: 'Cliente',
  reason: 'Motivo', notes: 'Observações', hours: 'Horas', blingOrderId: 'Número do pedido', blingSellerId: 'Código do vendedor no Bling',
  role: 'Perfil', productId: 'Produto', depositId: 'Depósito', expiresAt: 'Validade', quantityDelivered: 'Quantidade entregue',
  quantityReleased: 'Quantidade liberada', allowedDomains: 'Domínios permitidos',
};

function fieldName(path: PropertyKey[]): string | null {
  const key = [...path].reverse().find((p) => typeof p === 'string') as string | undefined;
  if (!key) return null;
  return FIELD[key] ?? key;
}

/** Mensagem de validação em português do Brasil, sem jargão técnico. */
export function issueText(i: z.core.$ZodIssue): string {
  const field = fieldName(i.path);
  const iss = i as unknown as { code: string; origin?: string; minimum?: number | bigint; maximum?: number | bigint; input?: unknown; format?: string };
  let msg: string;
  switch (iss.code) {
    case 'too_small':
      msg = iss.origin === 'string' ? `precisa ter pelo menos ${iss.minimum} caractere${Number(iss.minimum) === 1 ? '' : 's'}`
        : iss.origin === 'array' ? 'precisa ter pelo menos um item'
        : `precisa ser no mínimo ${iss.minimum}`;
      if (iss.origin === 'number' && Number(iss.minimum) === 0) msg = 'precisa ser maior que zero';
      break;
    case 'too_big':
      msg = iss.origin === 'string' ? `pode ter no máximo ${iss.maximum} caracteres` : iss.origin === 'array' ? `pode ter no máximo ${iss.maximum} itens` : `pode ser no máximo ${iss.maximum}`;
      break;
    case 'invalid_type':
      if (iss.input === undefined || iss.input === null) return field ? `Preencha o campo ${field}.` : 'Há um campo obrigatório sem preencher.';
      msg = 'está em formato inválido';
      break;
    case 'invalid_format':
      msg = iss.format === 'email' ? 'não é um e-mail válido' : 'está em formato inválido';
      break;
    case 'invalid_value':
      msg = 'tem um valor não permitido';
      break;
    default:
      msg = 'é inválido';
  }
  return field ? `${field} ${msg}.` : `Dados inválidos: ${msg}.`;
}

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, [...new Set(r.error.issues.map(issueText))].join(' '));
  return r.data;
}
