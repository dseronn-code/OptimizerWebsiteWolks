import { describe, expect, it } from 'vitest';
import { calculateAvailability, checkSale, kitAvailability } from '../src/engine/availability.js';
import type {
  DepositBalance,
  EngineInput,
  LocalReservation,
  OrderCommitment,
} from '../src/engine/types.js';

const NOW = new Date('2026-10-19T12:00:00Z');
const FRESH = new Date('2026-10-19T11:58:00Z');

function deposit(p: Partial<DepositBalance> = {}): DepositBalance {
  return {
    depositId: 1,
    depositName: 'Geral',
    physical: 100,
    virtual: 100,
    fetchedAt: FRESH,
    ignoreBalance: false,
    isDefault: true,
    ...p,
  };
}

let seq = 0;
function order(p: Partial<OrderCommitment> = {}): OrderCommitment {
  seq += 1;
  return {
    orderId: 1000 + seq,
    orderNumber: 500 + seq,
    itemId: 9000 + seq,
    customerId: null,
    customerName: 'Cliente Teste',
    sellerId: null,
    situationId: 15,
    situationName: 'Em andamento',
    category: 'COMMITTED',
    stockEffect: 'NOT_POSTED',
    virtualEffect: 'NOT_REFLECTED',
    quantity: 10,
    quantityDelivered: 0,
    quantityReleased: 0,
    deliveredStockPosted: false,
    depositId: null,
    expectedDate: null,
    orderDate: '2026-10-10',
    ...p,
  };
}

function reservation(p: Partial<LocalReservation> = {}): LocalReservation {
  seq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    quantity: 5,
    depositId: null,
    status: 'ACTIVE',
    expiresAt: new Date('2026-10-25T00:00:00Z'),
    customerId: null,
    customerName: 'Outro Cliente',
    sellerName: 'Vendedor',
    sellerUserId: 'u1',
    blingOrderId: null,
    reason: 'negociação',
    ...p,
  };
}

function input(p: Partial<EngineInput> = {}): EngineInput {
  return {
    product: { id: 1, sku: 'ABC', name: 'Produto ABC' },
    balances: [deposit()],
    commitments: [],
    reservations: [],
    blocks: [],
    incoming: [],
    settings: { baseMode: 'PHYSICAL', maxBalanceAgeMinutes: 30, expiredReservationPolicy: 'KEEP_UNTIL_REVIEW' },
    sync: { lastSyncFailed: false, lastSuccessAt: FRESH, lastError: null },
    now: NOW,
    ...p,
  };
}

