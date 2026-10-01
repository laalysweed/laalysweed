import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodTypeAny } from 'zod';
import { badRequest } from './errors';

/** Wraps async handlers so rejections reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw badRequest(first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input', 'VALIDATION', r.error.flatten());
  }
  return r.data;
}

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

export function paging(q: Record<string, unknown>, max = 100) {
  const limit = Math.min(max, Math.max(1, Number(q['limit'] ?? 50) || 50));
  const page = Math.max(1, Number(q['page'] ?? 1) || 1);
  return { limit, skip: (page - 1) * limit, page };
}

/** Express 5 types params as string | string[]; routes here only use single params. */
export const param = (req: Request, name: string) => String(req.params[name] ?? '');
