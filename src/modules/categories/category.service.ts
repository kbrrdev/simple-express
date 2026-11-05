import { asc, count, eq } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { FOREIGN_KEY_VIOLATION, hasDbErrorCode, UNIQUE_VIOLATION } from '../../lib/db-errors';
import { categories, type Category } from './category.schema';
import type { CategoryBody, ListCategoriesQuery } from './category.validation';

export async function listCategories({ page, limit }: ListCategoriesQuery) {
  const [items, totals] = await Promise.all([
    db
      .select()
      .from(categories)
      .orderBy(asc(categories.name))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(categories),
  ]);

  return { items, total: totals[0]?.total ?? 0 };
}

export async function getCategory(id: string): Promise<Category> {
  const [category] = await db.select().from(categories).where(eq(categories.id, id));
  return category ?? notFound(id);
}

export async function createCategory(data: CategoryBody): Promise<Category> {
  try {
    const [category] = await db.insert(categories).values(data).returning();
    if (!category) throw new AppError(500, 'Failed to create category');
    return category;
  } catch (error) {
    throw duplicateNameError(error);
  }
}

export async function updateCategory(id: string, data: CategoryBody): Promise<Category> {
  try {
    const [category] = await db
      .update(categories)
      .set(data)
      .where(eq(categories.id, id))
      .returning();
    return category ?? notFound(id);
  } catch (error) {
    throw duplicateNameError(error);
  }
}

export async function deleteCategory(id: string): Promise<void> {
  try {
    const [category] = await db
      .delete(categories)
      .where(eq(categories.id, id))
      .returning({ id: categories.id });
    if (!category) notFound(id);
  } catch (error) {
    if (hasDbErrorCode(error, FOREIGN_KEY_VIOLATION)) {
      throw new AppError(409, 'Category still has products');
    }
    throw error;
  }
}

function duplicateNameError(error: unknown) {
  return hasDbErrorCode(error, UNIQUE_VIOLATION)
    ? new AppError(409, 'Category name already exists')
    : error;
}

function notFound(id: string): never {
  throw new AppError(404, `Category not found: ${id}`);
}