describe('motor de disponibilidade — cenários obrigatórios', () => {
  it('1. produto disponível sem qualquer reserva', () => {
    const r = calculateAvailability(input());
    expect(r.base).toBe(100);
    expect(r.totalDeducted).toBe(0);
    expect(r.availableForSale).toBe(100);
    expect(r.status).toBe('CONFIRMED');
    expect(checkSale(r, 50)).toMatchObject({ possible: true, remainingAfterSale: 50 });
  });

  it('2. pedido pago e ainda não baixado é subtraído do físico', () => {
    const r = calculateAvailability(input({ commitments: [order({ quantity: 45 })] }));
    expect(r.deductions.committedOrders).toBe(45);
    expect(r.availableForSale).toBe(55);
    expect(r.lines[0]).toMatchObject({ treatment: 'SUBTRACTED', subtracted: 45 });
    expect(r.status).toBe('CONFIRMED');
  });

  it('3. reserva já refletida no saldo virtual não é subtraída de novo (base virtual)', () => {
    const r = calculateAvailability(
      input({
        balances: [deposit({ physical: 100, virtual: 70 })],
        commitments: [order({ quantity: 30, virtualEffect: 'REFLECTED' })],
        settings: { baseMode: 'VIRTUAL', maxBalanceAgeMinutes: 30, expiredReservationPolicy: 'KEEP_UNTIL_REVIEW' },
      }),
    );
    expect(r.base).toBe(70);
    expect(r.totalDeducted).toBe(0);
    expect(r.availableForSale).toBe(70);
    expect(r.lines[0].treatment).toBe('ALREADY_IN_BASE');
  });

  it('4. pedido com baixa efetuada e reserva encerrada não gera nova subtração', () => {
    const o = order({ quantity: 20, stockEffect: 'POSTED' });
    const res = reservation({ quantity: 20, status: 'CONVERTED', blingOrderId: o.orderId });
    const r = calculateAvailability(
      input({ balances: [deposit({ physical: 80 })], commitments: [o], reservations: [res] }),
    );
    expect(r.totalDeducted).toBe(0);
    expect(r.availableForSale).toBe(80);
    expect(r.lines.find((l) => l.kind === 'ORDER')?.treatment).toBe('ALREADY_IN_BASE');
  });

  it('5a. reserva vinculada ao pedido do Bling é contada uma única vez', () => {
    const o = order({ quantity: 30 });
    const res = reservation({ quantity: 30, blingOrderId: o.orderId });
    const r = calculateAvailability(input({ commitments: [o], reservations: [res] }));
    expect(r.totalDeducted).toBe(30);
    expect(r.availableForSale).toBe(70);
    expect(r.lines.find((l) => l.kind === 'RESERVATION')?.treatment).toBe('SUPERSEDED');
  });

  it('5b. reserva não vinculada do mesmo cliente de um pedido é sinalizada como possível duplicidade', () => {
    const o = order({ quantity: 30, customerId: 77, customerName: 'João Silva' });
    const res = reservation({ quantity: 30, customerId: 77, customerName: 'João Silva' });
    const r = calculateAvailability(input({ commitments: [o], reservations: [res] }));
    expect(r.issues.map((i) => i.code)).toContain('POSSIBLE_DUPLICATE');
    expect(r.status).toBe('UNCONFIRMED');
    // conservador: mantém ambos até revisão
    expect(r.availableForSale).toBe(40);
    expect(checkSale(r, 10).possible).toBeNull();
  });

  it('5c. duplicidade detectada mesmo quando o pedido tem id do contato e a reserva só o nome', () => {
    const o = order({ quantity: 20, customerId: 501, customerName: 'João Silva' });
    const res = reservation({ quantity: 20, customerId: null, customerName: 'joao  silva' });
    const r = calculateAvailability(input({ commitments: [o], reservations: [res] }));
    expect(r.issues.map((i) => i.code)).toContain('POSSIBLE_DUPLICATE');
  });

  it('6. pré-pedido com reserva autorizada reduz a disponibilidade', () => {
    const r = calculateAvailability(
      input({ commitments: [order({ quantity: 30, category: 'PRE_ORDER_RESERVED', situationName: 'Aguardando transportadora' })] }),
    );
    expect(r.deductions.preOrderReservations).toBe(30);
    expect(r.availableForSale).toBe(70);
  });

  it('7. cotação sem reserva não reduz a disponibilidade', () => {
    const r = calculateAvailability(input({ commitments: [order({ quantity: 40, category: 'OPPORTUNITY' })] }));
    expect(r.totalDeducted).toBe(0);
    expect(r.availableForSale).toBe(100);
    expect(r.opportunitiesTotal).toBe(40);
    expect(r.status).toBe('CONFIRMED');
  });

  it('8. pedido cancelado libera o compromisso e alerta se havia baixa ou reserva ativa', () => {
    const o = order({ quantity: 25, category: 'CANCELLED', previouslyPosted: true });
    const res = reservation({ quantity: 25, blingOrderId: o.orderId });
    const r = calculateAvailability(input({ commitments: [o], reservations: [res] }));
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain('CANCELLED_AFTER_POSTING');
    expect(codes).toContain('CANCELLED_WITH_ACTIVE_RESERVATION');
    // pedido não conta; reserva ativa permanece (conservador) até revisão
    expect(r.deductions.committedOrders).toBe(0);
    expect(r.deductions.localReservations).toBe(25);
    expect(r.availableForSale).toBe(75);

    const semReserva = calculateAvailability(input({ commitments: [order({ quantity: 25, category: 'CANCELLED' })] }));
    expect(semReserva.availableForSale).toBe(100);
  });

  it('9. pedido parcialmente atendido subtrai apenas o pendente (entregas baixadas)', () => {
    const r = calculateAvailability(
      input({
        commitments: [order({ quantity: 50, quantityDelivered: 20, quantityReleased: 5, deliveredStockPosted: true })],
        balances: [deposit({ physical: 80 })],
      }),
    );
    expect(r.deductions.committedOrders).toBe(25);
    expect(r.availableForSale).toBe(55);

    // entregas sem baixa: as unidades entregues ainda constam no saldo físico
    const naoBaixado = calculateAvailability(
      input({ commitments: [order({ quantity: 50, quantityDelivered: 20, deliveredStockPosted: false })] }),
    );
    expect(naoBaixado.deductions.committedOrders).toBe(50);
    expect(naoBaixado.issues.map((i) => i.code)).toContain('PARTIAL_DELIVERY_NOT_POSTED');
  });

  it('10. entrada ainda não recebida não aumenta a disponibilidade', () => {
    const r = calculateAvailability(
      input({
        incoming: [{ purchaseOrderId: 1, purchaseOrderNumber: 10, quantity: 200, expectedDate: '2026-10-20', supplierName: 'Fornecedor' }],
        blocks: [{ id: 'b1', quantity: 15, depositId: null, reasonType: 'ENTRADA_NAO_RECEBIDA', notes: 'NF lançada, carga não chegou' }],
      }),
    );
    expect(r.incomingTotal).toBe(200);
    expect(r.deductions.blocked).toBe(15);
    expect(r.availableForSale).toBe(85);
  });

  it('12. falha de sincronização ou saldo desatualizado torna a disponibilidade não confirmada', () => {
    const r = calculateAvailability(input({ sync: { lastSyncFailed: true, lastSuccessAt: FRESH, lastError: 'HTTP 503' } }));
    expect(r.status).toBe('UNCONFIRMED');
    expect(checkSale(r, 10).possible).toBeNull();

    const stale = calculateAvailability(input({ balances: [deposit({ fetchedAt: new Date('2026-10-19T08:00:00Z') })] }));
    expect(stale.status).toBe('UNCONFIRMED');
    expect(stale.issues.map((i) => i.code)).toContain('STALE_BALANCE');

    const noData = calculateAvailability(input({ balances: [] }));
    expect(noData.available).toBeNull();
    expect(checkSale(noData, 1).possible).toBeNull();
  });

  it('14. produto em mais de um depósito: total e visão por depósito', () => {
    const r = calculateAvailability(
      input({
        balances: [
          deposit({ depositId: 1, depositName: 'Matriz', physical: 60, isDefault: true }),
          deposit({ depositId: 2, depositName: 'Filial', physical: 40, isDefault: false }),
          deposit({ depositId: 3, depositName: 'Avarias', physical: 30, isDefault: false, ignoreBalance: true }),
        ],
        commitments: [order({ quantity: 10, depositId: 2 }), order({ quantity: 5 })],
      }),
    );
    expect(r.physicalTotal).toBe(100); // depósito desconsiderado fica fora
    expect(r.availableForSale).toBe(85);
    const filial = r.byDeposit.find((d) => d.depositId === 2)!;
    const matriz = r.byDeposit.find((d) => d.depositId === 1)!;
    expect(filial.available).toBe(30);
    expect(matriz.available).toBe(55); // pedido sem depósito atribuído ao padrão
    expect(r.issues.map((i) => i.code)).toContain('DEPOSIT_ASSUMED');
  });

  it('15. saldo negativo ou compromissos acima do saldo geram divergência', () => {
    const neg = calculateAvailability(input({ balances: [deposit({ physical: -5 })] }));
    expect(neg.issues.map((i) => i.code)).not.toContain('OVERCOMMITTED');
    expect(neg.status).toBe('UNCONFIRMED');
    expect(neg.availableForSale).toBe(0);
    expect(neg.issues.map((i) => i.code)).toContain('NEGATIVE_BALANCE');

    const over = calculateAvailability(input({ balances: [deposit({ physical: 20 })], commitments: [order({ quantity: 30 })] }));
    expect(over.available).toBe(-10);
    expect(over.availableForSale).toBe(0);
    expect(over.issues.map((i) => i.code)).toContain('OVERCOMMITTED');
  });
});

