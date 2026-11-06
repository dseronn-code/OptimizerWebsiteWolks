import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, requireUser, send, viewerOf } from '../auth/guard.js';
import { parse } from '../lib/http.js';
import { createPurchaseRequest, listPurchaseRequests, PurchaseError, updatePurchaseRequest } from '../purchases/purchaseService.js';

async function wrap<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof PurchaseError) throw new HttpError(err.statusCode, err.message);
    throw err;
  }
}

/** Solicitações de compra (internas, não lançadas no Bling). */
export async function purchaseRoutes(app: FastifyInstance) {
  app.get('/api/purchase-requests', async (req, reply) => {
    const user = requireUser(req);
    const q = parse(z.object({ status: z.enum(['OPEN', 'ORDERED', 'RECEIVED', 'REJECTED', 'CANCELLED']).optional() }), req.query);
    return send(reply, { requests: await listPurchaseRequests(viewerOf(user), q) });
  });

  app.post('/api/purchase-requests', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(
      z.object({
        productId: z.number().int().positive().nullable().optional(),
        productText: z.string().trim().max(300).nullable().optional(),
        quantity: z.number().positive().max(1_000_000),
        customerName: z.string().trim().max(120).nullable().optional(),
        notes: z.string().trim().max(500).nullable().optional(),
      }),
      req.body,
    );
    const pr = await wrap(createPurchaseRequest(body, viewerOf(user), 'web', req.ip));
    return send(reply, { request: pr });
  });

  app.put('/api/purchase-requests/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(z.object({ status: z.enum(['ORDERED', 'RECEIVED', 'REJECTED', 'CANCELLED']), managerNote: z.string().trim().max(500).nullable().optional() }), req.body);
    const pr = await wrap(updatePurchaseRequest(id, body.status, viewerOf(user), body.managerNote, req.ip));
    return send(reply, { request: pr });
  });
}
