import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role, SessionUser } from './authService.js';
import type { Viewer } from '../stock/stockService.js';

export const SESSION_COOKIE = 'bsa_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    rawBody?: Buffer;
  }
}

export class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

/** Exige sessão válida e, opcionalmente, um dos perfis. Aplicado no backend em todas as rotas protegidas. */
export function requireUser(req: FastifyRequest, roles?: Role[]): SessionUser {
  if (!req.user) throw new HttpError(401, 'Sessão expirada. Faça login novamente.');
  if (roles && !roles.includes(req.user.role)) throw new HttpError(403, 'Seu perfil não tem acesso a esta operação.');
  return req.user;
}

export function viewerOf(u: SessionUser): Viewer {
  return { id: u.id, role: u.role, blingSellerId: u.blingSellerId };
}

export function send<T>(reply: FastifyReply, body: T) {
  return reply.header('cache-control', 'no-store').send(body);
}
