import { randomUUID } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { env } from '../config/env';
import { createAddress } from '../modules/addresses/address.service';
import { createAsset } from '../modules/assets/asset.service';
import { register } from '../modules/auth/auth.service';
import { createBanner } from '../modules/banners/banner.service';
import { createBlog } from '../modules/blogs/blog.service';
import { addItem } from '../modules/cart/cart.service';
import type { CartItemInput } from '../modules/cart/cart.validation';
import { createCategory } from '../modules/categories/category.service';
import { createCoupon } from '../modules/coupons/coupon.service';
import type { OrderStatus } from '../modules/orders/order.schema';
import {
  cancelOwnOrder,
  confirmPayment,
  createGuestOrder,
  createOrder,
  previewOrder,
  refundPayment,
  rejectPayment,
  submitOwnPayment,
  updateOrderStatus,
} from '../modules/orders/order.service';
import { createMethod } from '../modules/payment-methods/payment-method.service';
import { createPromotion } from '../modules/promotions/promotion.service';
import { createSale } from '../modules/sales/sale.service';
import {
  addImage,
  addVariant,
  createProduct,
  deactivateVariant,
  updateVariant,
} from '../modules/products/product.service';
import { db, pool } from './index';
import { roles, SUPER_ADMIN_ROLE_ID, users } from './schema';

// Development data only, so a shared password is fine. Production is refused below.
const PASSWORD = 'dev-password-123';
const ADMIN_EMAIL = 'admin@example.com';
const STAFF_EMAIL = 'staff@example.com';
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
  items: CartItemInput[],
  couponCode?: string,
) {
  for (const item of items) {
    await addItem(userId, item);
  }

  const preview = await previewOrder(items, { couponCode, customer: { userId } });
  const { order } = await createOrder(userId, {
    addressId,
    paymentMethod,
    expectedTotalCents: preview.totalCents,
    idempotencyKey: randomUUID(),
    couponCode,
  });

  return order.id;
}

async function moveTo(orderId: string, ...statuses: OrderStatus[]) {
  for (const status of statuses) {
    await updateOrderStatus(orderId, status);
  }
}

