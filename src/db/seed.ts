import { randomUUID } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { env } from '../config/env';
import { createAddress } from '../modules/addresses/address.service';
import { createAsset } from '../modules/assets/asset.service';
import { register } from '../modules/auth/auth.service';
import { createBlog } from '../modules/blogs/blog.service';
import { addItem } from '../modules/cart/cart.service';
import { createCategory } from '../modules/categories/category.service';
import {
  cancelOwnOrder,
  confirmPayment,
  createGuestOrder,
  createOrder,
  previewOrder,
  submitOwnPayment,
  updateOrderStatus,
} from '../modules/orders/order.service';
import { createMethod } from '../modules/payment-methods/payment-method.service';
import {
  addImage,
  addVariant,
  createProduct,
  deactivateVariant,
  updateVariant,
} from '../modules/products/product.service';
import { db, pool } from './index';
import { users } from './schema';

// Development data only, so a shared password is fine. Production is refused below.
const PASSWORD = 'dev-password-123';
const ADMIN_EMAIL = 'admin@example.com';
const CUSTOMER_EMAIL = 'customer@example.com';

// A 1x1 PNG, enough for every image to have a working file.
const PLACEHOLDER_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const address = {
  recipientName: 'Juan Dela Cruz',
  phone: '+639171234567',
  line1: '123 Rizal Street',
  line2: 'Sunrise Village',
  barangay: 'San Antonio',
  city: 'Pasig',
  province: 'Metro Manila',
  postalCode: '1605',
};

function variant(product: { variants: { id: string }[] }, index: number) {
  const found = product.variants[index];
  if (!found) throw new Error('Seed product is missing a variant');
  return found.id;
}

async function newImage() {
  const asset = await createAsset(PLACEHOLDER_IMAGE);
  return asset.id;
}

/** Fills the cart, then checks out at the previewed total, as a storefront would. */
async function checkout(
  userId: string,
  addressId: string,
  paymentMethod: string,
  items: { variantId: string; quantity: number }[],
) {
  for (const item of items) {
    await addItem(userId, item);
  }

  const preview = await previewOrder(items);
  const { order } = await createOrder(userId, {
    addressId,
    paymentMethod,
    expectedTotalCents: preview.totalCents,
    idempotencyKey: randomUUID(),
  });

  return order.id;
}

