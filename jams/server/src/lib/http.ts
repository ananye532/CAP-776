import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodError, type ZodType } from 'zod';
import { AppError } from './errors.js';

export type AuthedRequest = Request & { userId: string; sessionId: string };

/** Wraps an async handler so rejections reach the error middleware. */
export function h<Req extends Request = AuthedRequest>(fn: (req: Req, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req as Req, res).catch(next);
  };
}

export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw validationError(r.error);
  return r.data;
}

export function validationError(err: ZodError) {
  return new AppError(
    422,
    'validation_error',
    'Some fields are invalid.',
    err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export function paginated<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Accepts `a,b` or repeated query params as an array. */
export const csv = <T extends ZodType>(item: T) =>
  z.preprocess((v) => (v == null || v === '' ? undefined : Array.isArray(v) ? v : String(v).split(',').filter(Boolean)), z.array(item).optional());

export const optionalText = z
  .string()
  .trim()
  .max(20000)
  .nullish()
  .transform((v) => (v ? v : null));
export const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v == null || /^https?:\/\//i.test(v), 'Must be an http(s) URL');
export const optionalDate = z
  .union([z.string(), z.date()])
  .nullish()
  .transform((v, ctx) => {
    if (v == null || v === '') return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Invalid date' });
      return z.NEVER;
    }
    return d;
  });
export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'not_found', message: 'Endpoint not found.' } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) err = validationError(err);
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  const anyErr = err as { type?: string; code?: string; status?: number; message?: string };
  if (anyErr?.type === 'entity.too.large' || anyErr?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: { code: 'payload_too_large', message: 'The upload is too large.' } });
    return;
  }
  if (anyErr?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body.' } });
    return;
  }
  // Postgres constraint violations -> user-facing messages. Never leak SQL or stack traces.
  if (anyErr?.code === '23505') {
    res.status(409).json({ error: { code: 'conflict', message: 'A record with these details already exists.' } });
    return;
  }
  if (anyErr?.code === '23503') {
    res.status(409).json({ error: { code: 'conflict', message: 'This record is referenced by other records or references a missing record.' } });
    return;
  }
  if (anyErr?.code === '22P02') {
    res.status(400).json({ error: { code: 'bad_request', message: 'Invalid identifier or value.' } });
    return;
  }
  console.error('[unhandled]', anyErr?.message ?? err);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on our side. Please try again.' } });
}
