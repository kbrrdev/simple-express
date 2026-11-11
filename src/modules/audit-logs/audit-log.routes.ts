import { Router } from 'express';
import { requireAdmin, requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './audit-log.controller';
import { listAuditLogsQuery } from './audit-log.validation';

export const auditLogRoutes = Router();

auditLogRoutes.get(
  '/',
  requireAuth,
  requireAdmin,
  validate('query', listAuditLogsQuery),
  controller.list,
);
