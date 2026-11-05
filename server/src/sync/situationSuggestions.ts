import { pool } from '../db/pool.js';
import { normalize } from '../lib/text.js';

/**
 * Sugestão automática de regras para as situações de pedido do Bling, pelo nome
 * (situações personalizadas usam o nome da situação de origem, se houver).
 * Abordagem conservadora: na dúvida, o pedido PRENDE estoque (nunca superestima o disponível).
 * Só preenche situações SEM regra — regras já configuradas não são alteradas.
 */

type Rule = { category: string; stockEffect: string; virtualEffect: string; label: string };

const PATTERNS: [RegExp, Rule][] = [
  [/cancel/, { category: 'CANCELLED', stockEffect: 'NOT_POSTED', virtualEffect: 'NOT_REFLECTED', label: 'Cancelado: libera o estoque' }],
  [/^atendid|entregue|faturad|conclu|finaliz|despachad|enviad/, { category: 'FULFILLED', stockEffect: 'POSTED', virtualEffect: 'REFLECTED', label: 'Atendido: estoque já baixado no Bling' }],
  [/digita|orcament|cotac|propost|rascunho/, { category: 'OPPORTUNITY', stockEffect: 'NOT_POSTED', virtualEffect: 'NOT_REFLECTED', label: 'Orçamento/rascunho: não prende estoque' }],
  [/aberto|andamento|verificad|separ|aguard|pago|aprovad|confirmad|pendente|produc|retirad|transport/, { category: 'COMMITTED', stockEffect: 'NOT_POSTED', virtualEffect: 'REFLECTED', label: 'Venda em aberto: prende estoque até ser atendida' }],
];

export function suggestRule(name: string): Rule | null {
  const n = normalize(name);
  for (const [re, rule] of PATTERNS) if (re.test(n)) return rule;
  return null;
}

export async function applySuggestedRules(userId: string) {
  const { rows } = await pool.query<{ id: number; name: string; inherited_name: string | null }>(
    `SELECT s.id, s.name, hs.name AS inherited_name FROM situations s
     LEFT JOIN situations hs ON hs.id = s.inherited_id
     LEFT JOIN situation_rules r ON r.situation_id = s.id
     WHERE r.situation_id IS NULL`,
  );
  const applied: { id: number; name: string; category: string; label: string }[] = [];
  const skipped: { id: number; name: string }[] = [];
  for (const s of rows) {
    const rule = suggestRule(s.name) ?? (s.inherited_name ? suggestRule(s.inherited_name) : null);
    if (!rule) {
      skipped.push({ id: s.id, name: s.name });
      continue;
    }
    await pool.query(
      `INSERT INTO situation_rules (situation_id, category, stock_effect, virtual_effect, label, notes, updated_by)
       VALUES ($1, $2, $3, $4, $5, 'Sugestão automática pelo nome da situação — revise se a empresa usa de outro jeito.', $6)
       ON CONFLICT (situation_id) DO NOTHING`,
      [s.id, rule.category, rule.stockEffect, rule.virtualEffect, rule.label, userId],
    );
    applied.push({ id: s.id, name: s.name, category: rule.category, label: rule.label });
  }
  return { applied, skipped };
}
