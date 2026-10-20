import type { FakeBlingState } from '../bling/fakeClient.js';

/**
 * DADOS FICTÍCIOS DE DEMONSTRAÇÃO.
 * Todos os nomes de produtos terminam com "[DEMO]" e são gravados com source = 'demo'.
 * A interface exibe uma faixa "Ambiente de demonstração" enquanto o modo demo estiver ativo.
 */

export const DEMO = {
  modules: { sales: 98310 },
  deposits: { matriz: 1001, filial: 1002, avarias: 1003 },
  sellers: { ana: 7001, bruno: 7002 },
  situations: {
    emAberto: 6,
    atendido: 9,
    cancelado: 12,
    emAndamento: 15,
    pagoAguardandoRetirada: 501,
    aguardandoTransportadora: 502,
    prePedidoComReserva: 503,
    cotacao: 504,
    emSeparacaoSemRegra: 505,
  },
  products: {
    abc: 9001,
    mesa: 9002,
    gaveteiro: 9003,
    monitor: 9004,
    teclado: 9005,
    mouse: 9006,
    kit: 9007,
    hdmi: 9008,
    cadeiraGamer: 9009,
    suporte: 9010,
  },
};

function day(offset: number): string {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}

let itemSeq = 880000;
function item(productId: number, sku: string, quantidade: number, descricao: string) {
  itemSeq += 1;
  return { id: itemSeq, codigo: sku, quantidade, descricao, unidade: 'UN', produto: { id: productId } };
}

const P = DEMO.products;
const S = DEMO.situations;
const D = DEMO.deposits;

