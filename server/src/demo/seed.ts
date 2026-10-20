import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanAlerts } from '../alerts/alertService.js';
import { createUser } from '../auth/authService.js';
import { getDemoClient } from '../bling/clientFactory.js';
import { migrate } from '../db/migrate.js';
import { pool } from '../db/pool.js';
import { updateSettings } from '../lib/settings.js';
import { reconcileSalesOrders, runFullSync } from '../sync/syncService.js';
import { DEMO } from './fixtures.js';

/**
 * Cria o AMBIENTE DE DEMONSTRAÇÃO com dados fictícios (source = 'demo').
 * Nunca execute em um banco com dados reais: o comando se recusa se o modo for 'live'.
 */

export const DEMO_USERS = [
  { username: 'admin', name: 'Administrador (demo)', password: 'DemoAdmin2026', role: 'admin' as const, blingSellerId: null },
  { username: 'gestor', name: 'Gestora Carla (demo)', password: 'DemoGestor2026', role: 'gestor' as const, blingSellerId: null },
  { username: 'ana', name: 'Ana Vendas (demo)', password: 'DemoVendas2026', role: 'vendedor' as const, blingSellerId: DEMO.sellers.ana },
  { username: 'bruno', name: 'Bruno Vendas (demo)', password: 'DemoVendas2026', role: 'vendedor' as const, blingSellerId: DEMO.sellers.bruno },
];

const S = DEMO.situations;
const P = DEMO.products;

