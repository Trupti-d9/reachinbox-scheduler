import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { createCampaign } from '../services/campaignService';
import { cancelEmail, getStats, listEmails, search } from '../services/emailService';
import { query } from '../db/pool';
import { env } from '../config/env';

export const campaignsRouter = Router();
export const emailsRouter = Router();
campaignsRouter.use(requireAuth);
emailsRouter.use(requireAuth);

const campaignSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(50_000),
  leads: z.array(z.string()).min(1).max(50_000),
  startAt: z.coerce.date(),
  delayMs: z.coerce.number().int().min(0).max(3_600_000).default(env.MIN_DELAY_BETWEEN_EMAILS_MS),
  hourlyLimit: z.coerce.number().int().min(1).max(100_000).default(env.MAX_EMAILS_PER_HOUR_PER_SENDER),
});

/** Schedule a campaign: one subject/body sent to many leads. */
campaignsRouter.post(
  '/',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = campaignSchema.parse(req.body);
    const result = await createCampaign({
      userId: req.user.id,
      ...body,
      idempotencyKey: req.header('Idempotency-Key') ?? undefined,
    });
    res.status(result.replay ? 200 : 201).json(result);
  }),
);

campaignsRouter.get(
  '/',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { rows } = await query(
      `SELECT c.*,
         count(e.*) FILTER (WHERE e.status IN ('scheduled','processing')) AS pending,
         count(e.*) FILTER (WHERE e.status = 'sent') AS sent,
         count(e.*) FILTER (WHERE e.status = 'failed') AS failed
       FROM campaigns c LEFT JOIN emails e ON e.campaign_id = c.id
       WHERE c.user_id = $1 GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`,
      [req.user.id],
    );
    res.json({ items: rows });
  }),
);

/** Schedule a single email (convenient for Postman). */
emailsRouter.post(
  '/',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = z
      .object({
        to: z.string().email(),
        subject: z.string().trim().min(1),
        body: z.string().trim().min(1),
        scheduledAt: z.coerce.date().default(() => new Date()),
      })
      .parse(req.body);
    const result = await createCampaign({
      userId: req.user.id,
      subject: body.subject,
      body: body.body,
      leads: [body.to],
      startAt: body.scheduledAt,
      delayMs: 0,
      hourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      idempotencyKey: req.header('Idempotency-Key') ?? undefined,
    });
    res.status(result.replay ? 200 : 201).json(result);
  }),
);

emailsRouter.get(
  '/',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const q = z
      .object({
        type: z.enum(['scheduled', 'sent']).default('scheduled'),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    res.json(await listEmails(req.user.id, q.type, q.page, q.pageSize));
  }),
);

emailsRouter.get(
  '/stats',
  asyncHandler<AuthedRequest>(async (req, res) => {
    res.json(await getStats(req.user.id));
  }),
);

emailsRouter.get(
  '/search',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const q = z
      .object({ q: z.string().trim().default(''), type: z.enum(['scheduled', 'sent']).optional() })
      .parse(req.query);
    res.json(await search(req.user.id, q.q, q.type));
  }),
);

emailsRouter.delete(
  '/:id',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    res.json(await cancelEmail(req.user.id, id));
  }),
);
