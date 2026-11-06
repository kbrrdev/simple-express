import { and, count, desc, eq, getTableColumns } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { FOREIGN_KEY_VIOLATION, hasDbErrorCode } from '../../lib/db-errors';
import { fileUrl } from '../../lib/storage';
import { assets } from '../assets/asset.schema';
import { blogs, type Blog } from './blog.schema';
import type { CreateBlogBody, ListBlogsQuery, UpdateBlogBody } from './blog.validation';

const blogFields = { ...getTableColumns(blogs), coverPath: assets.path };

function toPublicBlog({ coverPath, ...blog }: Blog & { coverPath: string | null }) {
  return { ...blog, coverImageUrl: coverPath ? fileUrl(coverPath) : null };
}

/** Drafts stay hidden from the public, so a planned announcement cannot leak early. */
export async function listBlogs({ page, limit, published }: ListBlogsQuery, includeDrafts = false) {
  const visible = includeDrafts ? published : true;
  const where = visible === undefined ? undefined : eq(blogs.published, visible);

  const [items, totals] = await Promise.all([
    db
      .select(blogFields)
      .from(blogs)
      .leftJoin(assets, eq(blogs.coverAssetId, assets.id))
      .where(where)
      .orderBy(desc(blogs.createdAt), desc(blogs.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(blogs).where(where),
  ]);

  return { items: items.map(toPublicBlog), total: totals[0]?.total ?? 0 };
}

export async function getBlog(id: string, includeDrafts = false) {
  const [blog] = await db
    .select(blogFields)
    .from(blogs)
    .leftJoin(assets, eq(blogs.coverAssetId, assets.id))
    .where(and(eq(blogs.id, id), includeDrafts ? undefined : eq(blogs.published, true)));

  return blog ? toPublicBlog(blog) : notFound(id);
}

export async function createBlog(data: CreateBlogBody) {
  try {
    const [blog] = await db.insert(blogs).values(data).returning({ id: blogs.id });
    if (!blog) throw new AppError(500, 'Failed to create blog');

    return await getBlog(blog.id, true);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updateBlog(id: string, data: UpdateBlogBody) {
  try {
    const [blog] = await db
      .update(blogs)
      .set(data)
      .where(eq(blogs.id, id))
      .returning({ id: blogs.id });
    if (!blog) notFound(id);

    return await getBlog(id, true);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function deleteBlog(id: string): Promise<void> {
  const [blog] = await db.delete(blogs).where(eq(blogs.id, id)).returning({ id: blogs.id });
  if (!blog) notFound(id);
}

function toAppError(error: unknown) {
  return hasDbErrorCode(error, FOREIGN_KEY_VIOLATION)
    ? new AppError(400, 'Asset does not exist')
    : error;
}

function notFound(id: string): never {
  throw new AppError(404, `Blog not found: ${id}`);
}
