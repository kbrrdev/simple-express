import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config({ quiet: true });

interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  APP_ENV: 'development' | 'staging' | 'production';
  LOG_LEVEL: string;
  PORT: number;
  DATABASE_URL: string;
  MIGRATION_DATABASE_URL?: string;
  TRUST_PROXY_HOPS: number;
  CORS_ORIGINS: string[];
  JWT_SECRET: string;
  PUBLIC_BASE_URL: string;
  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  EMAIL_FROM?: string;
  TAX_RATE_PERCENT: number;
  PRICES_INCLUDE_TAX: boolean;
  SHIPPING_FEE_CENTS: number;
  PAYMENT_WINDOW_HOURS: number;
  MAX_OPEN_UNPAID_ORDERS: number;
  UPLOADS_DIR: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_ENDPOINT?: string;
  S3_PUBLIC_URL?: string;
}

const isOrigin = (value: string) => URL.canParse(value) && new URL(value).origin === value;

/** Parses a comma-separated list, rejecting anything the browser would never match. */
const parseOrigins: Joi.CustomValidator<string, string[]> = (value, helpers) => {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.every(isOrigin) ? origins : helpers.error('any.invalid');
};

const url = Joi.string().uri().empty('').replace(/\/+$/, '');

/** Required once S3_BUCKET is set, so that a partial setup fails at startup. */
const s3Setting = Joi.string()
  .empty('')
  .when('S3_BUCKET', { is: Joi.exist(), then: Joi.required() });

const envSchema = Joi.object<Env>({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  // Follows NODE_ENV when unset, so a production server cannot expose Swagger by accident.
  APP_ENV: Joi.string()
    .valid('development', 'staging', 'production')
    .empty('')
    .default((parent: { NODE_ENV: string }) =>
      parent.NODE_ENV === 'production' ? 'production' : 'development',
    ),
  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error', 'silent')
    .empty('')
    .default('info'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  MIGRATION_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .empty(''),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).empty('').default(0),
  CORS_ORIGINS: Joi.string().empty('').default([]).custom(parseOrigins),
  JWT_SECRET: Joi.string().min(32).required(),
  PUBLIC_BASE_URL: url.default('http://localhost:3000'),
  SMTP_HOST: Joi.string().empty(''),
  SMTP_PORT: Joi.number().port().empty('').default(1025),
  SMTP_USER: Joi.string().empty(''),
  SMTP_PASSWORD: Joi.string()
    .empty('')
    .when('SMTP_USER', { is: Joi.exist(), then: Joi.required() }),
  EMAIL_FROM: Joi.string().empty('').when('SMTP_HOST', { is: Joi.exist(), then: Joi.required() }),
  TAX_RATE_PERCENT: Joi.number().min(0).max(100).precision(2).empty('').default(12),
  PRICES_INCLUDE_TAX: Joi.boolean().empty('').default(true),
  SHIPPING_FEE_CENTS: Joi.number().integer().min(0).empty('').default(10000),
  PAYMENT_WINDOW_HOURS: Joi.number().integer().min(1).empty('').default(24),
  MAX_OPEN_UNPAID_ORDERS: Joi.number().integer().min(1).empty('').default(5),
  UPLOADS_DIR: Joi.string().empty('').default('uploads'),
  S3_BUCKET: Joi.string().empty(''),
  S3_REGION: s3Setting,
  S3_ACCESS_KEY_ID: s3Setting,
  S3_SECRET_ACCESS_KEY: s3Setting,
  S3_ENDPOINT: url,
  S3_PUBLIC_URL: url.when('S3_ENDPOINT', { is: Joi.exist(), then: Joi.required() }),
}).unknown();

const { error, value } = envSchema.validate(process.env, { abortEarly: false });

if (error) {
  throw new Error(`Invalid environment: ${error.message}`);
}

export const env = value as Env;
