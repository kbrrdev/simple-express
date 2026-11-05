import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config({ quiet: true });

interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  CORS_ORIGINS: string[];
  JWT_SECRET: string;
  BLOG_CUSTOMER_WRITES_ENABLED: boolean;
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

const envSchema = Joi.object<Env>({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  CORS_ORIGINS: Joi.string().empty('').default([]).custom(parseOrigins),
  JWT_SECRET: Joi.string().min(32).required(),
  BLOG_CUSTOMER_WRITES_ENABLED: Joi.boolean().empty('').default(true),
}).unknown();

const { error, value } = envSchema.validate(process.env, { abortEarly: false });

if (error) {
  throw new Error(`Invalid environment: ${error.message}`);
}

export const env = value as Env;
