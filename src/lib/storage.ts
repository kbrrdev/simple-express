import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';

const CACHE_CONTROL = 'public, max-age=31536000, immutable';

// The startup check in env.ts guarantees the other S3 settings when a bucket is set.
const s3 = env.S3_BUCKET
  ? new S3Client({
      region: env.S3_REGION ?? '',
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
      },
      ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT, forcePathStyle: true }),
    })
  : undefined;

const s3BaseUrl = env.S3_PUBLIC_URL ?? `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com`;

export const usesS3 = s3 !== undefined;

export async function saveFile(path: string, body: Buffer, contentType: string) {
  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: path,
        Body: body,
        ContentType: contentType,
        CacheControl: CACHE_CONTROL,
      }),
    );
    return;
  }

  await mkdir(env.UPLOADS_DIR, { recursive: true });
  await writeFile(join(env.UPLOADS_DIR, path), body);
}

export async function deleteFile(path: string) {
  if (s3) {
    await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: path }));
    return;
  }

  await rm(join(env.UPLOADS_DIR, path), { force: true });
}

export function fileUrl(path: string) {
  return s3 ? `${s3BaseUrl}/${path}` : `${env.PUBLIC_BASE_URL}/uploads/${path}`;
}