async function main() {
  if (env.APP_ENV === 'production') throw new Error('Seeding is not allowed in production');

  const [existing] = await db.select({ total: count() }).from(users);
  if ((existing?.total ?? 0) > 0) {
    throw new Error('The database already has users. Reset it before seeding.');
  }

  const admin = await register({ email: ADMIN_EMAIL, password: PASSWORD });
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
  const customer = await register({ email: CUSTOMER_EMAIL, password: PASSWORD });

  const home = await createAddress(customer.id, address);
  await createAddress(customer.id, {
    ...address,
    line1: '45 Mabini Avenue',
    line2: '',
    barangay: 'Lahug',
    city: 'Cebu City',
    province: 'Cebu',
    postalCode: '6000',
  });

  const men = await createCategory({ name: 'Men', imageAssetId: await newImage() });
  const women = await createCategory({ name: 'Women', imageAssetId: await newImage() });
  const accessories = await createCategory({
    name: 'Accessories',
    imageAssetId: await newImage(),
  });
  const menShoes = await createCategory({ name: 'Shoes', parentId: men.id });
  const running = await createCategory({ name: 'Running', parentId: menShoes.id });
  const menShirts = await createCategory({ name: 'Shirts', parentId: men.id });
  const womenShoes = await createCategory({ name: 'Shoes', parentId: women.id });
  const dresses = await createCategory({ name: 'Dresses', parentId: women.id });

  const tShirt = await createProduct({
    categoryId: menShirts.id,
    name: 'Classic T-Shirt',
    description: 'A soft cotton shirt for every day.',
    option1Name: 'Size',
    option2Name: 'Color',
    variants: [
      { option1Value: 'M', option2Value: 'Red', priceCents: 1999, stock: 50 },
      { option1Value: 'L', option2Value: 'Red', priceCents: 2199, stock: 50 },
      { option1Value: 'M', option2Value: 'Blue', priceCents: 1999, stock: 50 },
      { option1Value: 'L', option2Value: 'Blue', priceCents: 2199, stock: 0 },
    ],
  });
  const runner = await createProduct({
    categoryId: running.id,
    name: 'Trail Runner',
    description: 'Light running shoes with a firm grip.',
    option1Name: 'Size',
    variants: [
      { option1Value: '8', priceCents: 459900, stock: 20 },
      { option1Value: '9', priceCents: 459900, stock: 20 },
      { option1Value: '10', priceCents: 459900, stock: 20 },
    ],
  });
  const flats = await createProduct({
    categoryId: womenShoes.id,
    name: 'Ballet Flats',
    option1Name: 'Size',
    variants: [
      { option1Value: '6', priceCents: 189900, stock: 15 },
      { option1Value: '7', priceCents: 189900, stock: 15 },
    ],
  });
  const dress = await createProduct({
    categoryId: dresses.id,
    name: 'Linen Summer Dress',
    description: 'Breathable linen for warm days.',
    option1Name: 'Size',
    option2Name: 'Color',
    variants: [
      { option1Value: 'S', option2Value: 'White', priceCents: 249900, stock: 10 },
      { option1Value: 'M', option2Value: 'White', priceCents: 249900, stock: 10 },
    ],
  });
  const tote = await createProduct({
    categoryId: accessories.id,
    name: 'Canvas Tote Bag',
    variants: [{ priceCents: 59900, stock: 100 }],
  });
  await createProduct({
    categoryId: accessories.id,
    name: 'Retired Cap',
    description: 'No longer sold, kept for past orders.',
    active: false,
    variants: [{ priceCents: 39900, stock: 5 }],
  });

  for (const product of [tShirt, runner, flats, dress, tote]) {
    await addImage(product.id, { assetId: await newImage(), altText: product.name });
  }

  // The blue shirt gets its own image, and the large size of the dress is discontinued.
  const blueImage = await addImage(tShirt.id, {
    assetId: await newImage(),
    altText: 'Classic T-Shirt in blue',
  });
  await updateVariant(tShirt.id, variant(tShirt, 2), { assetId: blueImage.assetId });
  const largeDress = await addVariant(dress.id, {
    option1Value: 'L',
    option2Value: 'White',
    priceCents: 249900,
    stock: 4,
  });
  await deactivateVariant(dress.id, largeDress.id);

  const gcash = await createMethod({
    providerName: 'GCash',
    accountName: 'Sample Store',
    accountNumber: '09171234567',
    qrAssetId: await newImage(),
  });
  const bank = await createMethod({
    providerName: 'BPI',
    accountName: 'Sample Store Inc.',
    accountNumber: '1234-5678-90',
  });
  await createMethod({
    providerName: 'PayPal',
    accountName: 'Sample Store',
    accountNumber: 'payments@example.com',
    enabled: false,
  });

  await createBlog({
    title: 'Welcome to the store',
    content: 'We are open. Browse the new arrivals and find something you like.',
    author: 'Store Team',
    published: true,
    coverAssetId: await newImage(),
  });
  await createBlog({
    title: 'How to choose running shoes',
    content: 'Pick a pair that fits well at the end of the day, when your feet are largest.',
    author: 'Store Team',
    published: true,
  });
  await createBlog({
    title: 'Holiday sale plans',
    content: 'Draft: list the products and discounts for the holiday sale.',
    author: 'Store Team',
  });

  // Delivered by COD, which marks it paid.
  const delivered = await checkout(customer.id, home.id, 'cod', [
    { variantId: variant(tShirt, 0), quantity: 2 },
  ]);
  await updateOrderStatus(delivered, 'confirmed');
  await updateOrderStatus(delivered, 'shipped');
  await updateOrderStatus(delivered, 'delivered');

  // Paid by GCash and confirmed by an admin.
  const confirmed = await checkout(customer.id, home.id, gcash.id, [
    { variantId: variant(runner, 1), quantity: 1 },
  ]);
  await submitOwnPayment(customer.id, confirmed, 'GC-1000000001');
  await confirmPayment(confirmed);
  await updateOrderStatus(confirmed, 'confirmed');

  // A reference waiting for an admin to check it.
  const submitted = await checkout(customer.id, home.id, bank.id, [
    { variantId: variant(dress, 0), quantity: 1 },
  ]);
  await submitOwnPayment(customer.id, submitted, 'BPI-2000000002');

  // Waiting for the customer to pay.
  await checkout(customer.id, home.id, gcash.id, [{ variantId: variant(flats, 0), quantity: 1 }]);

  // Cancelled by the customer, which returns the stock.
  const cancelled = await checkout(customer.id, home.id, 'cod', [
    { variantId: variant(tote, 0), quantity: 3 },
  ]);
  await cancelOwnOrder(customer.id, cancelled);

  const guestItems = [{ variantId: variant(tote, 0), quantity: 1 }];
  const guestPreview = await previewOrder(guestItems);
  await createGuestOrder({
    email: 'guest@example.com',
    address: { ...address, recipientName: 'Maria Santos' },
    items: guestItems,
    paymentMethod: gcash.id,
    expectedTotalCents: guestPreview.totalCents,
    idempotencyKey: randomUUID(),
  });

  // Left in the cart, so the storefront has something to show.
  await addItem(customer.id, { variantId: variant(tShirt, 2), quantity: 1 });
  await addItem(customer.id, { variantId: variant(tote, 0), quantity: 2 });

  console.log('Seeded the database. Log in with:');
  console.log(`  ${admin.email} (admin) / ${PASSWORD}`);
  console.log(`  ${customer.email} (customer) / ${PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
