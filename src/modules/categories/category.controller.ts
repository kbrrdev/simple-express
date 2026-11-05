import type { Request, Response } from 'express';
import * as categoryService from './category.service';
import type { CategoryBody, ListCategoriesQuery } from './category.validation';

type IdParams = { id: string };

export async function list(req: Request, res: Response) {
  // The validate middleware has already converted and defaulted the query.
  const query = req.query as unknown as ListCategoriesQuery;
  const { items, total } = await categoryService.listCategories(query);

  res.json({ data: items, meta: { page: query.page, limit: query.limit, total } });
}

export async function get(req: Request<IdParams>, res: Response) {
  res.json({ data: await categoryService.getCategory(req.params.id) });
}

export async function create(req: Request<object, object, CategoryBody>, res: Response) {
  const category = await categoryService.createCategory(req.body);
  res.status(201).location(`${req.baseUrl}/${category.id}`).json({ data: category });
}

export async function update(req: Request<IdParams, object, CategoryBody>, res: Response) {
  res.json({ data: await categoryService.updateCategory(req.params.id, req.body) });
}

export async function remove(req: Request<IdParams>, res: Response) {
  await categoryService.deleteCategory(req.params.id);
  res.status(204).send();
}
