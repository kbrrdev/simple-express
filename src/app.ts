import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { routes } from './routes';

export const app = express();

app.disable('x-powered-by');

// Runs before body parsing so that error responses also carry CORS headers.
app.use(cors({ origin: env.CORS_ORIGINS, credentials: true, exposedHeaders: ['Location'] }));
app.use(express.json());
app.use(cookieParser());

app.use(routes);

app.use(notFoundHandler);
app.use(errorHandler);
