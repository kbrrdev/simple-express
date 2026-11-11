import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './audit-log.controller';
import { listAuditLogsQuery } from './audit-log.validation';

export const auditLogRoutes = Router();

auditLogRoutes.get(
  '/',
  requireAuth,
  requirePermission('audit_logs.view'),
  validate('query', listAuditLogsQuery),
  controller.list,
);
