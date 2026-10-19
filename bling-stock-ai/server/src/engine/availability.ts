import type {
  AvailabilityResult,
  DeductionBucket,
  Deductions,
  DepositAvailability,
  DepositBalance,
  EngineInput,
  ExplanationLine,
  Issue,
  LocalReservation,
  OrderCommitment,
  SaleCheck,
} from './types.js';

/**
 * Motor de disponibilidade — regra fundamental:
 *
 *   disponível = saldo-base − compromissos que o saldo-base AINDA NÃO reflete
 *
 * Cada compromisso é classificado uma única vez em uma das situações:
 *   - já refletido no saldo-base (ALREADY_IN_BASE) → não subtrai novamente;
 *   - ainda não refletido (SUBTRACTED) → subtrai a quantidade pendente;
 *   - sem efeito sobre a disponibilidade (NOT_COUNTED);
 *   - reserva local substituída pelo pedido vinculado do Bling (SUPERSEDED).
 *
 * Quando não é possível saber se um compromisso já está no saldo, ele é subtraído
 * por precaução e a disponibilidade fica "não confirmada".
 */

const EPS = 1e-9;

export function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function emptyDeductions(): Deductions {
  return { committedOrders: 0, preOrderReservations: 0, localReservations: 0, blocked: 0, uncertain: 0 };
}

function sumDeductions(d: Deductions): number {
  return round(d.committedOrders + d.preOrderReservations + d.localReservations + d.blocked + d.uncertain);
}