async function main() {
  if (env.APP_ENV === 'production') throw new Error('Seeding is not allowed in production');

  const [existing] = await db.select({ total: count() }).from(users);
  if ((existing?.total ?? 0) > 0) {
    throw new Error('The database already has users. Reset it before seeding.');
  }

  const admin = await register({ email: ADMIN_EMAIL, password: PASSWORD });
  await db.update(users).set({ roleId: SUPER_ADMIN_ROLE_ID }).where(eq(users.id, admin.id));

  const staff = await register({ email: STAFF_EMAIL, password: PASSWORD });
  const [staffRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Staff'));
  await db
    .update(users)
    .set({ roleId: staffRole?.id ?? null })
    .where(eq(users.id, staff.id));
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

  const men = await createCategory({ name: 'Men', icon: 'shirt', imageAssetId: await newImage() });
  const women = await createCategory({
    name: 'Women',
    icon: 'shopping-bag',
    imageAssetId: await newImage(),
  });
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

  // A regular sale, and a flash sale with a stock cap that ends in two days.
  await createSale({
    name: 'Accessories Week',
    discountType: 'percent',
    discountValue: 15,
    categoryIds: [accessories.id],
  });
  await createSale({
    name: 'Runner Flash Sale',
    discountType: 'fixed',
    discountValue: 50000,
    endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    stockCap: 20,
    productIds: [runner.id],
  });

  // The sample orders never complete either, so their totals stay as they were.
  await createPromotion({
    name: 'Buy 2 tees, get 1 free',
    type: 'buy_x_get_y',
    buyQuantity: 2,
    getQuantity: 1,
    getPercentOff: 100,
    productIds: [tShirt.id],
  });
  await createPromotion({
    name: 'Tee and flats set',
    type: 'bundle',
    discountType: 'percent',
    discountValue: 10,
    productIds: [tShirt.id, flats.id],
  });

  await createCoupon({
    code: 'WELCOME10',
    discountType: 'percent',
    discountValue: 10,
    maxDiscountCents: 20000,
    minSubtotalCents: 50000,
  });
  await createCoupon({
    code: 'SPEND5000',
    discountType: 'fixed',
    discountValue: 50000,
    minSubtotalCents: 500000,
    isAutomatic: true,
  });
  await createCoupon({
    code: 'FREESHIP',
    discountType: 'free_shipping',
    minSubtotalCents: 150000,
    perCustomerLimit: null,
  });

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

  await createBanner({
    assetId: await newImage(),
    mobileAssetId: await newImage(),
    altText: 'New arrivals for the season',
    title: 'New Arrivals',
    subtitle: 'Fresh styles, just in',
    linkUrl: '/products',
  });
  await createBanner({
    assetId: await newImage(),
    altText: 'Free shipping on every order this week',
    title: 'Free Shipping',
    position: 1,
  });

  const basics = [
    { variantId: variant(tShirt, 0), quantity: 2 },
    { variantId: variant(tote, 0), quantity: 1 },
  ];
  const shoes = [{ variantId: variant(runner, 1), quantity: 1 }];
  const outfit = [
    { variantId: variant(dress, 0), quantity: 1 },
    { variantId: variant(flats, 0), quantity: 1 },
    { variantId: variant(tote, 0), quantity: 1 },
  ];
  const mixed = [
    { variantId: variant(tShirt, 2), quantity: 1 },
    { variantId: variant(runner, 0), quantity: 1 },
  ];
  const flatsAndTote = [
    { variantId: variant(flats, 1), quantity: 1 },
    { variantId: variant(tote, 0), quantity: 2 },
  ];
  const summer = [
    { variantId: variant(tShirt, 1), quantity: 1 },
    { variantId: variant(dress, 1), quantity: 1 },
    { variantId: variant(tote, 0), quantity: 1 },
  ];

  const order = (paymentMethod: string, items: CartItemInput[]) =>
    checkout(customer.id, home.id, paymentMethod, items);

  /** Places a manual order, then submits a reference that an admin confirms. */
  const paidOrder = async (paymentMethod: string, items: CartItemInput[], reference: string) => {
    const id = await order(paymentMethod, items);
    await submitOwnPayment(customer.id, id, reference);
    await confirmPayment(id);
    return id;
  };

  // One order for every combination of status and payment status that can happen.
  // COD orders are only paid on delivery.
  await moveTo(await order('cod', basics), 'confirmed');
  await moveTo(await order('cod', shoes), 'confirmed', 'shipped');
  await moveTo(await order('cod', outfit), 'confirmed', 'shipped', 'delivered');
  await moveTo(
    await checkout(customer.id, home.id, 'cod', outfit, 'WELCOME10'),
    'confirmed',
    'shipped',
    'delivered',
  );

  const codRefunded = await order('cod', mixed);
  await moveTo(codRefunded, 'confirmed', 'shipped', 'delivered');
  await refundPayment(codRefunded);

  await moveTo(await order('cod', flatsAndTote), 'confirmed', 'shipped', 'returned');
  await cancelOwnOrder(customer.id, await order('cod', summer));

  // Manual orders are paid when an admin confirms the reference, which moves them to pending.
  await paidOrder(gcash.id, basics, 'GC-1000000001');
  await moveTo(await paidOrder(bank.id, shoes, 'BPI-2000000001'), 'confirmed');
  await moveTo(await paidOrder(gcash.id, outfit, 'GC-1000000002'), 'confirmed', 'shipped');
  await moveTo(
    await paidOrder(bank.id, mixed, 'BPI-2000000002'),
    'confirmed',
    'shipped',
    'delivered',
  );

  const deliveredRefunded = await paidOrder(gcash.id, flatsAndTote, 'GC-1000000003');
  await moveTo(deliveredRefunded, 'confirmed', 'shipped', 'delivered');
  await refundPayment(deliveredRefunded);

  await moveTo(
    await paidOrder(bank.id, summer, 'BPI-2000000003'),
    'confirmed',
    'shipped',
    'returned',
  );

  const returnedRefunded = await paidOrder(gcash.id, basics, 'GC-1000000004');
  await moveTo(returnedRefunded, 'confirmed', 'shipped', 'returned');
  await refundPayment(returnedRefunded);

  await cancelOwnOrder(customer.id, await order(bank.id, shoes));

  // Cancelled after payment, so the refund is still owed.
  await moveTo(await paidOrder(gcash.id, outfit, 'GC-1000000005'), 'cancelled');

  const cancelledRefunded = await paidOrder(bank.id, mixed, 'BPI-2000000004');
  await moveTo(cancelledRefunded, 'cancelled');
  await refundPayment(cancelledRefunded);

  // Rejected references cancel the order, but the payment row stays for the admin to see.
  const rejected = await order(gcash.id, flatsAndTote);
  await submitOwnPayment(customer.id, rejected, 'GC-1000000006');
  await rejectPayment(rejected);

  // Open orders come last, as checkout limits how many unpaid orders a customer can have.
  await order('cod', summer);
  await order(gcash.id, basics);
  await submitOwnPayment(customer.id, await order(bank.id, shoes), 'BPI-2000000005');

  const guestItems = [
    { variantId: variant(tote, 0), quantity: 1 },
    { variantId: variant(tShirt, 2), quantity: 2 },
  ];
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
