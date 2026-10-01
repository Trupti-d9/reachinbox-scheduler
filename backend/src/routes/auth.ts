import { Router } from 'express';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { env, isProd } from '../config/env';
import { query } from '../db/pool';
import {
  AuthedRequest,
  AuthUser,
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
  signState,
  verifyState,
} from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { createLogger } from '../lib/logger';

const log = createLogger('auth');
export const authRouter = Router();

const redirectUri = () => `${env.BACKEND_URL}/api/auth/google/callback`;
const googleClient = () => new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri());
const devLoginEnabled = () => env.ALLOW_DEV_LOGIN && !isProd;

async function upsertUser(u: { googleId: string | null; email: string; name: string; avatar: string | null }) {
  const { rows } = await query<AuthUser>(
    `INSERT INTO users (google_id, email, name, avatar_url) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET google_id = COALESCE(EXCLUDED.google_id, users.google_id),
       name = EXCLUDED.name, avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
     RETURNING id, email, name, avatar_url`,
    [u.googleId, u.email.toLowerCase(), u.name, u.avatar],
  );
  return rows[0];
}

/** Tells the frontend which login options exist. */
authRouter.get('/config', (_req, res) => {
  res.json({ googleConfigured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), devLogin: devLoginEnabled() });
});

/** Step 1: redirect to Google's consent screen. */
authRouter.get('/google', (_req, res) => {
  if (!env.GOOGLE_CLIENT_ID) throw new HttpError(500, 'Google OAuth is not configured');
  const state = signState({ nonce: crypto.randomUUID(), purpose: 'google' });
  const url = googleClient().generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
    state,
  });
  res.redirect(url);
});

/** Step 2: Google redirects back here with ?code — verify it and start a session. */
authRouter.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error || !code || !state) return res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(error ?? 'missing_code')}`);
    try {
      verifyState<{ purpose: string }>(state);
      const client = googleClient();
      const { tokens } = await client.getToken(code);
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token!, audience: env.GOOGLE_CLIENT_ID });
      const p = ticket.getPayload();
      if (!p?.email || !p.email_verified) throw new Error('Google account email not verified');
      const user = await upsertUser({ googleId: p.sub, email: p.email, name: p.name ?? p.email, avatar: p.picture ?? null });
      setSessionCookie(res, user.id);
      log.info('login', { email: user.email });
      res.redirect(`${env.FRONTEND_URL}/dashboard`);
    } catch (err) {
      log.warn('Google login failed', { err: String(err) });
      res.redirect(`${env.FRONTEND_URL}/login?error=google_login_failed`);
    }
  }),
);

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: (req as AuthedRequest).user });
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

/**
 * Local testing only (off by default, always off in production). Lets you run
 * the API from Postman/scripts without a browser. The real app uses Google.
 */
authRouter.post(
  '/dev-login',
  asyncHandler(async (req, res) => {
    if (!devLoginEnabled()) throw new HttpError(404, 'Not found');
    const body = z.object({ email: z.string().email(), name: z.string().default('Dev User') }).parse(req.body);
    const user = await upsertUser({ googleId: null, email: body.email, name: body.name, avatar: null });
    setSessionCookie(res, user.id);
    res.json({ user });
  }),
);
