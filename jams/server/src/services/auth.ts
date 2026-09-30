import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { config, isProd } from '../config.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { AppError, unauthorized } from '../lib/errors.js';
import { seedPipelineStages } from './settings.js';

export const SESSION_COOKIE = 'jams_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function userCount() {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return r.n;
}

export async function emailTaken(email: string) {
  const [r] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase()));
  return !!r;
}

export async function createUser(input: { email: string; name: string; password: string }) {
  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({ email: input.email.toLowerCase(), name: input.name, passwordHash, settings: {} })
    .returning({ id: users.id });
  await seedPipelineStages(db, user.id);
  return user;
}

export async function authenticate(email: string, password: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  // Always run a hash comparison to keep timing similar for unknown emails.
  const ok = await verifyPassword(password, user?.passwordHash ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
  return user && ok ? user : null;
}

export async function createSession(userId: string, userAgent?: string) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, csrfToken, userAgent: userAgent?.slice(0, 300), expiresAt });
  // Opportunistic cleanup of expired sessions.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { token, csrfToken, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(token: string | undefined) {
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function destroyAllSessions(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function loadSession(token: string | undefined) {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const [s] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
  if (!s) return null;
  // Sliding expiration, written at most every 5 minutes.
  if (Date.now() - s.lastSeenAt.getTime() > 5 * 60_000) {
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 86_400_000);
    await db.update(sessions).set({ lastSeenAt: new Date(), expiresAt }).where(eq(sessions.id, id));
    s.expiresAt = expiresAt;
  }
  return s;
}

/** Requires a valid session; for unsafe methods also requires the per-session CSRF token header. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await loadSession(req.cookies?.[SESSION_COOKIE]);
    if (!session) throw unauthorized('Your session has expired. Please sign in again.');
    if (!SAFE_METHODS.has(req.method)) {
      const header = req.get('x-csrf-token') ?? '';
      const a = Buffer.from(header);
      const b = Buffer.from(session.csrfToken);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError(403, 'csrf', 'Security token missing or invalid. Reload the page.');
    }
    Object.assign(req, { userId: session.userId, sessionId: session.id, csrfToken: session.csrfToken });
    next();
  } catch (e) {
    next(e);
  }
}

export async function changePassword(userId: string, current: string, next: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !(await verifyPassword(current, user.passwordHash))) throw new AppError(400, 'bad_password', 'Current password is incorrect.');
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
}

export async function verifyUserPassword(userId: string, password: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  return !!user && (await verifyPassword(password, user.passwordHash));
}
