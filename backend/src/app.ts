import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { env } from './config/env';
import { emailQueue } from './queue/emailQueue';
import { authRouter } from './routes/auth';
import { campaignsRouter, emailsRouter } from './routes/emails';
import { sendersRouter, slackRouter } from './routes/integrations';
import { errorHandler } from './middleware/error';
import { elasticAvailable } from './lib/elastic';
import { pool } from './db/pool';
import { redis } from './lib/redis';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(morgan('dev'));

  app.get('/api/health', async (_req, res) => {
    const [db, rd] = await Promise.all([
      pool.query('SELECT 1').then(() => true, () => false),
      redis.ping().then(() => true, () => false),
    ]);
    res.status(db && rd ? 200 : 503).json({ ok: db && rd, postgres: db, redis: rd, elasticsearch: elasticAvailable() });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      workerConcurrency: env.WORKER_CONCURRENCY,
      minDelayBetweenEmailsMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
      maxEmailsPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/campaigns', campaignsRouter);
  app.use('/api/emails', emailsRouter);
  app.use('/api/senders', sendersRouter);
  app.use('/api/slack', slackRouter);

  // ── Live BullMQ dashboard at /admin/queues ─────────────────────────────
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');
  createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
  app.use('/admin/queues', bullBoardAuth, serverAdapter.getRouter());

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}

/** Optional HTTP basic auth for Bull Board (enabled when BULL_BOARD_USER/PASS are set). */
function bullBoardAuth(req: Request, res: Response, next: NextFunction) {
  if (!env.BULL_BOARD_USER) return next();
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
  const [user, pass] = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':') : [];
  if (user === env.BULL_BOARD_USER && pass === env.BULL_BOARD_PASS) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
  res.status(401).send('Authentication required');
}
