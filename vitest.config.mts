import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'vitest/config';

dotenv.config({ quiet: true });

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error('Set TEST_DATABASE_URL in .env');
}

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: 'tests/global-setup.ts',
    fileParallelism: false,
    env: {
      DATABASE_URL: testDatabaseUrl,
      APP_ENV: 'development',
      LOG_LEVEL: 'silent',
      MIGRATION_DATABASE_URL: '',
      TRUST_PROXY_HOPS: '0',
      JWT_SECRET: 'test-only-secret-that-is-at-least-32-characters',
      CORS_ORIGINS: 'http://localhost:5173',
      PUBLIC_BASE_URL: 'http://localhost:3000',
      TAX_RATE_PERCENT: '12',
      PRICES_INCLUDE_TAX: 'true',
      SHIPPING_FEE_CENTS: '10000',
      PAYMENT_WINDOW_HOURS: '24',
      MAX_OPEN_UNPAID_ORDERS: '1000',
      UPLOADS_DIR: join(tmpdir(), 'simple-express-test-uploads'),
      S3_BUCKET: '',
      S3_REGION: '',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
      S3_ENDPOINT: '',
      S3_PUBLIC_URL: '',
    },
  },
});
