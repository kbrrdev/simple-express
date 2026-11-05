import { count, desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { blogs, type Blog } from './blog.schema';
import type { CreateBlogBody, ListBlogsQuery, UpdateBlogBody } from './blog.validation';

type BlogWriter = { userId: string; role: 'customer' | 'admin' };

export async function listBlogs({ page, limit, published }: ListBlogsQuery) {
  const where = published === undefined ? undefined : eq(blogs.published, published);

  const [items, totals] = await Promise.all([
    db
      .select()
      .from(blogs)
      .where(where)
      .orderBy(desc(blogs.createdAt), desc(blogs.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(blogs).where(where),
  ]);

  return { items, total: totals[0]?.total ?? 0 };
}

export async function getBlog(id: string): Promise<Blog> {
  const [blog] = await db.select().from(blogs).where(eq(blogs.id, id));
  return blog ?? notFound(id);
}

export async function createBlog(data: CreateBlogBody, authorId: string): Promise<Blog> {
  const [blog] = await db
    .insert(blogs)
    .values({ ...data, authorId })
    .returning();
  if (!blog) throw new AppError(500, 'Failed to create blog');
  return blog;
}

export async function updateBlog(
  id: string,
  data: UpdateBlogBody,
  writer: BlogWriter,
): Promise<Blog> {
  await assertCanChange(id, writer);

  const [blog] = await db.update(blogs).set(data).where(eq(blogs.id, id)).returning();
  return blog ?? notFound(id);
}

export async function deleteBlog(id: string, writer: BlogWriter): Promise<void> {
  await assertCanChange(id, writer);

  const [blog] = await db.delete(blogs).where(eq(blogs.id, id)).returning({ id: blogs.id });
  if (!blog) notFound(id);
}

async function assertCanChange(id: string, { userId, role }: BlogWriter) {
  const blog = await getBlog(id);

  if (role !== 'admin' && blog.authorId !== userId) {
    throw new AppError(403, 'You can only change your own blogs');
  }
}

function notFound(id: string): never {
  throw new AppError(404, `Blog not found: ${id}`);
}
