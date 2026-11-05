import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { users } from '../auth/auth.schema';
import { addresses, type Address } from './address.schema';
import type { AddressBody, UpdateAddressBody } from './address.validation';

export const MAX_ADDRESSES = 20;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function listAddresses(userId: string): Promise<Address[]> {
  return db
    .select()
    .from(addresses)
    .where(eq(addresses.userId, userId))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt), desc(addresses.id));
}

export async function getAddress(userId: string, id: string): Promise<Address> {
  const [address] = await db.select().from(addresses).where(addressKey(userId, id));
  return address ?? notFound(id);
}

export function createAddress(userId: string, data: AddressBody): Promise<Address> {
  return withUserLock(userId, async (tx) => {
    const [totals] = await tx
      .select({ total: count() })
      .from(addresses)
      .where(eq(addresses.userId, userId));
    const total = totals?.total ?? 0;

    if (total >= MAX_ADDRESSES) {
      throw new AppError(409, `You can save up to ${MAX_ADDRESSES} addresses`);
    }

    const [address] = await tx
      .insert(addresses)
      .values({ ...data, userId, isDefault: total === 0 })
      .returning();
    if (!address) throw new AppError(500, 'Failed to create address');

    return address;
  });
}

export async function updateAddress(
  userId: string,
  id: string,
  data: UpdateAddressBody,
): Promise<Address> {
  const [address] = await db.update(addresses).set(data).where(addressKey(userId, id)).returning();
  return address ?? notFound(id);
}

export function setDefaultAddress(userId: string, id: string): Promise<Address> {
  return withUserLock(userId, async (tx) => {
    const [existing] = await tx
      .select({ id: addresses.id })
      .from(addresses)
      .where(addressKey(userId, id));
    if (!existing) notFound(id);

    // In this order, as the unique index allows only one default at any moment.
    await tx
      .update(addresses)
      .set({ isDefault: false })
      .where(and(eq(addresses.userId, userId), eq(addresses.isDefault, true)));

    const [address] = await tx
      .update(addresses)
      .set({ isDefault: true })
      .where(addressKey(userId, id))
      .returning();

    return address ?? notFound(id);
  });
}

export async function deleteAddress(userId: string, id: string): Promise<void> {
  await withUserLock(userId, async (tx) => {
    const [deleted] = await tx
      .delete(addresses)
      .where(addressKey(userId, id))
      .returning({ isDefault: addresses.isDefault });

    if (!deleted) notFound(id);
    if (!deleted.isDefault) return;

    const [newest] = await tx
      .select({ id: addresses.id })
      .from(addresses)
      .where(eq(addresses.userId, userId))
      .orderBy(desc(addresses.createdAt), desc(addresses.id))
      .limit(1);

    if (newest) {
      await tx.update(addresses).set({ isDefault: true }).where(eq(addresses.id, newest.id));
    }
  });
}

/** Runs one user's address changes in turn, so parallel requests cannot break the rules. */
function withUserLock<T>(userId: string, work: (tx: Transaction) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update');

    return work(tx);
  });
}

function addressKey(userId: string, id: string) {
  return and(eq(addresses.id, id), eq(addresses.userId, userId));
}

function notFound(id: string): never {
  throw new AppError(404, `Address not found: ${id}`);
}
