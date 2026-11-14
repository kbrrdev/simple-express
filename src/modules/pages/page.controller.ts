import type { Request, Response } from 'express';
import * as pageService from './page.service';
import type { CreatePageBody, UpdatePageBody } from './page.validation';

type IdParams = { id: string };

async function sendList(res: Response, includeDrafts: boolean) {
  const items = await pageService.listPages(includeDrafts);
  res.json({ data: items, meta: { page: 1, limit: items.length, total: items.length } });
}

export async function list(_req: Request, res: Response) {
  await sendList(res, false);
}

export async function listForAdmin(_req: Request, res: Response) {
  await sendList(res, true);
}

export async function get(req: Request<{ slug: string }>, res: Response) {
  res.json({ data: await pageService.getPublishedPage(req.params.slug) });
}

export async function getForAdmin(req: Request<IdParams>, res: Response) {
  res.json({ data: await pageService.getPage(req.params.id) });
}

export async function create(req: Request<object, object, CreatePageBody>, res: Response) {
  const page = await pageService.createPage(req.body);
  res.status(201).json({ data: page });
}

export async function update(req: Request<IdParams, object, UpdatePageBody>, res: Response) {
  res.json({ data: await pageService.updatePage(req.params.id, req.body) });
}

export async function remove(req: Request<IdParams>, res: Response) {
  await pageService.deletePage(req.params.id);
  res.status(204).send();
}
