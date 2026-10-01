# ReachInbox Scheduler

A full-stack email scheduling service with a dashboard. It accepts email campaigns through an API, schedules each email as a BullMQ delayed job, and sends them through Ethereal SMTP. It enforces per-sender rate limits and survives server restarts without losing or duplicating emails.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, TypeScript, Express |
| Queue | BullMQ on Redis |
| Database | PostgreSQL |
| Search | Elasticsearch |
| Email | Nodemailer with Ethereal SMTP |
| Frontend | React, TypeScript, Vite, Tailwind CSS, TanStack Query |
| Auth | Google OAuth 2.0 |
| Alerts | Slack OAuth 2.0 |
| Queue monitoring | Bull Board |

## Project Structure

```
reachinbox-scheduler/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── db/
│   │   ├── lib/
│   │   ├── middleware/
│   │   ├── queue/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── workers/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   └── worker.ts
│   ├── scripts/
│   └── .env.example
├── frontend/
│   └── src/
│       ├── api/
│       ├── components/
│       ├── features/
│       ├── hooks/
│       ├── lib/
│       └── pages/
├── samples/leads.csv
├── postman_collection.json
└── docker-compose.yml
```

| Folder | Purpose |
|---|---|
| `backend/src/config` | Environment variable loading and validation |
| `backend/src/db` | Connection pool, SQL migrations, migration runner |
| `backend/src/queue` | BullMQ queue, hourly rate limiter, per-sender throttle |
| `backend/src/workers` | Email worker that processes and sends jobs |
| `backend/src/services` | Campaign scheduling, email queries, restart reconciliation |
| `backend/src/routes` | Auth, campaigns, emails, senders and Slack endpoints |
| `backend/src/lib` | SMTP senders, Elasticsearch, Slack, Redis, logger |
| `frontend/src/components` | Reusable UI components and layout |
| `frontend/src/features` | Compose modal, email tables, Slack and sender cards |
| `frontend/src/pages` | Login and dashboard pages |

## Getting Started

### Prerequisites

- Node.js 20 or later
- Docker and Docker Compose

### 1. Start the infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL on port 5432, Redis on port 6379 with AOF persistence, and Elasticsearch on port 9200.

### 2. Run the backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

`npm run dev` starts the API on `http://localhost:4000` and the BullMQ worker together. Database migrations run automatically on startup.

To run the API and worker as separate processes:

```bash
npm run dev:api
npm run dev:worker
```

You can start more than one worker to scale sending.

For a production build:

```bash
npm run build
npm start
npm run start:worker
```

### 3. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` and `/admin` to the backend.

### Useful URLs

| Page | URL |
|---|---|
| Dashboard | http://localhost:5173 |
| Bull Board | http://localhost:4000/admin/queues |
| Health check | http://localhost:4000/api/health |

## Configuration

### Ethereal Email

No manual setup is needed. On first start, if there are no senders in the database, the backend creates Ethereal test inboxes and saves them as senders. The number created is set by `AUTO_CREATE_ETHEREAL_SENDERS`, which defaults to 2.

To use your own Ethereal accounts, create them at https://ethereal.email/create and add them to `.env`:

```
ETHEREAL_SENDERS=[{"name":"Sales 1","email":"a@ethereal.email","pass":"password1"},{"name":"Sales 2","email":"b@ethereal.email","pass":"password2"}]
```

Each sent email has a Preview link in the dashboard that opens the message in the Ethereal inbox.

### Google OAuth

1. Open Google Cloud Console and go to **APIs & Services → OAuth consent screen**. Choose External and add your account as a test user.
2. Go to **Credentials → Create Credentials → OAuth client ID** and choose **Web application**.
3. Add this authorized redirect URI:
   ```
   http://localhost:4000/api/auth/google/callback
   ```
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.

### Slack OAuth

1. Go to https://api.slack.com/apps and choose **Create New App → From scratch**.
2. Under **OAuth & Permissions**, add the bot token scopes `incoming-webhook` and `chat:write`.
3. Slack needs an HTTPS redirect URL, so expose the backend through a tunnel:
   ```bash
   ngrok http 4000
   ```
