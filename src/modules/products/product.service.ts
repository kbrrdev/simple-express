import { and, asc, count, desc, eq, exists, ilike, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { FOREIGN_KEY_VIOLATION, hasDbErrorCode, UNIQUE_VIOLATION } from '../../lib/db-errors';
import { products, productVariants, type Product, type ProductVariant } from './product.schema';
import type {
  CreateProductBody,
  ListProductsQuery,
  UpdateProductBody,
  UpdateVariantBody,
  VariantBody,
} from './product.validation';

type OptionNames = { option1Name?: string | null; option2Name?: string | null };
type OptionValues = { option1Value?: string | null; option2Value?: string | null };

// A product with nothing left to buy is hidden, as if the product itself were inactive.
const isPublic = and(
  eq(products.active, true),
  exists(
    db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(and(eq(productVariants.productId, products.id), eq(productVariants.active, true))),
  ),
);

export async function listProducts(
  { page, limit, search, categoryId, sort }: ListProductsQuery,
  includeInactive = false,
) {
  const where = and(
    includeInactive ? undefined : isPublic,
    categoryId ? eq(products.categoryId, categoryId) : undefined,
    search ? ilike(products.name, `%${escapeLikePattern(search)}%`) : undefined,
  );
  const orderBy =
    sort === 'name'
      ? [asc(products.name), asc(products.id)]
      : [desc(products.createdAt), desc(products.id)];

  const [items, totals] = await Promise.all([
    db
      .select()
      .from(products)
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(products).where(where),
  ]);

  const variants = await findVariants(
    items.map((item) => item.id),
    includeInactive,
  );

  return {
    items: items.map((item) => ({
      ...item,
      variants: variants.filter((variant) => variant.productId === item.id),
    })),
    total: totals[0]?.total ?? 0,
  };
}

export async function getProduct(id: string) {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), isPublic));

  if (!product) notFound(id);

  return { ...product, variants: await findVariants([id], false) };
}

export async function createProduct({ variants, ...data }: CreateProductBody) {
  for (const variant of variants) {
    assertValuesMatchOptions(data, variant);
  }

  try {
    return await db.transaction(async (tx) => {
      const [product] = await tx.insert(products).values(data).returning();
      if (!product) throw new AppError(500, 'Failed to create product');

      const created = await tx
        .insert(productVariants)
        .values(variants.map((variant) => ({ ...variant, productId: product.id })))
        .returning();

      return { ...product, variants: created };
    });
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updateProduct(id: string, data: UpdateProductBody) {
  const existing = await findProduct(id);

  if ((data.option1Name && !existing.option1Name) || (data.option2Name && !existing.option2Name)) {
    throw new AppError(409, 'Options cannot be added after a product is created');
  }

  try {
    const [product] = await db.update(products).set(data).where(eq(products.id, id)).returning();
    if (!product) notFound(id);

    return { ...product, variants: await findVariants([id], true) };
  } catch (error) {
    throw toAppError(error);
  }
}

export async function deactivateProduct(id: string): Promise<void> {
  const [product] = await db
    .update(products)
    .set({ active: false })
    .where(eq(products.id, id))
    .returning({ id: products.id });

  if (!product) notFound(id);
}

export async function addVariant(productId: string, data: VariantBody): Promise<ProductVariant> {
  const product = await findProduct(productId);
  assertValuesMatchOptions(product, data);

  try {
    const [variant] = await db
      .insert(productVariants)
      .values({ ...data, productId })
      .returning();
    if (!variant) throw new AppError(500, 'Failed to create variant');
    return variant;
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updateVariant(
  productId: string,
  variantId: string,
  data: UpdateVariantBody,
): Promise<ProductVariant> {
  const product = await findProduct(productId);
  const [existing] = await db
    .select()
    .from(productVariants)
    .where(and(eq(productVariants.id, variantId), eq(productVariants.productId, productId)));

  if (!existing) variantNotFound(variantId);

  assertValuesMatchOptions(product, { ...existing, ...data });

  try {
    const [variant] = await db
      .update(productVariants)
      .set(data)
      .where(eq(productVariants.id, variantId))
      .returning();
    return variant ?? variantNotFound(variantId);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function deactivateVariant(productId: string, variantId: string): Promise<void> {
  const [variant] = await db
    .update(productVariants)
    .set({ active: false })
    .where(and(eq(productVariants.id, variantId), eq(productVariants.productId, productId)))
    .returning({ id: productVariants.id });

  if (!variant) variantNotFound(variantId);
}

async function findProduct(id: string): Promise<Product> {
  const [product] = await db.select().from(products).where(eq(products.id, id));
  return product ?? notFound(id);
}

function findVariants(productIds: string[], includeInactive: boolean) {
  return db
    .select()
    .from(productVariants)
    .where(
      and(
        inArray(productVariants.productId, productIds),
        includeInactive ? undefined : eq(productVariants.active, true),
      ),
    )
    .orderBy(asc(productVariants.createdAt), asc(productVariants.id));
}

function assertValuesMatchOptions(product: OptionNames, variant: OptionValues) {
  const option1Matches = !product.option1Name === !variant.option1Value;
  const option2Matches = !product.option2Name === !variant.option2Value;

  if (!option1Matches || !option2Matches) {
    throw new AppError(400, 'Variant values must match the options of the product');
  }
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function toAppError(error: unknown) {
  if (hasDbErrorCode(error, UNIQUE_VIOLATION)) {
    return new AppError(409, 'A variant with these option values already exists');
  }

  if (hasDbErrorCode(error, FOREIGN_KEY_VIOLATION)) {
    return new AppError(400, 'Category does not exist');
  }

  return error;
}

function notFound(id: string): never {
  throw new AppError(404, `Product not found: ${id}`);
}

function variantNotFound(id: string): never {
  throw new AppError(404, `Variant not found: ${id}`);
}
