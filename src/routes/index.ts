import { sql } from 'drizzle-orm';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { db } from '../db';
import { openApiDocument } from '../docs/openapi';
import { authRoutes } from '../modules/auth/auth.routes';
import { blogRoutes } from '../modules/blogs/blog.routes';
import { categoryRoutes } from '../modules/categories/category.routes';
import { productRoutes } from '../modules/products/product.routes';

const apiRoutes = Router();

// Register each module here. Paths are relative to /api.
apiRoutes.use('/auth', authRoutes);
apiRoutes.use('/blogs', blogRoutes);
apiRoutes.use('/categories', categoryRoutes);
apiRoutes.use('/products', productRoutes);

export const routes = Router();

routes.get('/health', async (_req, res) => {
  await db.execute(sql`select 1`);
  res.json({ status: 'ok' });
});

routes.get('/api-docs.json', (_req, res) => {
  res.json(openApiDocument);
});
routes.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

routes.use('/api', apiRoutes);