4. Add the redirect URL `https://<your-tunnel>/api/slack/callback` in the Slack app settings.
5. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_REDIRECT_URI` in `.env`.
6. Click **Connect Slack** on the dashboard and choose a channel.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | 4000 | API port |
| `DATABASE_URL` | postgres://postgres:postgres@localhost:5432/reachinbox | PostgreSQL connection string |
| `REDIS_URL` | redis://localhost:6379 | Redis connection string |
| `ELASTICSEARCH_URL` | http://localhost:9200 | Elasticsearch node |
| `JWT_SECRET` | | Secret used to sign session tokens |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | | Google OAuth credentials |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_REDIRECT_URI` | | Slack OAuth credentials |
| `ETHEREAL_SENDERS` | | JSON list of sender accounts |
| `AUTO_CREATE_ETHEREAL_SENDERS` | 2 | Ethereal inboxes to create when no senders exist |
| `WORKER_CONCURRENCY` | 5 | Jobs processed in parallel by each worker |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | 2000 | Minimum gap between two sends from the same sender |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | 50 | Maximum emails per sender in one window |
| `RATE_LIMIT_WINDOW_MS` | 3600000 | Length of a rate-limit window |
| `JOB_MAX_ATTEMPTS` | 3 | Send attempts before an email is marked failed |
| `JOB_BACKOFF_MS` | 10000 | Base delay for exponential retry backoff |
| `STALE_PROCESSING_MS` | 120000 | Time after which an abandoned send can be taken over |
| `RUN_WORKER_IN_API` | false | Run the worker inside the API process |
| `BULL_BOARD_USER` / `BULL_BOARD_PASS` | | Optional basic auth for Bull Board |

## Architecture

```
React Dashboard
      │
      ▼
 Express API ───────► PostgreSQL
      │        └────► Elasticsearch
      ▼
 Redis / BullMQ
      │
      ▼
 Worker (concurrency N)
   1. Load the email and skip it if it is not scheduled
   2. Reserve a rate-limit slot in Redis
   3. Claim the email atomically
   4. Wait for the per-sender delay
   5. Send through SMTP and mark it as sent
```

### Scheduling

1. `POST /api/campaigns` validates the request, normalizes and de-duplicates the leads, and assigns senders in round-robin order.
2. Each email gets a planned send time based on the start time, the delay between emails, and the hourly limit.
3. All email rows are inserted in a single database transaction.
4. After the transaction commits, each email is added to BullMQ as a delayed job. The job ID is the email ID, and the delay is the planned send time minus the current time.
5. BullMQ holds delayed jobs in Redis and releases each one when it is due. No cron jobs are used.

### Persistence on Restart

- PostgreSQL is the source of truth for every email and its status.
- Redis runs with AOF persistence, so delayed jobs survive Redis restarts as well.
- After a restart, BullMQ continues with the existing delayed jobs. Emails are sent at their original times and nothing starts over.
- On shutdown, the worker finishes in-progress sends before the process exits.
- If a worker crashes mid-job, BullMQ detects the stalled job and puts it back in the queue.
- On every worker start, a reconciliation step resets emails stuck in processing and re-enqueues any scheduled email that has no job in Redis.

### Idempotency

The same email is never sent more than once:

- **Job ID:** the BullMQ job ID equals the email ID, so the same email cannot be queued twice.
- **Atomic claim:** the worker sends only after changing the email from `scheduled` to `processing` with a single conditional update. Only one worker can succeed.
- **Status check:** emails that are already sent, failed or cancelled are skipped.
- **Idempotency-Key:** `POST /api/campaigns` accepts an `Idempotency-Key` header, so a repeated request returns the original campaign.
- **Unique constraint:** a database constraint on campaign and recipient prevents duplicate rows.

### Concurrency

Each worker processes `WORKER_CONCURRENCY` jobs in parallel, and multiple worker processes can run at the same time. Rate-limit counters, send throttling and email claims are stored in Redis or PostgreSQL rather than in memory, so parallel jobs and multiple instances stay consistent.

### Delay Between Emails

There is a minimum gap of 2 seconds between sends from the same sender, set by `MIN_DELAY_BETWEEN_EMAILS_MS`. A Redis Lua script atomically reserves the next free send slot for each sender, and the job waits until that slot before sending. This works across all workers.

### Hourly Rate Limiting

- Limits are tracked with Redis counters keyed by sender and time window, and by campaign and time window.
- One Lua script checks and increments both counters in a single atomic step, so two workers cannot take the last slot at the same time.
- The per-sender limit comes from `MAX_EMAILS_PER_HOUR_PER_SENDER`. The per-campaign limit is the hourly limit entered in the Compose form.
- When a limit is reached, the job is not dropped or failed. It is moved to the next window with `moveToDelayed`, and a sequence number keeps the original order and spaces the jobs out.
- The email's scheduled time is updated so the dashboard shows when it will be sent.

BullMQ's built-in limiter was not used because it applies to the whole queue rather than to each sender, and it cannot move jobs into the next window or trigger alerts.

### Slack Notifications

When a sender or campaign reaches its limit, a message is posted to the user's connected Slack channel.

- Only one alert is sent per sender per window.
- The Slack connection is read from the database each time an alert is sent, so connecting or disconnecting takes effect immediately without a redeploy.
- If Slack is not connected, the alert is skipped.

### Behavior Under Load

