import { readFileSync } from 'node:fs';
import type { Request, Response } from 'express';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import { users } from '../src/db/schema';
import { openApiDocument } from '../src/docs/openapi';
import { buildPostmanCollection } from '../src/docs/postman';
import { toSafeLog } from '../src/lib/db-errors';
import { logger } from '../src/lib/logger';
import { errorHandler } from '../src/middleware/error-handler';

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

describe('error logs', () => {
  const failedInsert = async () => {
    try {
      await db.insert(users).values({
        email: 'secret-person@example.com',
        passwordHash: 'SECRET-HASH-VALUE',
        role: 'nope' as 'admin',
      });
    } catch (error) {
      return error;
    }

    throw new Error('Expected the insert to fail');
  };

  it('keep query values out of unexpected errors', async () => {
    const error = await failedInsert();
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as unknown as Response;

    errorHandler(error, {} as Request, res, vi.fn());

    const logged = JSON.stringify(log.mock.calls);
    log.mockRestore();

    expect(logged).toContain('insert into');
    expect(logged).not.toContain('SECRET-HASH-VALUE');
    expect(logged).not.toContain('secret-person@example.com');
    expect(json).toHaveBeenCalledWith({
      error: { message: 'Internal server error', requestId: undefined },
    });
  });

  it('keep the kind of failure, for debugging', async () => {
    expect(toSafeLog(await failedInsert())).toMatchObject({
      message: 'Database query failed',
      code: '22P02',
    });
  });

  it('leave other errors unchanged', () => {
    const error = new Error('Something else');

    expect(toSafeLog(error)).toBe(error);
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

  it('is served in staging, which runs with NODE_ENV production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ENV', 'staging');
    vi.resetModules();

    const fresh = await import('../src/app.js');
    const db = await import('../src/db/index.js');

    await request(fresh.app).get('/api-docs.json').expect(200);
    await db.pool.end();
  });

  it('is not served when APP_ENV is left out of a production server', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ENV', '');
    vi.resetModules();

    const fresh = await import('../src/app.js');
    const db = await import('../src/db/index.js');

    await request(fresh.app).get('/api-docs.json').expect(404);
    await db.pool.end();
  });

  it('rejects an unknown environment at startup', async () => {
    vi.stubEnv('APP_ENV', 'prod');
    vi.resetModules();

    await expect(import('../src/config/env.js')).rejects.toThrow('APP_ENV');
  });

  it('is not served in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ENV', 'production');
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
