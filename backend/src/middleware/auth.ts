import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env, isProd } from '../config/env';
import { query } from '../db/pool';
import { HttpError } from './error';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

export interface AuthedRequest extends Request {
  user: AuthUser;
}

export const SESSION_COOKIE = 'ri_session';
const SESSION_TTL_S = 7 * 24 * 3600;

export function setSessionCookie(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: SESSION_TTL_S });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: SESSION_TTL_S * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Accepts the session cookie, or `Authorization: Bearer <token>` (handy for Postman). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    const token = req.cookies?.[SESSION_COOKIE] ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!token) throw new HttpError(401, 'Not authenticated');

    let sub: string;
    try {
      sub = (jwt.verify(token, env.JWT_SECRET) as { sub: string }).sub;
    } catch {
      throw new HttpError(401, 'Session expired');
    }
    const { rows } = await query<AuthUser>('SELECT id, email, name, avatar_url FROM users WHERE id = $1', [sub]);
    if (!rows[0]) throw new HttpError(401, 'User not found');
    (req as AuthedRequest).user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

/** Short-lived signed state for OAuth round-trips (CSRF protection + carries userId). */
export const signState = (payload: object) => jwt.sign(payload, env.JWT_SECRET, { expiresIn: '10m' });
export const verifyState = <T>(state: string) => jwt.verify(state, env.JWT_SECRET) as T;