function normalizeName(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

type InBase = 'YES' | 'NO' | 'UNKNOWN';

/** O saldo-base escolhido já reflete a saída deste pedido? */
function commitmentInBase(c: OrderCommitment, mode: EngineInput['settings']['baseMode']): InBase {
  if (c.stockEffect === 'POSTED') return 'YES'; // baixa física reflete em ambos os saldos
  if (mode === 'PHYSICAL') return c.stockEffect === 'NOT_POSTED' ? 'NO' : 'UNKNOWN';
  if (c.virtualEffect === 'REFLECTED') return 'YES';
  if (c.virtualEffect === 'NOT_REFLECTED') return 'NO';
  return 'UNKNOWN';
}

const ACTIVE_ORDER_CATEGORIES = new Set(['COMMITTED', 'PRE_ORDER_RESERVED', 'UNMAPPED']);

function orderLabel(c: OrderCommitment): string {
  const n = c.orderNumber ?? c.orderId;
  return `Pedido ${n}${c.situationName ? ` (${c.situationName})` : ''}`;
}

export function calculateAvailability(input: EngineInput): AvailabilityResult {
  const { settings, now } = input;
  const issues: Issue[] = [];
  const lines: ExplanationLine[] = [];

  // ------------------------------------------------------------------ depósitos
  const balances = input.balances;
  const counted = balances.filter((b) => !b.ignoreBalance);
  const defaultDeposit: DepositBalance | undefined =
    counted.find((b) => b.isDefault) ?? counted[0] ?? balances[0];

  const depositMap = new Map<number, DepositBalance>(balances.map((b) => [b.depositId, b]));

  function resolveDeposit(depositId: number | null): { id: number | null; assumed: boolean; ignored: boolean } {
    if (depositId !== null && depositMap.has(depositId)) {
      return { id: depositId, assumed: false, ignored: depositMap.get(depositId)!.ignoreBalance };
    }
    // Depósito não informado (o pedido de venda do Bling v3 não traz depósito):
    // atribui ao depósito padrão para a visão por depósito; o total não é afetado.
    return { id: defaultDeposit?.depositId ?? null, assumed: true, ignored: false };
  }

  const perDeposit = new Map<number, Deductions>();
  const totals = emptyDeductions();
  let anyAssumedDeposit = false;

  function addDeduction(depositId: number | null, bucket: DeductionBucket, qty: number) {
    totals[bucket] = round(totals[bucket] + qty);
    if (depositId === null) return;
    const d = perDeposit.get(depositId) ?? emptyDeductions();
    d[bucket] = round(d[bucket] + qty);
    perDeposit.set(depositId, d);
  }

  function baseLine(partial: Partial<ExplanationLine> & Pick<ExplanationLine, 'kind' | 'refId' | 'label' | 'quantity'>): ExplanationLine {
    return {
      depositId: null,
      depositAssumed: false,
      subtracted: 0,
      treatment: 'NOT_COUNTED',
      bucket: null,
      reason: '',
      customerName: null,
      sellerId: null,
      sellerUserId: null,
      situationName: null,
      orderNumber: null,
      orderId: null,
      expiresAt: null,
      uncertain: false,
      ...partial,
    };
  }

  // ------------------------------------------------------------------ pedidos do Bling
  let opportunitiesTotal = 0;
  /** Pedidos (por id) que efetivamente representam compromisso para este produto. */
  const activeOrderIds = new Set<number>();
  const cancelledOrderIds = new Set<number>();
  const committedCustomers = new Map<string, string>(); // chave cliente -> rótulo do pedido
  const customerKeys = (id: number | null, name: string | null): string[] => {
    const keys: string[] = [];
    if (id !== null) keys.push(`id:${id}`);
    const n = normalizeName(name);
    if (n) keys.push(`nome:${n}`);
    return keys;
  };

  for (const c of input.commitments) {
    const dep = resolveDeposit(c.depositId);
    const common = {
      kind: 'ORDER' as const,
      refId: `order:${c.orderId}:item:${c.itemId}`,
      label: orderLabel(c),
      quantity: c.quantity,
      depositId: dep.id,
      depositAssumed: dep.assumed,
      customerName: c.customerName,
      sellerId: c.sellerId,
      situationName: c.situationName,
      orderNumber: c.orderNumber,
      orderId: c.orderId,
    };
    const outstanding = Math.max(0, round(c.quantity - c.quantityDelivered - c.quantityReleased));

    if (c.category === 'OPPORTUNITY') {
      opportunitiesTotal = round(opportunitiesTotal + outstanding);
      lines.push(baseLine({ ...common, reason: 'Oportunidade/cotação sem reserva autorizada — não reduz a disponibilidade.' }));
      continue;
    }
    if (c.category === 'CANCELLED') {
      cancelledOrderIds.add(c.orderId);
      lines.push(baseLine({ ...common, reason: 'Pedido cancelado — compromisso liberado.' }));
      if (c.previouslyPosted) {
        issues.push({
          code: 'CANCELLED_AFTER_POSTING',
          severity: 'warning',
          blocksConfirmation: false,
          refId: common.refId,
          message: `${common.label}: cancelado após ter a baixa de estoque registrada. Verifique se o estorno foi lançado no Bling.`,
        });
      }
      continue;
    }
    if (c.category === 'IGNORED') {
      lines.push(baseLine({ ...common, reason: 'Situação configurada para ser ignorada no cálculo.' }));
      continue;
    }
    if (dep.ignored) {
      lines.push(baseLine({ ...common, reason: 'Pedido vinculado a depósito que não compõe a disponibilidade.' }));
      continue;
    }

    const inBase = commitmentInBase(c, settings.baseMode);

    if (c.category === 'FULFILLED') {
      // Atendido: mercadoria já saiu. Só precisa subtrair se a baixa NÃO foi registrada.
      if (inBase === 'YES') {
        lines.push(baseLine({ ...common, treatment: 'ALREADY_IN_BASE', reason: 'Pedido atendido com baixa já refletida no saldo — não é subtraído novamente.' }));
        continue;
      }
      const qty = Math.max(0, round(c.quantity - c.quantityReleased));
      const uncertain = inBase === 'UNKNOWN';
      addDeduction(dep.id, uncertain ? 'uncertain' : 'committedOrders', qty);
      if (dep.assumed) anyAssumedDeposit = true;
      lines.push(baseLine({
        ...common,
        subtracted: qty,
        treatment: 'SUBTRACTED',
        bucket: uncertain ? 'uncertain' : 'committedOrders',
        uncertain,
        reason: uncertain
          ? 'Pedido atendido sem confirmação da baixa — subtraído por precaução.'
          : 'Pedido atendido sem baixa registrada no Bling — mercadoria já saiu e ainda consta no saldo.',
      }));
      issues.push({
        code: uncertain ? 'UNKNOWN_STOCK_EFFECT' : 'PARTIAL_DELIVERY_NOT_POSTED',
        severity: 'warning',
        blocksConfirmation: uncertain,
        refId: common.refId,
        message: `${common.label}: atendido sem baixa de estoque confirmada.`,
      });
      continue;
    }

    // Compromissos ativos: COMMITTED, PRE_ORDER_RESERVED, UNMAPPED
    activeOrderIds.add(c.orderId);
    for (const key of customerKeys(c.customerId, c.customerName)) committedCustomers.set(key, common.label);

    if (c.category === 'UNMAPPED') {
      issues.push({
        code: 'UNMAPPED_SITUATION',
        severity: 'warning',
        blocksConfirmation: true,
        refId: common.refId,
        message: `${common.label}: situação sem regra configurada — tratado como compromisso por precaução.`,
      });
    }

    if (inBase === 'YES') {
      lines.push(baseLine({
        ...common,
        treatment: 'ALREADY_IN_BASE',
        reason:
          settings.baseMode === 'PHYSICAL' || c.stockEffect === 'POSTED'
            ? 'Baixa de estoque já efetuada — a quantidade já foi retirada do saldo e não é subtraída novamente.'
            : 'Pedido já descontado no saldo virtual do Bling — não é subtraído novamente.',
      }));
      continue;
    }

    const uncertain = inBase === 'UNKNOWN' || c.category === 'UNMAPPED';
    const bucket: DeductionBucket = uncertain
      ? 'uncertain'
      : c.category === 'PRE_ORDER_RESERVED'
        ? 'preOrderReservations'
        : 'committedOrders';

    let qty = outstanding;
    let reason =
      c.category === 'PRE_ORDER_RESERVED'
        ? 'Pré-pedido com reserva autorizada ainda não refletida no saldo.'
        : 'Pedido confirmado/pago ainda não baixado do estoque.';
    if (c.quantityDelivered > EPS || c.quantityReleased > EPS) {
      reason += ` Pendente: ${outstanding} de ${c.quantity} (entregue ${c.quantityDelivered}, liberado ${c.quantityReleased}).`;
    }
    if (c.quantityDelivered > EPS && !c.deliveredStockPosted) {
      // Entrega parcial sem baixa: as unidades saíram fisicamente mas ainda constam no saldo.
      qty = round(qty + c.quantityDelivered);
      reason += ' Unidades entregues sem baixa registrada também são subtraídas.';
      issues.push({
        code: 'PARTIAL_DELIVERY_NOT_POSTED',
        severity: 'warning',
        blocksConfirmation: false,
        refId: common.refId,
        message: `${common.label}: ${c.quantityDelivered} unidade(s) entregue(s) sem baixa no Bling.`,
      });
    }
    if (uncertain && c.category !== 'UNMAPPED') {
      reason += ' Não foi possível determinar se a baixa já ocorreu — subtraído por precaução.';
      issues.push({
        code: 'UNKNOWN_STOCK_EFFECT',
        severity: 'warning',
        blocksConfirmation: true,
        refId: common.refId,
        message: `${common.label}: não é possível determinar se o estoque já foi baixado.`,
      });
    }
    if (qty > EPS) {
      addDeduction(dep.id, bucket, qty);
      if (dep.assumed) anyAssumedDeposit = true;
    }
    lines.push(baseLine({ ...common, subtracted: qty, treatment: qty > EPS ? 'SUBTRACTED' : 'NOT_COUNTED', bucket: qty > EPS ? bucket : null, uncertain, reason }));
  }

  // ------------------------------------------------------------------ reservas locais
  for (const r of input.reservations) {
    const dep = resolveDeposit(r.depositId);
    const common = {
      kind: 'RESERVATION' as const,
      refId: `reservation:${r.id}`,
      label: `Reserva ${r.id.slice(0, 8)}${r.customerName ? ` — ${r.customerName}` : ''}`,
      quantity: r.quantity,
      depositId: dep.id,
      depositAssumed: dep.assumed,
      customerName: r.customerName,
      sellerUserId: r.sellerUserId,
      orderId: r.blingOrderId,
      expiresAt: r.expiresAt.toISOString(),
    };
    const effectiveStatus = reservationEffectiveStatus(r, now);

    if (effectiveStatus === 'PENDING') {
      opportunitiesTotal = round(opportunitiesTotal + r.quantity);
      lines.push(baseLine({ ...common, reason: 'Reserva solicitada aguardando aprovação — ainda não reduz a disponibilidade.' }));
      continue;
    }
    if (effectiveStatus === 'EXPIRED') {
      if (settings.expiredReservationPolicy === 'AUTO_RELEASE') {
        lines.push(baseLine({ ...common, reason: 'Reserva expirada — liberada automaticamente conforme a regra configurada.' }));
        continue;
      }
      issues.push({
        code: 'EXPIRED_RESERVATION',
        severity: 'warning',
        blocksConfirmation: false,
        refId: common.refId,
        message: `${common.label}: reserva vencida aguardando renovação ou liberação pelo gestor (mantida no cálculo).`,
      });
    } else if (effectiveStatus !== 'ACTIVE') {
      continue; // canceladas, rejeitadas, liberadas, convertidas: sem efeito
    }
    if (dep.ignored) {
      lines.push(baseLine({ ...common, reason: 'Reserva em depósito que não compõe a disponibilidade.' }));
      continue;
    }

    // Reserva vinculada a pedido do Bling: o pedido passa a ser a fonte do compromisso.
    if (r.blingOrderId !== null) {
      if (activeOrderIds.has(r.blingOrderId) || input.commitments.some((c) => c.orderId === r.blingOrderId && c.category === 'FULFILLED')) {
        lines.push(baseLine({
          ...common,
          treatment: 'SUPERSEDED',
          reason: `Reserva vinculada ao pedido ${r.blingOrderId} do Bling — contabilizada uma única vez pelo pedido.`,
        }));
        continue;
      }
      if (cancelledOrderIds.has(r.blingOrderId)) {
        issues.push({
          code: 'CANCELLED_WITH_ACTIVE_RESERVATION',
          severity: 'warning',
          blocksConfirmation: false,
          refId: common.refId,
          message: `${common.label}: o pedido vinculado foi cancelado, mas a reserva continua ativa (mantida até revisão).`,
        });
      }
    } else {
      const key = customerKeys(r.customerId, r.customerName).find((k) => committedCustomers.has(k));
      if (key) {
        issues.push({
          code: 'POSSIBLE_DUPLICATE',
          severity: 'warning',
          blocksConfirmation: true,
          refId: common.refId,
          message: `${common.label}: o mesmo cliente possui ${committedCustomers.get(key)} para este produto e a reserva não está vinculada ao pedido. Possível desconto duplicado.`,
        });
      }
    }

    addDeduction(dep.id, 'localReservations', r.quantity);
    if (dep.assumed) anyAssumedDeposit = true;
    lines.push(baseLine({
      ...common,
      subtracted: r.quantity,
      treatment: 'SUBTRACTED',
      bucket: 'localReservations',
      reason:
        effectiveStatus === 'EXPIRED'
          ? 'Reserva vencida mantida até revisão do gestor.'
          : r.blingOrderId !== null && !cancelledOrderIds.has(r.blingOrderId)
            ? `Reserva autorizada (pedido ${r.blingOrderId} ainda não sincronizado para este produto).`
            : 'Reserva autorizada no módulo complementar.',
    }));
  }

  // ------------------------------------------------------------------ bloqueios
  for (const b of input.blocks) {
    const dep = resolveDeposit(b.depositId);
    const common = {
      kind: 'BLOCK' as const,
      refId: `block:${b.id}`,
      label: `Bloqueio — ${blockLabel(b.reasonType)}`,
      quantity: b.quantity,
      depositId: dep.id,
      depositAssumed: dep.assumed,
    };
    if (dep.ignored) {
      lines.push(baseLine({ ...common, reason: 'Bloqueio em depósito que não compõe a disponibilidade.' }));
      continue;
    }
    addDeduction(dep.id, 'blocked', b.quantity);
    if (dep.assumed) anyAssumedDeposit = true;
    lines.push(baseLine({ ...common, subtracted: b.quantity, treatment: 'SUBTRACTED', bucket: 'blocked', reason: b.notes ?? 'Mercadoria indisponível por decisão operacional.' }));
  }

  if (anyAssumedDeposit && counted.length > 1) {
    issues.push({
      code: 'DEPOSIT_ASSUMED',
      severity: 'info',
      blocksConfirmation: false,
      message: `Alguns compromissos não informam depósito e foram atribuídos ao depósito padrão (${defaultDeposit?.depositName}) na visão por depósito. O total não é afetado.`,
    });
  }

  // ------------------------------------------------------------------ saldos e totais
  const byDeposit: DepositAvailability[] = balances.map((b) => {
    const d = perDeposit.get(b.depositId) ?? emptyDeductions();
    const base = settings.baseMode === 'PHYSICAL' ? b.physical : b.virtual;
    const available = base === null ? null : round(base - sumDeductions(d));
    return {
      depositId: b.depositId,
      depositName: b.depositName,
      ignored: b.ignoreBalance,
      physical: b.physical,
      virtual: b.virtual,
      base,
      deductions: d,
      available,
      availableForSale: available === null ? 0 : Math.max(0, available),
      fetchedAt: b.fetchedAt ? b.fetchedAt.toISOString() : null,
    };
  });

  let physicalTotal: number | null = null;
  let virtualTotal: number | null = null;
  let base: number | null = null;
  let oldest: Date | null = null;
  let missing = false;
  for (const b of counted) {
    if (b.physical !== null) physicalTotal = round((physicalTotal ?? 0) + b.physical);
    if (b.virtual !== null) virtualTotal = round((virtualTotal ?? 0) + b.virtual);
    const v = settings.baseMode === 'PHYSICAL' ? b.physical : b.virtual;
    if (v === null || b.fetchedAt === null) missing = true;
    else base = round((base ?? 0) + v);
    if (b.fetchedAt && (!oldest || b.fetchedAt < oldest)) oldest = b.fetchedAt;
  }

  if (counted.length === 0 || base === null) {
    issues.push({
      code: 'NO_BALANCE',
      severity: 'critical',
      blocksConfirmation: true,
      message: 'Não há saldo de estoque sincronizado para este produto.',
    });
    base = null;
  } else if (missing) {
    issues.push({
      code: 'NO_BALANCE',
      severity: 'warning',
      blocksConfirmation: true,
      message: 'Saldo ausente em pelo menos um depósito — total pode estar incompleto.',
    });
  }

  if (oldest) {
    const ageMin = (now.getTime() - oldest.getTime()) / 60000;
    if (ageMin > settings.maxBalanceAgeMinutes) {
      issues.push({
        code: 'STALE_BALANCE',
        severity: 'warning',
        blocksConfirmation: true,
        message: `Saldo consultado há ${Math.round(ageMin)} min (limite configurado: ${settings.maxBalanceAgeMinutes} min).`,
      });
    }
  }
  if (input.sync.lastSyncFailed) {
    issues.push({
      code: 'SYNC_FAILED',
      severity: 'critical',
      blocksConfirmation: true,
      message: `A última sincronização com o Bling falhou${input.sync.lastError ? `: ${input.sync.lastError}` : ''}.`,
    });
  }

  const negativeDeposits = counted.filter((b) => b.physical !== null && b.physical < -EPS);
  if (negativeDeposits.length > 0) {
    issues.push({
      code: 'NEGATIVE_BALANCE',
      severity: 'critical',
      blocksConfirmation: true,
      message: `Saldo físico negativo em: ${negativeDeposits.map((b) => `${b.depositName} (${b.physical})`).join(', ')}. Há divergência de estoque.`,
    });
  }

  const totalDeducted = sumDeductions(totals);
  const available = base === null ? null : round(base - totalDeducted);
  if (available !== null && available < -EPS && totalDeducted > EPS) {
    issues.push({
      code: 'OVERCOMMITTED',
      severity: 'critical',
      blocksConfirmation: true,
      message: `Os compromissos (${totalDeducted}) superam o saldo-base (${base}) em ${round(-available)} unidade(s). Possível venda acima do saldo ou divergência.`,
    });
  }

  const incomingTotal = round(input.incoming.reduce((s, e) => s + e.quantity, 0));
  const status = issues.some((i) => i.blocksConfirmation) ? 'UNCONFIRMED' : 'CONFIRMED';

  return {
    product: input.product,
    baseMode: settings.baseMode,
    physicalTotal,
    virtualTotal,
    base,
    deductions: totals,
    totalDeducted,
    available,
    availableForSale: available === null ? 0 : Math.max(0, available),
    status,
    issues,
    lines,
    byDeposit,
    incoming: input.incoming,
    incomingTotal,
    opportunitiesTotal,
    dataAsOf: oldest ? oldest.toISOString() : null,
    calculatedAt: now.toISOString(),
  };
}

export function reservationEffectiveStatus(r: Pick<LocalReservation, 'status' | 'expiresAt'>, now: Date): LocalReservation['status'] {
  if (r.status === 'ACTIVE' && r.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return r.status;
}

export function blockLabel(t: string): string {
  switch (t) {
    case 'AVARIA':
      return 'avaria';
    case 'CONFERENCIA':
      return 'em conferência';
    case 'ENTRADA_NAO_RECEBIDA':
      return 'entrada registrada e não recebida';
    default:
      return 'decisão operacional';
  }
}

/** Verifica se uma venda de `qty` unidades pode ser atendida. */
export function checkSale(result: AvailabilityResult, qty: number): SaleCheck {
  const unit = result.product.unit ? ` ${result.product.unit}` : ' unidade(s)';
  if (result.available === null) {
    return {
      requested: qty,
      possible: null,
      remainingAfterSale: null,
      shortfall: 0,
      message: 'Não há dados de saldo suficientes para confirmar a disponibilidade.',
    };
  }
  const remaining = round(result.availableForSale - qty);
  const shortfall = remaining < 0 ? round(-remaining) : 0;
  if (result.status === 'UNCONFIRMED') {
    const reasons = result.issues.filter((i) => i.blocksConfirmation).map((i) => i.message);
    return {
      requested: qty,
      possible: null,
      remainingAfterSale: remaining >= 0 ? remaining : null,
      shortfall,
      message:
        `Disponibilidade NÃO confirmada (${reasons.join(' ')}). ` +
        (shortfall > 0
          ? `Pelo cálculo conservador há apenas ${result.availableForSale}${unit} — faltariam ${shortfall}.`
          : `Pelo cálculo conservador haveria ${result.availableForSale}${unit}; confirme com o gestor antes de fechar a venda.`),
    };
  }
  if (shortfall > 0) {
    return {
      requested: qty,
      possible: false,
      remainingAfterSale: null,
      shortfall,
      message: `Não é possível atender ${qty}${unit}: disponível para nova venda ${result.availableForSale}${unit} (faltam ${shortfall}).`,
    };
  }
  return {
    requested: qty,
    possible: true,
    remainingAfterSale: remaining,
    shortfall: 0,
    message: `Sim, é possível atender ${qty}${unit}. Após a venda restariam ${remaining}${unit} disponíveis.`,
  };
}

/**
 * Disponibilidade de um kit (produto com composição) a partir dos componentes:
 * quantos kits completos cabem no saldo disponível de cada componente.
 */
export function kitAvailability(
  components: { componentId: number; quantityPerKit: number; result: AvailabilityResult }[],
): { availableForSale: number; status: AvailabilityResult['status']; limitingComponentId: number | null } {
  if (components.length === 0) return { availableForSale: 0, status: 'UNCONFIRMED', limitingComponentId: null };
  let min = Infinity;
  let limiting: number | null = null;
  let status: AvailabilityResult['status'] = 'CONFIRMED';
  for (const c of components) {
    const kits = c.quantityPerKit > 0 ? Math.floor(round(c.result.availableForSale / c.quantityPerKit)) : 0;
    if (kits < min) {
      min = kits;
      limiting = c.componentId;
    }
    if (c.result.status === 'UNCONFIRMED') status = 'UNCONFIRMED';
  }
  return { availableForSale: min === Infinity ? 0 : min, status, limitingComponentId: limiting };
}
