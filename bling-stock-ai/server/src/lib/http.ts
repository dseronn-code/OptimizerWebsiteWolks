import type { z } from 'zod';
import { HttpError } from '../auth/guard.js';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'dados'}: ${i.message}`).join('; '));
  return r.data;
}