describe('motor de disponibilidade — prevenção de dupla contagem', () => {
  it('pedido já baixado (situação 7) não é subtraído mesmo permanecendo "aguardando entrega"', () => {
    const r = calculateAvailability(
      input({ balances: [deposit({ physical: 55 })], commitments: [order({ quantity: 45, stockEffect: 'POSTED' })] }),
    );
    expect(r.availableForSale).toBe(55);
  });

  it('base virtual: pedido não refletido no virtual é subtraído uma vez; baixado não é', () => {
    const r = calculateAvailability(
      input({
        balances: [deposit({ physical: 100, virtual: 80 })],
        settings: { baseMode: 'VIRTUAL', maxBalanceAgeMinutes: 30, expiredReservationPolicy: 'KEEP_UNTIL_REVIEW' },
        commitments: [
          order({ quantity: 20, virtualEffect: 'REFLECTED' }),
          order({ quantity: 10, virtualEffect: 'NOT_REFLECTED' }),
          order({ quantity: 7, stockEffect: 'POSTED', virtualEffect: 'NOT_REFLECTED' }),
        ],
      }),
    );
    expect(r.totalDeducted).toBe(10);
    expect(r.availableForSale).toBe(70);
  });

  it('situação sem regra é subtraída por precaução e marca como não confirmada', () => {
    const r = calculateAvailability(
      input({ commitments: [order({ quantity: 12, category: 'UNMAPPED', stockEffect: 'UNKNOWN', virtualEffect: 'UNKNOWN' })] }),
    );
    expect(r.deductions.uncertain).toBe(12);
    expect(r.status).toBe('UNCONFIRMED');
    // apenas um aviso de situação sem regra, sem contagem dupla do mesmo item
    expect(r.lines.filter((l) => l.subtracted > 0)).toHaveLength(1);
  });

  it('reserva pendente não reduz; vencida mantida até revisão ou liberada conforme regra', () => {
    const pend = reservation({ status: 'PENDING', quantity: 10 });
    const exp = reservation({ quantity: 8, expiresAt: new Date('2026-10-18T00:00:00Z') });
    const keep = calculateAvailability(input({ reservations: [pend, exp] }));
    expect(keep.deductions.localReservations).toBe(8);
    expect(keep.issues.map((i) => i.code)).toContain('EXPIRED_RESERVATION');

    const release = calculateAvailability(
      input({
        reservations: [pend, exp],
        settings: { baseMode: 'PHYSICAL', maxBalanceAgeMinutes: 30, expiredReservationPolicy: 'AUTO_RELEASE' },
      }),
    );
    expect(release.deductions.localReservations).toBe(0);
  });

  it('cenário do enunciado: 150 físico, 45 pagos, 30 pré-pedidos, 5 bloqueados → 70', () => {
    const r = calculateAvailability(
      input({
        balances: [deposit({ physical: 150 })],
        commitments: [order({ quantity: 45 }), order({ quantity: 30, category: 'PRE_ORDER_RESERVED' })],
        blocks: [{ id: 'b', quantity: 5, depositId: null, reasonType: 'AVARIA', notes: null }],
      }),
    );
    expect(r.availableForSale).toBe(70);
    expect(checkSale(r, 50)).toMatchObject({ possible: true, remainingAfterSale: 20 });
    expect(checkSale(r, 80)).toMatchObject({ possible: false, shortfall: 10 });
  });

  it('kit: disponibilidade limitada pelo componente mais escasso', () => {
    const a = calculateAvailability(input({ balances: [deposit({ physical: 10 })] }));
    const b = calculateAvailability(input({ balances: [deposit({ physical: 9 })] }));
    const k = kitAvailability([
      { componentId: 1, quantityPerKit: 2, result: a },
      { componentId: 2, quantityPerKit: 3, result: b },
    ]);
    expect(k.availableForSale).toBe(3);
    expect(k.limitingComponentId).toBe(2);
  });

  it('quantidades fracionadas não acumulam erro de ponto flutuante', () => {
    const r = calculateAvailability(
      input({ balances: [deposit({ physical: 1 })], commitments: [order({ quantity: 0.1 }), order({ quantity: 0.2 })] }),
    );
    expect(r.availableForSale).toBe(0.7);
  });
});
