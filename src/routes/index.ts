import { sql } from 'drizzle-orm';
import express, { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { env } from '../config/env';
import { db } from '../db';
import { openApiDocument } from '../docs/openapi';
import { usesS3 } from '../lib/storage';
import { addressRoutes } from '../modules/addresses/address.routes';
import { assetRoutes } from '../modules/assets/asset.routes';
import { auditLogRoutes } from '../modules/audit-logs/audit-log.routes';
import { authRoutes } from '../modules/auth/auth.routes';
import { bannerRoutes } from '../modules/banners/banner.routes';
import { blogRoutes } from '../modules/blogs/blog.routes';
import { cartRoutes } from '../modules/cart/cart.routes';
import { categoryRoutes } from '../modules/categories/category.routes';
import { couponRoutes } from '../modules/coupons/coupon.routes';
import { orderRoutes } from '../modules/orders/order.routes';
import { pageRoutes } from '../modules/pages/page.routes';
import { paymentMethodRoutes } from '../modules/payment-methods/payment-method.routes';
import { productRoutes } from '../modules/products/product.routes';
import { promotionRoutes } from '../modules/promotions/promotion.routes';
import { reportRoutes } from '../modules/reports/report.routes';
import { roleRoutes } from '../modules/roles/role.routes';
import { saleRoutes } from '../modules/sales/sale.routes';
import { storeInfoRoutes } from '../modules/store-info/store-info.routes';
import { userRoutes } from '../modules/users/user.routes';

const apiRoutes = Router();

// Register each module here. Paths are relative to /api.
apiRoutes.use('/addresses', addressRoutes);
apiRoutes.use('/assets', assetRoutes);
apiRoutes.use('/audit-logs', auditLogRoutes);
apiRoutes.use('/auth', authRoutes);
apiRoutes.use('/banners', bannerRoutes);
apiRoutes.use('/blogs', blogRoutes);
apiRoutes.use('/cart', cartRoutes);
apiRoutes.use('/categories', categoryRoutes);
apiRoutes.use('/coupons', couponRoutes);
apiRoutes.use('/orders', orderRoutes);
apiRoutes.use('/pages', pageRoutes);
apiRoutes.use('/payment-methods', paymentMethodRoutes);
apiRoutes.use('/products', productRoutes);
apiRoutes.use('/promotions', promotionRoutes);
apiRoutes.use('/reports', reportRoutes);
apiRoutes.use('/roles', roleRoutes);
apiRoutes.use('/sales', saleRoutes);
apiRoutes.use('/store-info', storeInfoRoutes);
apiRoutes.use('/users', userRoutes);

export const routes = Router();

routes.get('/health', async (_req, res) => {
  await db.execute(sql`select 1`);
  res.json({ status: 'ok' });
});

if (env.APP_ENV !== 'production') {
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
