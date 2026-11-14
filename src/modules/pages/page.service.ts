import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { hasDbErrorCode, UNIQUE_VIOLATION } from '../../lib/db-errors';
import { changesBetween, recordAudit } from '../audit-logs/audit-log.service';
import { pages } from './page.schema';
import type { CreatePageBody, UpdatePageBody } from './page.validation';

const PAGE_FIELDS = ['slug', 'title', 'content', 'published'];

const summaryFields = {
  id: pages.id,
  slug: pages.slug,
  title: pages.title,
  published: pages.published,
  updatedAt: pages.updatedAt,
};

/** Without content, as lists feed footer links and the admin table. Drafts stay hidden from the public. */
export function listPages(includeDrafts = false) {
  return db
    .select(summaryFields)
    .from(pages)
    .where(includeDrafts ? undefined : eq(pages.published, true))
    .orderBy(asc(pages.title));
}

export async function getPublishedPage(slug: string) {
  const [page] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.slug, slug), eq(pages.published, true)));

  if (!page) throw new AppError(404, `Page not found: ${slug}`);
  return page;
}

export async function getPage(id: string) {
  const [page] = await db.select().from(pages).where(eq(pages.id, id));
  return page ?? notFound(id);
}

export async function createPage(data: CreatePageBody) {
  try {
    return await db.transaction(async (tx) => {
      const [page] = await tx.insert(pages).values(data).returning();
      if (!page) throw new AppError(500, 'Failed to create page');

      await recordAudit(tx, {
        entityType: 'page',
        entityId: page.id,
        action: 'create',
        changes: changesBetween({}, page, PAGE_FIELDS),
      });

      return page;
    });
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updatePage(id: string, data: UpdatePageBody) {
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(pages).where(eq(pages.id, id)).for('update');
      if (!existing) notFound(id);

      const [page] = await tx.update(pages).set(data).where(eq(pages.id, id)).returning();
      if (!page) notFound(id);

      await recordAudit(tx, {
        entityType: 'page',
        entityId: id,
        action: 'update',
        changes: changesBetween(existing, page, Object.keys(data)),
      });

      return page;
    });
  } catch (error) {
    throw toAppError(error);
  }
}

export async function deletePage(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [page] = await tx.delete(pages).where(eq(pages.id, id)).returning();
    if (!page) notFound(id);

    await recordAudit(tx, {
      entityType: 'page',
      entityId: id,
      action: 'delete',
      changes: changesBetween(page, {}, PAGE_FIELDS),
    });
  });
}

function toAppError(error: unknown) {
  return hasDbErrorCode(error, UNIQUE_VIOLATION)
    ? new AppError(409, 'A page with this slug already exists')
    : error;
}

function notFound(id: string): never {
  throw new AppError(404, `Page not found: ${id}`);
}
