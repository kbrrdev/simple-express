import { asc, count, eq, getTableColumns, sql } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { FOREIGN_KEY_VIOLATION, hasDbErrorCode, UNIQUE_VIOLATION } from '../../lib/db-errors';
import { fileUrl } from '../../lib/storage';
import { assets } from '../assets/asset.schema';
import { changesBetween, recordAudit } from '../audit-logs/audit-log.service';
import { categories, type Category } from './category.schema';
import {
  MAX_CATEGORY_DEPTH,
  type CreateCategoryBody,
  type ListCategoriesQuery,
  type UpdateCategoryBody,
} from './category.validation';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Each category's parent, by category ID. */
type ParentMap = Map<string, string | null>;

const categoryFields = { ...getTableColumns(categories), imagePath: assets.path };
const byName = [asc(categories.name), asc(categories.id)];
const CATEGORY_FIELDS = ['name', 'parentId', 'imageAssetId', 'icon'];

function toPublicCategory({ imagePath, ...category }: Category & { imagePath: string | null }) {
  return { ...category, imageUrl: imagePath ? fileUrl(imagePath) : null };
}

type CategoryNode = ReturnType<typeof toPublicCategory> & { children: CategoryNode[] };

function selectCategories() {
  return db
    .select(categoryFields)
    .from(categories)
    .leftJoin(assets, eq(categories.imageAssetId, assets.id));
}

export async function listCategories({ page, limit }: ListCategoriesQuery) {
  const [items, totals] = await Promise.all([
    selectCategories()
      .orderBy(...byName)
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(categories),
  ]);

  return { items: items.map(toPublicCategory), total: totals[0]?.total ?? 0 };
}

/** Every category, nested under its parent. A store has few, so this is not paginated. */
export async function getCategoryTree() {
  const rows = await selectCategories().orderBy(...byName);
  const nodes: CategoryNode[] = rows.map((row) => ({ ...toPublicCategory(row), children: [] }));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const roots: CategoryNode[] = [];

  for (const node of nodes) {
    const parent = node.parentId ? nodesById.get(node.parentId) : undefined;

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/** Includes `path`, the categories above it from the top down, for breadcrumbs. */
export async function getCategory(id: string) {
  const [[category], all] = await Promise.all([
    selectCategories().where(eq(categories.id, id)),
    db
      .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
      .from(categories),
  ]);

  if (!category) notFound(id);

  const categoriesById = new Map(all.map((row) => [row.id, row]));
  const path: { id: string; name: string }[] = [];
  let parent = category.parentId ? categoriesById.get(category.parentId) : undefined;

  while (parent) {
    path.unshift({ id: parent.id, name: parent.name });
    parent = parent.parentId ? categoriesById.get(parent.parentId) : undefined;
  }

  return { ...toPublicCategory(category), path };
}

/** The category and every category below it, so that filtering by a parent includes its children. */
export async function findCategoryAndDescendantIds(id: string) {
  const rows = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories);
  const ids = [id];

  for (let i = 0; i < ids.length; i++) {
    for (const row of rows) {
      if (row.parentId === ids[i]) ids.push(row.id);
    }
  }

  return ids;
}

export async function createCategory(data: CreateCategoryBody) {
  try {
    const id = await withTreeLock(async (tx, parents) => {
      checkParent(parents, data.parentId ?? null, 1);

      const [category] = await tx.insert(categories).values(data).returning();
      if (!category) throw new AppError(500, 'Failed to create category');

      await recordAudit(tx, {
        entityType: 'category',
        entityId: category.id,
        action: 'create',
        changes: changesBetween({}, category, CATEGORY_FIELDS),
      });

      return category.id;
    });

    return await getCategory(id);
  } catch (error) {
    throw toAppError(error);
  }
}

/** A new `parentId` moves the category together with everything below it. */
export async function updateCategory(id: string, data: UpdateCategoryBody) {
  try {
    await withTreeLock(async (tx, parents) => {
      if (!parents.has(id)) notFound(id);

      if (data.parentId !== undefined) {
        checkParent(parents, data.parentId, heightOf(parents, id), id);
      }

      const [existing] = await tx.select().from(categories).where(eq(categories.id, id));
      const [updated] = await tx
        .update(categories)
        .set(data)
        .where(eq(categories.id, id))
        .returning();
      if (!existing || !updated) notFound(id);

      await recordAudit(tx, {
        entityType: 'category',
        entityId: id,
        action: 'update',
        changes: changesBetween(existing, updated, Object.keys(data)),
      });
    });

    return await getCategory(id);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function deleteCategory(id: string): Promise<void> {
  try {
    await withTreeLock(async (tx, parents) => {
      if (!parents.has(id)) notFound(id);

      if ([...parents.values()].includes(id)) {
        throw new AppError(409, 'Category still has subcategories');
      }

      const [deleted] = await tx.delete(categories).where(eq(categories.id, id)).returning();
      if (!deleted) notFound(id);

      await recordAudit(tx, {
        entityType: 'category',
        entityId: id,
        action: 'delete',
        changes: changesBetween(deleted, {}, CATEGORY_FIELDS),
      });
    });
  } catch (error) {
    if (hasDbErrorCode(error, FOREIGN_KEY_VIOLATION)) {
      throw new AppError(409, 'Category still has products');
    }
    throw error;
  }
}

/** Category changes run one at a time, so that two moves cannot form a loop between them. */
function withTreeLock<T>(work: (tx: Transaction, parents: ParentMap) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('categories'))`);

    const rows = await tx
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories);

    return work(tx, new Map(rows.map((row) => [row.id, row.parentId])));
  });
}

/** Levels from the top down to this category, so 1 for a top-level category. */
function levelOf(parents: ParentMap, id: string) {
  let level = 0;

  for (let current: string | null | undefined = id; current; current = parents.get(current)) {
    level++;
  }

  return level;
}

/** Levels in the category's subtree, counting the category itself. */
function heightOf(parents: ParentMap, id: string): number {
  let tallestChild = 0;

  for (const [childId, parentId] of parents) {
    if (parentId === id) tallestChild = Math.max(tallestChild, heightOf(parents, childId));
  }

  return tallestChild + 1;
}

function isWithin(parents: ParentMap, id: string, ancestorId: string) {
  for (let current: string | null | undefined = id; current; current = parents.get(current)) {
    if (current === ancestorId) return true;
  }

  return false;
}

/** `height` is how many levels are being placed under the parent. */
function checkParent(parents: ParentMap, parentId: string | null, height: number, id?: string) {
  if (parentId === null) return;

  if (!parents.has(parentId)) {
    throw new AppError(400, 'Parent category does not exist');
  }

  if (id && isWithin(parents, parentId, id)) {
    throw new AppError(400, 'A category cannot be moved inside itself');
  }

  if (levelOf(parents, parentId) + height > MAX_CATEGORY_DEPTH) {
    throw new AppError(400, `Categories can be at most ${MAX_CATEGORY_DEPTH} levels deep`);
  }
}

/** The parent is checked under the lock, so a foreign key error here means the image. */
function toAppError(error: unknown) {
  if (hasDbErrorCode(error, UNIQUE_VIOLATION)) {
    return new AppError(409, 'A category with this name already exists here');
  }

  if (hasDbErrorCode(error, FOREIGN_KEY_VIOLATION)) {
    return new AppError(400, 'Asset does not exist');
  }

  return error;
}

function notFound(id: string): never {
  throw new AppError(404, `Category not found: ${id}`);
}
