import Joi from 'joi';
import { storeDate } from '../reports/report.validation';
import { auditEntityTypes, type AuditEntityType } from './audit-log.schema';

export interface ListAuditLogsQuery {
  page: number;
  limit: number;
  actorUserId?: string;
  entityType?: AuditEntityType;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
}

export const listAuditLogsQuery = Joi.object<ListAuditLogsQuery>({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  actorUserId: Joi.string().uuid(),
  entityType: Joi.string().valid(...auditEntityTypes),
  entityId: Joi.string().uuid(),
  action: Joi.string().max(50),
  from: storeDate,
  to: storeDate,
});
