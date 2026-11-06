import type { Request, Response } from 'express';
import * as productService from './product.service';
import type {
  AddImageBody,
  CreateProductBody,
  ListProductsQuery,
  UpdateImageBody,
  UpdateProductBody,
  UpdateVariantBody,
  VariantBody,
} from './product.validation';

type IdParams = { id: string };
type VariantParams = { id: string; variantId: string };
type ImageParams = { id: string; imageId: string };

export async function list(req: Request, res: Response) {
  // The validate middleware has already converted and defaulted the query.
  const query = req.query as unknown as ListProductsQuery;
  const { items, total } = await productService.listProducts(query);

  res.json({ data: items, meta: { page: query.page, limit: query.limit, total } });
}

export async function listForAdmin(req: Request, res: Response) {
  const query = req.query as unknown as ListProductsQuery;
  const { items, total } = await productService.listProducts(query, true);

  res.json({ data: items, meta: { page: query.page, limit: query.limit, total } });
}

export async function get(req: Request<IdParams>, res: Response) {
  res.json({ data: await productService.getProduct(req.params.id) });
}

export async function create(req: Request<object, object, CreateProductBody>, res: Response) {
  const product = await productService.createProduct(req.body);
  res.status(201).location(`${req.baseUrl}/${product.id}`).json({ data: product });
}

export async function update(req: Request<IdParams, object, UpdateProductBody>, res: Response) {
  res.json({ data: await productService.updateProduct(req.params.id, req.body) });
}

export async function remove(req: Request<IdParams>, res: Response) {
  await productService.deactivateProduct(req.params.id);
  res.status(204).send();
}

export async function addImage(req: Request<IdParams, object, AddImageBody>, res: Response) {
  res.status(201).json({ data: await productService.addImage(req.params.id, req.body) });
}

export async function updateImage(
  req: Request<ImageParams, object, UpdateImageBody>,
  res: Response,
) {
  const { id, imageId } = req.params;
  res.json({ data: await productService.updateImage(id, imageId, req.body) });
}

export async function removeImage(req: Request<ImageParams>, res: Response) {
  await productService.removeImage(req.params.id, req.params.imageId);
  res.status(204).send();
}

export async function addVariant(req: Request<IdParams, object, VariantBody>, res: Response) {
  res.status(201).json({ data: await productService.addVariant(req.params.id, req.body) });
}

export async function updateVariant(
  req: Request<VariantParams, object, UpdateVariantBody>,
  res: Response,
) {
  const { id, variantId } = req.params;
  res.json({ data: await productService.updateVariant(id, variantId, req.body) });
}

export async function removeVariant(req: Request<VariantParams>, res: Response) {
  await productService.deactivateVariant(req.params.id, req.params.variantId);
  res.status(204).send();
}
