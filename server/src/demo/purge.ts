import { withTransaction } from '../db/pool.js';

/**
 * Remove todos os dados FICTÍCIOS da demonstração (source = 'demo') para que não se misturem
 * com os dados reais do Bling. Usuários, configurações e auditoria são mantidos.
 * Idempotente: sem dados de demonstração, não faz nada.
 */
export async function purgeDemoData(): Promise<{ removedProducts: number }> {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM products WHERE source = 'demo'");
    const demoOrders = await tx.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM sales_orders WHERE source = 'demo'");
    if (rows[0].n === 0 && demoOrders.rows[0].n === 0) return { removedProducts: 0 };

    const demoProducts = "SELECT id FROM products WHERE source = 'demo'";
    const demoOrderIds = "SELECT id FROM sales_orders WHERE source = 'demo'";
    await tx.query(`DELETE FROM reservations WHERE source = 'demo' OR product_id IN (${demoProducts})`);
    await tx.query(`DELETE FROM stock_blocks WHERE source = 'demo' OR product_id IN (${demoProducts})`);
    await tx.query(`DELETE FROM item_fulfillments WHERE order_item_id IN (SELECT id FROM sales_order_items WHERE order_id IN (${demoOrderIds}))`);
    await tx.query(`DELETE FROM order_overrides WHERE order_id IN (${demoOrderIds})`);
    await tx.query(`DELETE FROM sales_order_situation_history WHERE order_id IN (${demoOrderIds})`);
    await tx.query("DELETE FROM sales_orders WHERE source = 'demo'");
    await tx.query("DELETE FROM purchase_orders WHERE source = 'demo'");
    await tx.query("DELETE FROM stock_balances WHERE source = 'demo'");
    await tx.query(`DELETE FROM product_components WHERE product_id IN (${demoProducts})`);
    await tx.query("DELETE FROM products WHERE source = 'demo'");
    // regras criadas para as situações fictícias (as situações reais terão regras próprias)
    await tx.query("DELETE FROM situation_rules WHERE situation_id IN (SELECT id FROM situations WHERE source = 'demo')");
    await tx.query("DELETE FROM situations WHERE source = 'demo'");
    await tx.query("DELETE FROM deposits WHERE source = 'demo' AND id NOT IN (SELECT deposit_id FROM stock_balances)");
    await tx.query('DELETE FROM alerts');
    await tx.query('DELETE FROM sync_state');
    return { removedProducts: rows[0].n };
  });
}
