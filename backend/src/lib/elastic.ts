import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env';
import { createLogger } from './logger';

const log = createLogger('elastic');

/**
 * Elasticsearch keeps a searchable copy of every scheduled/sent email.
 * Postgres stays the source of truth; ES is a derived index. If ES is down we
 * log and carry on — search falls back to Postgres — so sending never blocks on it.
 */
export const es = env.ELASTICSEARCH_ENABLED ? new Client({ node: env.ELASTICSEARCH_URL }) : null;
const INDEX = env.ELASTICSEARCH_INDEX;
let available = false;

export interface EmailDoc {
  id: string;
  userId: string;
  campaignId: string;
  to: string;
  from: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  error?: string | null;
}

export async function initElastic() {
  if (!es) return;
  try {
    const exists = await es.indices.exists({ index: INDEX });
    if (!exists) {
      await es.indices.create({
        index: INDEX,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            userId: { type: 'keyword' },
            campaignId: { type: 'keyword' },
            to: { type: 'text', fields: { raw: { type: 'keyword' } } },
            from: { type: 'text', fields: { raw: { type: 'keyword' } } },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
            error: { type: 'text' },
          },
        },
      });
      log.info(`created index "${INDEX}"`);
    }
    available = true;
  } catch (err) {
    available = false;
    log.warn('Elasticsearch unavailable — search will fall back to Postgres', { err: String(err) });
  }
}

export const elasticAvailable = () => !!es && available;

export async function indexEmails(docs: EmailDoc[]) {
  if (!es || !available || !docs.length) return;
  try {
    const CHUNK = 1000;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const operations = docs.slice(i, i + CHUNK).flatMap((d) => [{ index: { _index: INDEX, _id: d.id } }, d]);
      const res = await es.bulk({ operations, refresh: false });
      if (res.errors) log.warn('some documents failed to index');
    }
  } catch (err) {
    log.warn('bulk index failed', { err: String(err) });
  }
}

export async function updateEmailDoc(id: string, patch: Partial<EmailDoc>) {
  if (!es || !available) return;
  try {
    await es.update({ index: INDEX, id, doc: patch, retry_on_conflict: 3 });
  } catch (err) {
    log.warn('update failed', { id, err: String(err) });
  }
}

export async function searchEmails(userId: string, q: string, status?: string[], limit = 50) {
  if (!es) throw new Error('Elasticsearch disabled');
  const filter: object[] = [{ term: { userId } }];
  if (status?.length) filter.push({ terms: { status } });
  const res = await es.search<EmailDoc>({
    index: INDEX,
    size: limit,
    query: {
      bool: {
        filter,
        must: q
          ? [{ multi_match: { query: q, fields: ['to^3', 'subject^2', 'body', 'from'], fuzziness: 'AUTO' } }]
          : [{ match_all: {} }],
      },
    },
    sort: q ? undefined : [{ scheduledAt: 'desc' }],
  });
  return res.hits.hits.map((h) => h._source!).filter(Boolean);
}
