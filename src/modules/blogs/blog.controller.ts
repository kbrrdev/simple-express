import type { Request, Response } from 'express';
import * as blogService from './blog.service';
import type { CreateBlogBody, ListBlogsQuery, UpdateBlogBody } from './blog.validation';

type IdParams = { id: string };

export async function list(req: Request, res: Response) {
  // The validate middleware has already converted and defaulted the query.
  const query = req.query as unknown as ListBlogsQuery;
  const { items, total } = await blogService.listBlogs(query);

  res.json({
    data: items,
    meta: { page: query.page, limit: query.limit, total },
  });
}

export async function listForAdmin(req: Request, res: Response) {
  const query = req.query as unknown as ListBlogsQuery;
  const { items, total } = await blogService.listBlogs(query, true);

  res.json({ data: items, meta: { page: query.page, limit: query.limit, total } });
}

export async function getForAdmin(req: Request<IdParams>, res: Response) {
  res.json({ data: await blogService.getBlog(req.params.id, true) });
}

export async function get(req: Request<IdParams>, res: Response) {
  res.json({ data: await blogService.getBlog(req.params.id) });
}

export async function create(req: Request<object, object, CreateBlogBody>, res: Response) {
  const blog = await blogService.createBlog(req.body);
  res.status(201).location(`${req.baseUrl}/${blog.id}`).json({ data: blog });
}

export async function update(req: Request<IdParams, object, UpdateBlogBody>, res: Response) {
  res.json({ data: await blogService.updateBlog(req.params.id, req.body) });
}

export async function remove(req: Request<IdParams>, res: Response) {
  await blogService.deleteBlog(req.params.id);
  res.status(204).send();
}
