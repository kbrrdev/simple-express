import { sql } from 'drizzle-orm';
import express, { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { env } from '../config/env';
import { db } from '../db';
import { openApiDocument } from '../docs/openapi';
import { usesS3 } from '../lib/storage';
import { addressRoutes } from '../modules/addresses/address.routes';
import { assetRoutes } from '../modules/assets/asset.routes';
import { authRoutes } from '../modules/auth/auth.routes';
import { blogRoutes } from '../modules/blogs/blog.routes';
import { cartRoutes } from '../modules/cart/cart.routes';
import { categoryRoutes } from '../modules/categories/category.routes';
import { orderRoutes } from '../modules/orders/order.routes';
import { productRoutes } from '../modules/products/product.routes';

const apiRoutes = Router();

// Register each module here. Paths are relative to /api.
apiRoutes.use('/addresses', addressRoutes);
apiRoutes.use('/assets', assetRoutes);
apiRoutes.use('/auth', authRoutes);
apiRoutes.use('/blogs', blogRoutes);
apiRoutes.use('/cart', cartRoutes);
apiRoutes.use('/categories', categoryRoutes);
apiRoutes.use('/orders', orderRoutes);
apiRoutes.use('/products', productRoutes);

export const routes = Router();

routes.get('/health', async (_req, res) => {
  await db.execute(sql`select 1`);
  res.json({ status: 'ok' });
});

if (env.NODE_ENV !== 'production') {
  routes.get('/api-docs.json', (_req, res) => {
    res.json(openApiDocument);
  });
  routes.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
}

routes.use('/api', apiRoutes);

if (!usesS3) {
  routes.use(
    '/uploads',
    express.static(env.UPLOADS_DIR, {
      index: false,
      maxAge: '1y',
      immutable: true,
    }),
  );
}