export function buildDemoBlingState(): FakeBlingState {
  itemSeq = 880000;
  const products = [
    { id: P.abc, nome: 'Produto ABC — Cadeira Ergonômica Preta [DEMO]', codigo: 'ABC', formato: 'S', situacao: 'A', unidade: 'UN' },
    { id: P.mesa, nome: 'Mesa de Escritório 120 cm Carvalho [DEMO]', codigo: 'MES-120', formato: 'S', situacao: 'A', unidade: 'UN' },
    { id: P.gaveteiro, nome: 'Gaveteiro Volante 3 Gavetas [DEMO]', codigo: 'GAV-3', formato: 'S', situacao: 'A', unidade: 'UN' },
    { id: P.monitor, nome: 'Monitor LED 24 polegadas [DEMO]', codigo: 'MON-24', formato: 'S', situacao: 'A', unidade: 'UN' },
    { id: P.teclado, nome: 'Teclado USB ABNT2 [DEMO]', codigo: 'TEC-USB', formato: 'S', situacao: 'A', unidade: 'UN' },
    { id: P.mouse, nome: 'Mouse Sem Fio Silencioso [DEMO]', codigo: 'MOU-SF', formato: 'S', situacao: 'A', unidade: 'UN' },
    {
      id: P.kit, nome: 'Kit Home Office (Cadeira ABC + Mesa 120) [DEMO]', codigo: 'KIT-HO', formato: 'E', situacao: 'A', unidade: 'KIT',
      estrutura: { componentes: [{ produto: { id: P.abc }, quantidade: 1 }, { produto: { id: P.mesa }, quantidade: 1 }] },
    },
    { id: P.hdmi, nome: 'Cabo HDMI 2 metros [DEMO]', codigo: 'CAB-HDMI', formato: 'S', situacao: 'A', unidade: 'UN' },
    { id: P.cadeiraGamer, nome: 'Cadeira Gamer Reclinável [DEMO]', codigo: 'CAD-GAM', formato: 'S', situacao: 'A', unidade: 'UN' },
    { id: P.suporte, nome: 'Suporte Ajustável para Notebook [DEMO]', codigo: 'SUP-NOT', formato: 'S', situacao: 'A', unidade: 'UN' },
  ];

  const balances = [
    { productId: P.abc, depositId: D.matriz, physical: 150, virtual: 105 },
    { productId: P.mesa, depositId: D.matriz, physical: 40, virtual: 30 },
    { productId: P.mesa, depositId: D.filial, physical: 25, virtual: 25 },
    { productId: P.gaveteiro, depositId: D.matriz, physical: 8, virtual: 2 },
    { productId: P.monitor, depositId: D.matriz, physical: -2, virtual: -2 },
    { productId: P.teclado, depositId: D.matriz, physical: 200, virtual: 180 },
    { productId: P.mouse, depositId: D.matriz, physical: 120, virtual: 120 },
    { productId: P.mouse, depositId: D.avarias, physical: 6, virtual: 6 },
    { productId: P.hdmi, depositId: D.matriz, physical: 480, virtual: 450 },
    { productId: P.hdmi, depositId: D.filial, physical: 60, virtual: 60 },
    { productId: P.cadeiraGamer, depositId: D.matriz, physical: 0, virtual: 0 },
    { productId: P.suporte, depositId: D.matriz, physical: 35, virtual: 35 },
  ];

  const order = (id: number, numero: number, situacao: number, contato: { id: number; nome: string }, vendedor: number, dataOffset: number, itens: ReturnType<typeof item>[], dataPrevistaOffset?: number) => ({
    id, numero, data: day(dataOffset), dataSaida: day(dataOffset), dataPrevista: dataPrevistaOffset !== undefined ? day(dataPrevistaOffset) : day(dataOffset + 7),
    contato, vendedor: { id: vendedor }, situacao: { id: situacao, valor: 0 }, loja: { id: 0 }, total: 0, itens, alteradoEm: day(dataOffset),
  });

  const joao = { id: 501, nome: 'João Silva' };
  const maria = { id: 502, nome: 'Maria Oliveira' };
  const alfa = { id: 503, nome: 'Construtora Alfa Ltda' };
  const beta = { id: 504, nome: 'Escritório Beta ME' };
  const gama = { id: 505, nome: 'Loja Gama Móveis' };

  const salesOrders = [
    // Produto ABC: 45 pagos aguardando retirada, 30 em pré-pedido com reserva, 20 em cotação
    order(70001, 1201, S.pagoAguardandoRetirada, alfa, DEMO.sellers.ana, -4, [item(P.abc, 'ABC', 45, 'Produto ABC — Cadeira Ergonômica Preta')]),
    order(70002, 1202, S.prePedidoComReserva, beta, DEMO.sellers.bruno, -2, [item(P.abc, 'ABC', 30, 'Produto ABC — Cadeira Ergonômica Preta')]),
    order(70003, 1203, S.cotacao, gama, DEMO.sellers.ana, -1, [item(P.abc, 'ABC', 20, 'Produto ABC — Cadeira Ergonômica Preta')]),
    // Mesa: 10 aguardando transportadora; 12 com baixa antecipada (override POSTED no seed)
    order(70004, 1204, S.aguardandoTransportadora, maria, DEMO.sellers.bruno, -3, [item(P.mesa, 'MES-120', 10, 'Mesa de Escritório 120 cm')], 1),
    order(70005, 1205, S.emAndamento, alfa, DEMO.sellers.ana, -6, [item(P.mesa, 'MES-120', 12, 'Mesa de Escritório 120 cm')]),
    // Gaveteiro: 6 confirmados com saldo 8 + reserva vencida de 4 → compromissos acima do saldo
    order(70006, 1206, S.emAndamento, gama, DEMO.sellers.bruno, -5, [item(P.gaveteiro, 'GAV-3', 6, 'Gaveteiro Volante 3 Gavetas')]),
    // Teclado: pedido do João (sem vínculo com a reserva dele) → possível duplicidade
    order(70007, 1207, S.pagoAguardandoRetirada, joao, DEMO.sellers.ana, -1, [item(P.teclado, 'TEC-USB', 20, 'Teclado USB ABNT2')]),
    // Mouse: pedido em situação sem regra configurada
    order(70008, 1208, S.emSeparacaoSemRegra, maria, DEMO.sellers.bruno, -1, [item(P.mouse, 'MOU-SF', 15, 'Mouse Sem Fio Silencioso')]),
    // HDMI: 50 com 20 entregues (entrega parcial já baixada) + 30 atendidos com baixa
    order(70009, 1209, S.emAndamento, beta, DEMO.sellers.ana, -8, [item(P.hdmi, 'CAB-HDMI', 50, 'Cabo HDMI 2 metros'), item(P.teclado, 'TEC-USB', 5, 'Teclado USB ABNT2')]),
    order(70010, 1210, S.atendido, gama, DEMO.sellers.bruno, -10, [item(P.hdmi, 'CAB-HDMI', 30, 'Cabo HDMI 2 metros')]),
    // Suporte: pedido cancelado que tinha reserva vinculada
    order(70011, 1211, S.cancelado, joao, DEMO.sellers.ana, -2, [item(P.suporte, 'SUP-NOT', 10, 'Suporte Ajustável para Notebook')]),
    // Pré-pedido antigo parado
    order(70012, 1212, S.cotacao, maria, DEMO.sellers.bruno, -12, [item(P.cadeiraGamer, 'CAD-GAM', 4, 'Cadeira Gamer Reclinável')]),
  ];

  const purchaseOrders = [
    { id: 60001, numero: 301, data: day(-5), dataPrevista: day(1), fornecedor: { id: 801, nome: 'Fornecedor Exemplo A' }, situacao: { valor: 0 }, itens: [{ descricao: 'Cabo HDMI 2 metros', quantidade: 300, produto: { id: P.hdmi, codigo: 'CAB-HDMI' } }] },
    { id: 60002, numero: 302, data: day(-3), dataPrevista: day(3), fornecedor: { id: 802, nome: 'Fornecedor Exemplo B' }, situacao: { valor: 3 }, itens: [{ descricao: 'Cadeira Gamer Reclinável', quantidade: 15, produto: { id: P.cadeiraGamer, codigo: 'CAD-GAM' } }] },
    { id: 60003, numero: 303, data: day(-10), dataPrevista: day(-2), fornecedor: { id: 801, nome: 'Fornecedor Exemplo A' }, situacao: { valor: 0 }, itens: [{ descricao: 'Produto ABC — Cadeira Ergonômica Preta', quantidade: 60, produto: { id: P.abc, codigo: 'ABC' } }] },
  ];

  return {
    products,
    deposits: [
      { id: D.matriz, descricao: 'Matriz [DEMO]', padrao: true, desconsiderarSaldo: false, situacao: 1 },
      { id: D.filial, descricao: 'Filial Centro [DEMO]', padrao: false, desconsiderarSaldo: false, situacao: 1 },
      { id: D.avarias, descricao: 'Avarias [DEMO]', padrao: false, desconsiderarSaldo: true, situacao: 1 },
    ],
    balances,
    salesOrders,
    purchaseOrders,
    modules: [{ id: DEMO.modules.sales, nome: 'Vendas', descricao: 'Pedidos de venda' }],
    situations: {
      [DEMO.modules.sales]: [
        { id: S.emAberto, nome: 'Em aberto' },
        { id: S.atendido, nome: 'Atendido' },
        { id: S.cancelado, nome: 'Cancelado' },
        { id: S.emAndamento, nome: 'Em andamento' },
        { id: S.pagoAguardandoRetirada, nome: 'Pago - aguardando retirada', idHerdado: S.emAndamento },
        { id: S.aguardandoTransportadora, nome: 'Aguardando transportadora', idHerdado: S.emAndamento },
        { id: S.prePedidoComReserva, nome: 'Pré-pedido com reserva', idHerdado: S.emAberto },
        { id: S.cotacao, nome: 'Cotação', idHerdado: S.emAberto },
        { id: S.emSeparacaoSemRegra, nome: 'Em separação' },
      ],
    },
  };
}