- Scheduling 1000 emails takes about 40 ms, using bulk inserts and bulk job creation.
- Sending throughput depends on the number of senders, the delay between emails, and the hourly limits.
- For example, 1000 emails with 2 senders at 50 per hour each sends 100 in the first hour. The rest move to later windows in order, and none are lost.
- Adding senders or workers increases throughput without code changes.

A load test script is included:

```bash
npm run load-test -- --count 1000 --hourly 200
```

### Search

Every email is indexed in Elasticsearch when it is scheduled, and the index is updated when its status changes. Search covers the recipient, subject, body and sender. If Elasticsearch is unavailable, sending is not affected and search falls back to PostgreSQL.

## API Reference

All endpoints except the OAuth callbacks require an authenticated session.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/auth/google` | Start Google login |
| GET | `/api/auth/me` | Get the current user |
| POST | `/api/auth/logout` | Log out |
| POST | `/api/campaigns` | Schedule a campaign |
| GET | `/api/campaigns` | List campaigns with progress |
| POST | `/api/emails` | Schedule a single email |
| GET | `/api/emails?type=scheduled` | List scheduled emails |
| GET | `/api/emails?type=sent` | List sent and failed emails |
| GET | `/api/emails/stats` | Email counts by status |
| GET | `/api/emails/search?q=` | Search emails |
| DELETE | `/api/emails/:id` | Cancel a scheduled email |
| GET | `/api/senders` | List senders and their current usage |
| GET | `/api/slack/connect` | Start Slack OAuth |
| GET | `/api/slack/status` | Slack connection status |
| POST | `/api/slack/test` | Send a test Slack message |
| DELETE | `/api/slack` | Disconnect Slack |

Example request:

```http
POST /api/campaigns
Content-Type: application/json
Idempotency-Key: 6f1c2a9e-1b2d-4c3e-9f4a-123456789abc

{
  "subject": "Quick question",
  "body": "Hi there, are you the right person for outbound?",
  "leads": ["asha@acme.io", "ravi@acme.io"],
  "startAt": "2026-10-02T09:00:00.000Z",
  "delayMs": 2000,
  "hourlyLimit": 50
}
```

A Postman collection is available in `postman_collection.json`.

## Features

### Backend

- Email scheduling with BullMQ delayed jobs and no cron
- Persistence across restarts with PostgreSQL, Redis AOF and startup reconciliation
- Idempotent sending using job IDs, atomic claims and idempotency keys
- Configurable worker concurrency, safe across multiple workers
- Minimum delay between emails per sender
- Hourly rate limits per sender and per campaign, with overflow moved to the next window
- Slack OAuth with alerts when a rate limit is reached
- Multiple senders with round-robin assignment
- Elasticsearch indexing and search
- Live queue monitoring with Bull Board
- Retries with exponential backoff, failure tracking and cancellation

### Frontend

- Google OAuth login with the user's name, email and avatar in the header
- Dashboard with Scheduled and Sent tabs, status counters and live updates
- Compose modal with CSV or TXT upload, email count, duplicate removal and validation
- Start time, delay between emails and hourly limit settings, with a duration estimate
- Email tables with loading states, empty states, pagination and preview links
- Search, Slack connection card and sender usage indicators
- Reusable UI components, typed API responses and toast notifications for errors

## Testing

The following scenarios were tested locally:

| Scenario | Result |
|---|---|
| Scheduling leads that include invalid and duplicate emails | Invalid and duplicate entries were skipped and reported |
| Sending the same request twice with the same Idempotency-Key | The original campaign was returned with no duplicates |
| Stopping the server before the send time and restarting it | All emails were sent at their original times |
| Killing the worker in the middle of a batch | The remaining emails were sent after restart with no duplicates |
| Running two workers at the same time | All emails were delivered exactly once |
| Reaching the sender rate limit | Extra emails moved to the next window and one Slack alert was sent per sender |
| Reaching the rate limit with Slack disconnected | The alert was skipped and processing continued |

## Assumptions and Trade-offs

- **Fixed time windows:** rate limits use fixed windows instead of sliding windows. This is simpler and atomic in Redis, but up to twice the limit can be sent around the boundary between two windows.
- **Narrow crash window:** if a worker crashes after the SMTP server accepts an email but before the database is updated, that email could be sent again after `STALE_PROCESSING_MS`. Each email uses a fixed Message-ID so the mail provider can detect the duplicate.
- **Planned vs actual times:** the schedule from the Compose form is a plan. The worker enforces the real limits at send time, so an email's scheduled time can move later.
- **Shared senders:** senders are shared across users and assigned round-robin.
- **Dev login:** a development-only login, enabled by `ALLOW_DEV_LOGIN`, exists for API testing. It is off by default and always disabled in production.
- **SMTP credentials:** credentials are stored in plain text in the database. In production they should be encrypted or kept in a secrets manager.
