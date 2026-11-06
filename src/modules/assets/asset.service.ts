import { randomUUID } from 'node:crypto';
import { count, desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { FOREIGN_KEY_VIOLATION, hasDbErrorCode } from '../../lib/db-errors';
import { deleteFile, fileUrl, saveFile } from '../../lib/storage';
import { assets, type Asset } from './asset.schema';
import type { ListAssetsQuery } from './asset.validation';

/** Reads the file's first bytes, as its name and declared type can be faked. */
function detectImageType(file: Buffer) {
  if (file.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }

  if (file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', extension: 'png' };
  }

  if (
    file.subarray(0, 4).toString('latin1') === 'RIFF' &&
    file.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }

  return undefined;
}

function toPublicAsset({ id, path, mimeType, sizeBytes, createdAt }: Asset) {
  return { id, url: fileUrl(path), mimeType, sizeBytes, createdAt };
}

export async function listAssets({ page, limit }: ListAssetsQuery) {
  const [items, totals] = await Promise.all([
    db
      .select()
      .from(assets)
      .orderBy(desc(assets.createdAt), desc(assets.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(assets),
  ]);

  return { items: items.map(toPublicAsset), total: totals[0]?.total ?? 0 };
}

export async function createAsset(file: Buffer) {
  const type = detectImageType(file);

  if (!type) throw new AppError(400, 'File must be a JPEG, PNG, or WebP image');

  const path = `${randomUUID()}.${type.extension}`;

  await saveFile(path, file, type.mimeType);

  try {
    const [asset] = await db
      .insert(assets)
      .values({ path, mimeType: type.mimeType, sizeBytes: file.length })
      .returning();
    if (!asset) throw new AppError(500, 'Failed to create asset');

    return toPublicAsset(asset);
  } catch (error) {
    await deleteFile(path);
    throw error;
  }
}

export async function deleteAsset(id: string): Promise<void> {
  // The row goes first, so that a file still in use is never removed.
  try {
    const [asset] = await db
      .delete(assets)
      .where(eq(assets.id, id))
      .returning({ path: assets.path });

    if (!asset) throw new AppError(404, `Asset not found: ${id}`);

    await deleteFile(asset.path);
  } catch (error) {
    if (hasDbErrorCode(error, FOREIGN_KEY_VIOLATION)) {
      throw new AppError(409, 'Asset is still in use');
    }
    throw error;
  }
}
