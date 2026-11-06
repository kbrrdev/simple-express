import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { routes } from './routes';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY_HOPS);

app.use(
  helmet({
    // Storefronts on other origins load uploaded images from here.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // Would break Swagger UI when developing over plain HTTP.
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
  }),
);

// Runs before body parsing so that error responses also carry CORS headers.
app.use(cors({ origin: env.CORS_ORIGINS, credentials: true, exposedHeaders: ['Location'] }));
app.use(express.json());
app.use(cookieParser());

app.use(routes);

app.use(notFoundHandler);
app.use(errorHandler);
