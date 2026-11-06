import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { openApiDocument } from '../src/docs/openapi';
import { buildPostmanCollection } from '../src/docs/postman';

const login = (ip: string) =>
  request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({});

async function attemptsFromManyIps(prefix: string) {
  const statuses = [];

  for (let index = 1; index <= 11; index++) {
    statuses.push((await login(`${prefix}.${index}`)).status);
  }

  return statuses;
}

afterEach(() => {
  app.set('trust proxy', 0);
  vi.unstubAllEnvs();
  vi.resetModules();
});

afterAll(async () => {
  await pool.end();
});

describe('client IP address', () => {
  it('ignores X-Forwarded-For by default, so it cannot dodge rate limits', async () => {
    const statuses = await attemptsFromManyIps('203.0.113');

    expect(statuses).toContain(429);
  });

  it('uses X-Forwarded-For behind a trusted proxy, so customers are limited separately', async () => {
    app.set('trust proxy', 1);

    const statuses = await attemptsFromManyIps('198.51.100');

    expect(statuses).not.toContain(429);
  });

  it('reads the number of proxies from the environment', async () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '2');
    vi.resetModules();

    const fresh = await import('../src/app.js');
    const db = await import('../src/db/index.js');

    expect(fresh.app.get('trust proxy')).toBe(2);
    await db.pool.end();
  });
});

describe('security headers', () => {
  it('are sent on API responses', async () => {
    const { headers } = await request(app).get('/health').expect(200);

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['strict-transport-security']).toContain('max-age');
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  it('are sent on errors', async () => {
    const { headers } = await request(app).get('/nope').expect(404);

    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  it('let other origins load uploaded images', async () => {
    const { headers } = await request(app).get('/health').expect(200);

    expect(headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('do not force HTTPS on Swagger UI in development', async () => {
    const { headers } = await request(app).get('/health').expect(200);

    expect(headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
  });
});

describe('API documentation', () => {
  it('is available outside production', async () => {
    await request(app).get('/api-docs.json').expect(200);
    await request(app).get('/api-docs/').expect(200);
  });

  it('is not served in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();

    const fresh = await import('../src/app.js');
    const db = await import('../src/db/index.js');

    await request(fresh.app).get('/api-docs.json').expect(404);
    await request(fresh.app).get('/api-docs/').expect(404);
    await request(fresh.app).get('/health').expect(200);
    await db.pool.end();
  });
});

describe('Postman collection', () => {
  const countRequests = (collection: ReturnType<typeof buildPostmanCollection>) =>
    collection.item.reduce((total, folder) => total + folder.item.length, 0);

  it('matches the OpenAPI document', () => {
    const saved = JSON.parse(readFileSync('docs/postman-collection.json', 'utf8'));

    expect(saved).toEqual(buildPostmanCollection());
  });

  it('includes every operation', () => {
    const operations = Object.values(openApiDocument.paths).flatMap((methods) =>
      Object.keys(methods),
    );

    expect(countRequests(buildPostmanCollection())).toBe(operations.length);
  });
});