/** `passwordOverride`: em servidor público, as senhas conhecidas da demo são substituídas por esta. */
export async function seedDemo(log = console.log, passwordOverride?: string) {
  await migrate(pool, log);
  const mode = await pool.query("SELECT value->>'appMode' AS mode FROM settings WHERE key = 'app'");
  if (mode.rows[0]?.mode === 'live') throw new Error('O sistema está em modo live (Bling real). A demonstração não será criada.');
  await updateSettings({ appMode: 'demo' }, null);

  // limpa dados de demonstração anteriores
  await pool.query("DELETE FROM reservations WHERE source = 'demo'");
  await pool.query("DELETE FROM stock_blocks WHERE source = 'demo'");
  await pool.query("DELETE FROM sales_orders WHERE source = 'demo'");
  await pool.query("DELETE FROM purchase_orders WHERE source = 'demo'");
  await pool.query("DELETE FROM stock_balances WHERE source = 'demo'");
  await pool.query("DELETE FROM products WHERE source = 'demo'");
  await pool.query('DELETE FROM alerts');
  await pool.query('DELETE FROM sync_state');

  const users: Record<string, string> = {};
  for (const u of DEMO_USERS) {
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [u.username]);
    users[u.username] = existing.rows[0]?.id ?? (await createUser({ ...u, password: passwordOverride ?? u.password })).id;
  }

  const rules: [number, string, string, string, string][] = [
    [S.emAberto, 'OPPORTUNITY', 'NOT_POSTED', 'NOT_REFLECTED', 'Pedido em digitação/cotação'],
    [S.atendido, 'FULFILLED', 'POSTED', 'REFLECTED', 'Atendido: baixa lançada ao atender'],
    [S.cancelado, 'CANCELLED', 'NOT_POSTED', 'NOT_REFLECTED', 'Cancelado'],
    [S.emAndamento, 'COMMITTED', 'NOT_POSTED', 'REFLECTED', 'Confirmado, aguardando saída'],
    [S.pagoAguardandoRetirada, 'COMMITTED', 'NOT_POSTED', 'REFLECTED', 'Pago, cliente ainda não retirou'],
    [S.aguardandoTransportadora, 'COMMITTED', 'NOT_POSTED', 'REFLECTED', 'Confirmado, aguardando transportadora'],
    [S.prePedidoComReserva, 'PRE_ORDER_RESERVED', 'NOT_POSTED', 'NOT_REFLECTED', 'Reserva autorizada pela empresa'],
    [S.cotacao, 'OPPORTUNITY', 'NOT_POSTED', 'NOT_REFLECTED', 'Cotação sem reserva'],
  ];
  for (const [id, category, stock, virt, label] of rules) {
    await pool.query(
      `INSERT INTO situation_rules (situation_id, category, stock_effect, virtual_effect, label, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (situation_id) DO UPDATE SET category = EXCLUDED.category, stock_effect = EXCLUDED.stock_effect,
         virtual_effect = EXCLUDED.virtual_effect, label = EXCLUDED.label, updated_at = now()`,
      [id, category, stock, virt, label, users.admin],
    );
  }

  const client = getDemoClient();
  await runFullSync(client, 'demo-seed');
  await reconcileSalesOrders(client, 'demo-seed');

  // controles complementares
  await pool.query(
    `INSERT INTO order_overrides (order_id, stock_effect, notes, updated_by) VALUES (70005, 'POSTED', 'Baixa antecipada lançada manualmente no Bling', $1)
     ON CONFLICT (order_id) DO UPDATE SET stock_effect = 'POSTED'`,
    [users.gestor],
  );
  const hdmiItem = await pool.query('SELECT id FROM sales_order_items WHERE order_id = 70009 AND product_id = $1', [P.hdmi]);
  await pool.query('DELETE FROM item_fulfillments WHERE order_item_id = $1', [hdmiItem.rows[0].id]);
  await pool.query(
    `INSERT INTO item_fulfillments (order_item_id, quantity_delivered, delivered_stock_posted, notes, created_by)
     VALUES ($1, 20, true, 'Primeira remessa entregue e baixada', $2)`,
    [hdmiItem.rows[0].id, users.gestor],
  );

  const reservations: [number, number, string, number | null, string, string, string, number][] = [
    // produto, qtd, cliente, pedido vinculado, vendedor, status, motivo, validade (h; negativo = vencida)
    [P.gaveteiro, 4, 'Loja Gama Móveis', null, 'bruno', 'ACTIVE', 'Cliente aguardando aprovação de crédito', -20],
    [P.teclado, 20, 'João Silva', null, 'ana', 'ACTIVE', 'Negociação de frete', 30],
    [P.suporte, 10, 'João Silva', 70011, 'ana', 'ACTIVE', 'Reserva do pedido 1211', 40],
    [P.abc, 8, 'Loja Delta', null, 'bruno', 'PENDING', 'Aguardando definição de transporte', 48],
    [P.mesa, 5, 'Escritório Beta ME', null, 'bruno', 'ACTIVE', 'Condição de pagamento em análise', 10],
  ];
  for (const [productId, qty, customer, orderId, seller, status, reason, hours] of reservations) {
    const { rows } = await pool.query(
      `INSERT INTO reservations (product_id, quantity, customer_name, bling_order_id, seller_user_id, status, reason, expires_at,
         approved_by, approved_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' hours')::interval, $9, $10, 'demo') RETURNING id`,
      [productId, qty, customer, orderId, users[seller], status, reason, String(hours), status === 'ACTIVE' ? users.gestor : null, status === 'ACTIVE' ? new Date() : null],
    );
    await pool.query("INSERT INTO reservation_history (reservation_id, action, to_status, user_id) VALUES ($1, 'create', $2, $3)", [rows[0].id, status, users[seller]]);
  }

  await pool.query(
    `INSERT INTO stock_blocks (product_id, deposit_id, quantity, reason_type, notes, source, created_by) VALUES
       ($1, $2, 5, 'AVARIA', 'Cadeiras com avaria no transporte', 'demo', $4),
       ($3, $2, 10, 'ENTRADA_NAO_RECEBIDA', 'NF lançada, mercadoria ainda não conferida', 'demo', $4)`,
    [P.abc, DEMO.deposits.matriz, P.hdmi, users.gestor],
  );

  await scanAlerts();
  log('Demonstração criada. Usuários (somente demo):');
  for (const u of DEMO_USERS) log(`  ${u.username.padEnd(7)} / ${passwordOverride ? '(senha definida em BOOTSTRAP_ADMIN_PASSWORD)' : u.password}  (${u.role})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seedDemo()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
