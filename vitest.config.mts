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
      JWT_SECRET: 'test-only-secret-that-is-at-least-32-characters',
      CORS_ORIGINS: 'http://localhost:5173',
    },
  },
});
