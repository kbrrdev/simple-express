import type { Request, Response } from 'express';
import * as auditLogService from './audit-log.service';
import type { ListAuditLogsQuery } from './audit-log.validation';

export async function list(req: Request, res: Response) {
  const query = req.query as unknown as ListAuditLogsQuery;
  const { items, total } = await auditLogService.listAuditLogs(query);

  res.json({ data: items, meta: { page: query.page, limit: query.limit, total } });
}
