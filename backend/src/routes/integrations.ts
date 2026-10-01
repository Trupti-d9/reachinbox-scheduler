import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth, signState, verifyState } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import {
  buildSlackAuthorizeUrl,
  completeSlackOAuth,
  disconnectSlack,
  getSlackConnection,
  notifySlack,
  slackConfigured,
} from '../lib/slack';
import { createEtherealSender, listActiveSenders, publicSender } from '../lib/senders';
import { getSenderUsage } from '../queue/rateLimiter';
import { env } from '../config/env';
import { createLogger } from '../lib/logger';

const log = createLogger('slack');

// ── Slack ──────────────────────────────────────────────────────────────────
export const slackRouter = Router();

slackRouter.get(
  '/status',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const conn = await getSlackConnection(req.user.id);
    res.json({
      configured: slackConfigured(),
      connected: !!conn,
      team: conn?.team_name ?? null,
      channel: conn?.channel_name ?? null,
    });
  }),
);

/** Step 1 of Slack OAuth: the "Connect Slack" button navigates here. */
slackRouter.get('/connect', requireAuth, (req, res) => {
  if (!slackConfigured()) throw new HttpError(500, 'Slack OAuth is not configured on the server');
  const state = signState({ userId: (req as AuthedRequest).user.id, purpose: 'slack' });
  res.redirect(buildSlackAuthorizeUrl(state));
});

/** Step 2: Slack redirects back with ?code&state. The signed state carries the user id. */
slackRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    try {
      if (error || !code || !state) throw new Error(error ?? 'missing code');
      const { userId, purpose } = verifyState<{ userId: string; purpose: string }>(state);
      if (purpose !== 'slack') throw new Error('bad state');
      await completeSlackOAuth(userId, code);
      await notifySlack(userId, ':white_check_mark: ReachInbox Scheduler is connected. You will be alerted here when a sender hits its hourly limit.');
      res.redirect(`${env.FRONTEND_URL}/dashboard?slack=connected`);
    } catch (err) {
      log.warn('Slack OAuth failed', { err: String(err) });
      res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error`);
    }
  }),
);

slackRouter.post(
  '/test',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const ok = await notifySlack(req.user.id, ':bell: Test message from ReachInbox Scheduler.');
    if (!ok) throw new HttpError(400, 'Slack is not connected');
    res.json({ ok });
  }),
);

slackRouter.delete(
  '/',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    await disconnectSlack(req.user.id);
    res.json({ ok: true });
  }),
);

// ── Senders ────────────────────────────────────────────────────────────────
export const sendersRouter = Router();
sendersRouter.use(requireAuth);

sendersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const senders = await listActiveSenders();
    const usage = await getSenderUsage(senders.map((s) => s.id));
    res.json({
      limitPerHour: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      minDelayMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
      items: senders.map((s) => ({ ...publicSender(s), sentThisHour: usage[s.id] ?? 0 })),
    });
  }),
);

/** Adds another sender by creating a fresh Ethereal inbox. */
sendersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name } = z.object({ name: z.string().optional() }).parse(req.body ?? {});
    const s = await createEtherealSender(name);
    res.status(201).json(publicSender(s));
  }),
);
