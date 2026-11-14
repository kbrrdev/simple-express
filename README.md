# Simple Express Boilerplate

A simple and maintainable backend boilerplate built with **Express 5, TypeScript, Drizzle ORM, PostgreSQL, Joi, and Docker**.

It runs a complete store API: accounts, products and variants, carts, guest and customer checkout, manual payments, addresses, uploads, and blogs.

## Tech Stack

- **Runtime:** Node.js 24.7+
- **Framework:** Express 5
- **Language:** TypeScript
- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **Validation:** Joi
- **API Documentation:** Swagger / OpenAPI
- **Containerization:** Docker and Docker Compose
- **Logging:** Pino
- **Email:** Nodemailer, with Mailpit in development
- **Testing:** Vitest and Supertest
- **Code Quality:** ESLint and Prettier

## Getting Started

### Prerequisites

- Node.js 24.7+
- npm
- Docker and Docker Compose

### Environment Setup

Create your environment file:

```bash
cp .env.example .env
```

Set `JWT_SECRET` to a random value of at least 32 characters. The API will not start without it. To generate one:

```bash
node -p "require('crypto').randomBytes(32).toString('hex')"
```

Set `POSTGRES_PASSWORD` and `APP_DB_PASSWORD` to random values too, using only URL-safe characters. Docker will not start without them. The API connects as this limited role, which can read and write rows but not change the schema. When running on your host, also put it in `DATABASE_URL`, and set `MIGRATION_DATABASE_URL`, which `npm run db:migrate` connects with.

Update the other environment variables as needed. If the API runs behind a proxy, set `TRUST_PROXY_HOPS` to the number of proxies.

### Run Everything in Docker

```bash
docker compose up --build
```

Database migrations run automatically before the API starts.

API: `http://localhost:3000`

### Run in Docker with Live Reload

```bash
npm run docker:watch
```

Changes in `src/` sync into the container and reload the application.

- New migrations restart the application.
- Changes to `package-lock.json` rebuild the image.
- Press `Ctrl+C` to stop watching.
- Run `npm run docker:down` to stop the containers.

### Run the API Locally with Docker PostgreSQL

```bash
npm install
docker compose up -d db
npm run db:migrate
npm run dev
```

PostgreSQL is published on host port `5433` by default to avoid conflicts with an existing local installation.

To use another port, update `POSTGRES_PORT` and `DATABASE_URL` in `.env`.

## Available Scripts

| Script                                  | Description                                         |
| --------------------------------------- | --------------------------------------------------- |
| `npm run dev`                           | Start development server with automatic reload      |
| `npm run build`                         | Compile TypeScript to `dist/`                       |
| `npm start`                             | Run the compiled application                        |
| `npm run typecheck`                     | Type-check without emitting files                   |
| `npm run lint`                          | Run ESLint                                          |
| `npm run lint:fix`                      | Automatically fix ESLint issues                     |
| `npm run format`                        | Format code with Prettier                           |
| `npm run format:check`                  | Check code formatting                               |
| `npm run db:generate`                   | Generate migrations from schema changes             |
| `npm run db:migrate`                    | Apply pending migrations                            |
| `npm run db:studio`                     | Open Drizzle Studio                                 |
| `npm run db:set-role -- <email> <role>` | Give a user a role, or `customer` to remove it      |
| `npm run db:seed`                       | Fill an empty database with sample data             |
| `npm run postman`                       | Regenerate the Postman collection                   |
| `npm run email:test -- <email>`         | Send a test email                                   |
| `npm run docker:watch`                  | Run Docker development environment with live reload |
| `npm run docker:down`                   | Stop Docker development containers                  |
| `npm run test:db`                       | Start the disposable test database                  |
| `npm test`                              | Start the test database and run the test suite      |

## API Documentation

API documentation is provided through Swagger UI using the OpenAPI specification.

With the API running, open the interactive documentation at:

`http://localhost:3000/api-docs`

The raw OpenAPI document is available at `http://localhost:3000/api-docs.json`.

Swagger is not served when `APP_ENV` is `production`.

### Postman

Import [docs/postman-collection.json](docs/postman-collection.json) into Postman. Run **Log in and start a session** first. Tokens and created IDs are saved to collection variables, and later requests use them. To target another server, change the `baseUrl` variable.

The collection is generated from the OpenAPI document, so run `npm run postman` after changing any `<name>.openapi.ts` file. A test fails if it is out of date.

Each module documents its endpoints in its own `<name>.openapi.ts` file, and `src/docs/openapi.ts` combines them with the shared definitions. These files are maintained by hand, so update them whenever an endpoint changes.

## Project Structure

```text
src/
├── app.ts
├── index.ts
├── config/
├── db/
├── docs/
├── lib/
├── middleware/
├── routes/
└── modules/
    ├── addresses/
    ├── assets/
    ├── audit-logs/
    ├── auth/
    ├── banners/
    ├── blogs/
    ├── cart/
    ├── categories/
    ├── coupons/
    ├── orders/
    ├── payment-methods/
    ├── products/
    ├── promotions/
    ├── reports/
    ├── roles/
    ├── sales/
    └── users/

docs/
drizzle/
tests/
AGENTS.md
CLAUDE.md
README.md
```

### Directory Responsibilities

| Directory     | Responsibility                                                 |
| ------------- | -------------------------------------------------------------- |
| `config/`     | Application configuration and environment validation           |
| `db/`         | Database connection, schemas, and migration runner             |
| `src/docs/`   | Shared OpenAPI definitions served by Swagger UI                |
| `docs/`       | Architecture, deployment, security, and the Postman collection |
| `lib/`        | Shared application utilities and error classes                 |
| `middleware/` | Express middleware                                             |
| `routes/`     | Central route registration                                     |
| `modules/`    | Feature-based application modules                              |
| `drizzle/`    | Generated SQL migrations                                       |
| `tests/`      | API tests                                                      |

## Architecture

The project follows a simple feature-based modular structure.

Each feature keeps its routes, controllers, services, and validation schemas together when needed.

See [docs/architecture.md](docs/architecture.md) for the request lifecycle and how each feature works.

## Adding a New Module

Use the existing Blogs module as a reference.

1. Create a new folder under `src/modules/`.
2. Add only the necessary files for the feature.
3. Export database tables from `src/db/schema.ts`.
4. Generate a migration using `npm run db:generate`.
5. Apply the migration using `npm run db:migrate`.
6. Register the module routes in `src/routes/index.ts`.
7. Document the endpoints in `<name>.openapi.ts` and add its exports to `src/docs/openapi.ts`.

## Email

Development uses [Mailpit](https://mailpit.axllent.org), which catches every email in a local inbox at <http://localhost:8025>, so nothing is really delivered. It starts with `npm run docker:watch`.

To send a test email:

```bash
npm run email:test -- you@example.com
```

To send from code, use `sendEmail` from `src/lib/email.ts`. Send after saving your changes, and handle a failure, so that a mail problem never undoes an order. Real email settings are in [docs/deployment.md](docs/deployment.md).

## Sample Data

To fill an empty development database with sample data, run the migrations, then:

```bash
npm run db:seed
```

It adds a super admin, a staff account, and a customer, nested categories, products with variants and images, payment methods, blogs, banners, a sale and a flash sale, two coupons and an automatic discount, a buy X get Y and a bundle, a cart, and an order for every combination of payment type, order status, and payment status that can happen, most with several items. It needs `MAX_OPEN_UNPAID_ORDERS` to be at least 3, and the default is 5. Sessions, failed logins, and password resets are left empty, as using the API creates them. Log in with:

| Email                  | Role        | Password           |
| ---------------------- | ----------- | ------------------ |
| `admin@example.com`    | Super admin | `dev-password-123` |
| `staff@example.com`    | Staff       | `dev-password-123` |
| `customer@example.com` | Customer    | `dev-password-123` |

The seed refuses to run in production, or when the database already has users. To seed again, reset the database and run the migrations first:

```bash
npm run docker:down -- -v
npm run docker:watch
npm run db:seed
```

`-v` also deletes uploaded files. On a staging server, run `docker compose exec api node dist/db/seed.js`.

## Viewing the Database

You can browse the development database in a web browser with either tool. Both are free.

**Drizzle Studio** needs the database running. Start it, then open <https://local.drizzle.studio>:

```bash
npm run db:studio
```

The command runs on your host and connects using `DATABASE_URL` from `.env`. The page loads from Drizzle's website, but your data stays on your machine.

**Adminer** starts with `npm run docker:watch` at <http://localhost:8081>. Log in with:

| Field    | Value                           |
| -------- | ------------------------------- |
| System   | PostgreSQL                      |
| Server   | `db`                            |
| Username | `POSTGRES_USER` from `.env`     |
| Password | `POSTGRES_PASSWORD` from `.env` |
| Database | `POSTGRES_DB` from `.env`       |

Adminer only runs in the development stack, and only your own machine can reach it. To run SQL directly, use its **SQL command** page.

## Database Migrations

This project uses Drizzle ORM and Drizzle Kit for database schema management.

When changing database schemas:

1. Update the Drizzle schema definitions.
2. Generate a migration.
3. Review the generated SQL.
4. Apply the migration.
5. Commit migration files to version control.

Generated migration files must be committed. Do not manually modify the production database schema outside the migration process.

## Environment Variables

Application configuration is managed through environment variables.

- `.env` contains local environment configuration.
- `.env.example` documents the required environment variables.
- Environment variables are validated at application startup using Joi.

Never commit `.env` files or expose sensitive credentials.

## Authentication

Clients log in with an email and password and receive two tokens:

- **Access token:** a JWT valid for 15 minutes, sent as `Authorization: Bearer <token>`.
- **Refresh token:** a random token valid for 30 days, used to get new tokens. Each one works once, so store the new one after every refresh.

| Endpoint                         | Description                                | Requires access token |
| -------------------------------- | ------------------------------------------ | --------------------- |
| `POST /api/auth/register`        | Create a user                              | No                    |
| `POST /api/auth/login`           | Start a session                            | No                    |
| `POST /api/auth/refresh`         | Get new tokens                             | No                    |
| `POST /api/auth/change-password` | Change the password, ending other sessions | Yes                   |
| `POST /api/auth/forgot-password` | Email a password reset link                | No                    |
| `POST /api/auth/reset-password`  | Set a new password, ending all sessions    | No                    |
| `POST /api/auth/logout`          | End the current session                    | Yes                   |
| `POST /api/auth/logout-all`      | End all sessions for the user              | Yes                   |
| `GET /api/auth/me`               | Get the current user                       | Yes                   |

Login requires a `client` value:

- `web`: the refresh token is set as an `httpOnly` cookie. Keep the access token in memory, and call `/api/auth/refresh` with credentials included.
- `native`: the refresh token is returned in the response body. Keep it in secure storage, and send it as `refreshToken` in the body of `/api/auth/refresh`.

Every access token belongs to a session, and the session is checked on each protected request, so logout takes effect immediately. Each refresh token holds its session ID and is signed. Reusing any old refresh token revokes the session, apart from the one just replaced, which is allowed for 30 seconds for retries and parallel tabs.

Passwords must be 8 to 128 characters and cannot be a common password. After five failed logins, an email is delayed for 30 seconds, doubling up to five minutes, even with the right password. A quiet 15 minutes resets this.

Forgotten passwords are reset by email. The link opens `PASSWORD_RESET_URL`, a page in your storefront, with the token after `#token=`. The page sends it to `/api/auth/reset-password` with the new password. Links expire in 30 minutes and work once.

To protect a route, add the `requireAuth` middleware. The current user is then available in `res.locals.auth`.

### Roles and Permissions

New users are customers, with no role. Staff accounts get a role, and each role is a set of permissions:

| Permission               | Allows                                                                    |
| ------------------------ | ------------------------------------------------------------------------- |
| `orders.view`            | List and view any order                                                   |
| `orders.manage`          | Change order status, and confirm or reject payments                       |
| `orders.refund`          | Record refunds                                                            |
| `products.view`          | See all products and variants, including inactive ones                    |
| `products.manage`        | Create and edit products, prices, variants, and images, and turn them off |
| `inventory.manage`       | Change variant stock only                                                 |
| `categories.manage`      | Create, edit, and delete categories                                       |
| `blogs.manage`           | Write blogs and read drafts                                               |
| `banners.manage`         | Manage the storefront banners                                             |
| `promotions.manage`      | Manage sales, flash sales, coupons, and promotions                        |
| `assets.manage`          | List, upload, and delete files                                            |
| `payment_methods.manage` | Manage payment methods and see account numbers                            |
| `reports.operations`     | Order status and low stock reports                                        |
| `reports.sales`          | Sales summary, chart, and top products                                    |
| `audit_logs.view`        | Read the audit log                                                        |

The migration creates three roles:

- **Super admin** has every permission, including ones added later, and is the only role that manages roles. It cannot be changed or deleted.
- **Admin** has every permission above. Existing admins were moved to this role.
- **Staff** handles orders and stock: `orders.view`, `orders.manage`, `products.view`, `inventory.manage`, `assets.manage`, and `reports.operations`.

Super admins can change Admin and Staff, and create roles of their own:

| Endpoint                     | Description                                           |
| ---------------------------- | ----------------------------------------------------- |
| `GET /api/roles/permissions` | List every permission with its description            |
| `GET /api/roles`             | List roles, with their permissions and user count     |
| `POST /api/roles`            | Create a role                                         |
| `GET /api/roles/:id`         | Get a role                                            |
| `PATCH /api/roles/:id`       | Rename a role or replace its permissions              |
| `DELETE /api/roles/:id`      | Delete a role that no user has                        |
| `GET /api/users`             | Find users by part of their email, or by role         |
| `PATCH /api/users/:id/role`  | Give a user a role, or `null` to make them a customer |

- Permissions are read on every request, so changes apply immediately, even to tokens already issued.
- Super admins cannot change their own role, so the store always keeps at least one.
- Managing roles is not a permission, so nobody can grant themselves more access.
- `GET /api/users?type=staff` lists everyone with a role, for a CMS users screen. `?type=customer&search=jane` finds a customer to promote. It also takes `roleId`, `page`, and `limit`.
- `GET /api/auth/me` returns the user's `role` and `permissions`, so a frontend can hide what they cannot use. It also returns `superAdmin`, which shows the role and user screens, as Admin can hold every permission too.
- Every change to a role or to a user's role is recorded in the [audit log](#audit-logs).

To protect a route, add `requirePermission('orders.view')` after `requireAuth`. A new feature adds its permission to `src/modules/roles/permissions.ts`, and super admins then add it to the roles that need it.

Make the first super admin from the command line, after they register:

```bash
npm run db:set-role -- jane@example.com "Super admin"
```

In the production container, run `docker compose exec api node dist/db/set-role.js jane@example.com "Super admin"`. Use `customer` as the role to remove one.

## Blogs

Published blogs are public to read, and drafts are hidden from the public, including by direct link. Users with `blogs.manage` can create, update, and delete blogs, and read drafts through `GET /api/blogs/admin` and `GET /api/blogs/admin/:id`.

## Banners

Banners are the promotional images at the top of the storefront. Users with `banners.manage` manage them, and the migration grants it to the Admin role.

| Endpoint                  | Description                                                  |
| ------------------------- | ------------------------------------------------------------ |
| `GET /api/banners`        | Public. Active banners within their dates, in position order |
| `GET /api/banners/admin`  | Every banner, including inactive and scheduled ones          |
| `POST /api/banners`       | Add a banner                                                 |
| `PATCH /api/banners/:id`  | Update a banner                                              |
| `DELETE /api/banners/:id` | Delete a banner, keeping its images                          |

- `assetId` is the default image, and is required. `mobileAssetId` is optional, and is shown on phones instead. Set it to `null` to go back to the default image.
- One `altText` describes both images.
- `linkUrl` is a storefront path starting with `/`, or an `https://` link.
- `startsAt` and `endsAt` are optional, so a sale banner can turn itself on and off. `endsAt` must be after `startsAt`.
- A store can have at most 15 banners, counting inactive and expired ones. The admin list returns the limit as `meta.maxBanners`, so the admin app can warn before it is reached.

A storefront shows the mobile image on phones with a `<picture>` element, so phones only download the image they show:

```html
<picture>
  <source media="(max-width: 767px)" srcset="{mobileImageUrl}" />
  <img src="{imageUrl}" alt="{altText}" />
</picture>
```

## Sales

A sale takes a percentage or a fixed amount off chosen products, or off whole categories and their subcategories. A flash sale is a sale with short dates, and optionally a stock cap. Users with `promotions.manage` manage them, and the migration grants it to the Admin role.

| Endpoint                | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `GET /api/sales`        | Every sale, with its `productIds` and `categoryIds`     |
| `GET /api/sales/:id`    | One sale                                                |
| `POST /api/sales`       | Add a sale                                              |
| `PATCH /api/sales/:id`  | Update a sale. Sent ID lists replace the existing ones. |
| `DELETE /api/sales/:id` | Delete a sale. Past orders keep their prices.           |

- `discountType` is `percent`, with `discountValue` from 1 to 90, or `fixed`, with `discountValue` in cents. Prices never go below zero.
- `startsAt` and `endsAt` are optional. A sale needs at least one product or category.
- When a product is in more than one sale, shoppers get the lowest price.
- `stockCap` limits how many units sell at the sale price, across all its products. Once they are sold, prices go back to normal, and cancelled orders give their units back. A cart only gets the sale price when all its units of that sale fit under the cap.

`GET /api/products?onSale=true` lists only products a current sale covers, for a sale section on the home page. It combines with the other filters.

Shoppers see sales through the prices they already use. Public product routes, the cart, and order previews return the sale price as `priceCents` or `unitPriceCents`, with `compareAtPriceCents` for showing the old price struck through, and `saleEndsAt` for a countdown. Admin product routes return the list price, which is what admins edit. Order items keep `listPriceCents`, the price before any sale.

## Promotions

Promotions are discounts on items bought together. Users with `promotions.manage` manage them at `/api/promotions`, with the same list, get, add, update, and delete endpoints as sales.

- **Buy X get Y** covers products or categories. In every `buyQuantity` + `getQuantity` units, `getPercentOff` comes off, and the cheapest units in the cart are the ones discounted. 100 makes them free.
- **Bundles** list 2 to 10 products. Each complete set gets `discountType` `percent` or `fixed` off, priced with the cheapest unit of each product in the cart.
- Items on sale are left out. Each cart line gets at most one promotion, the largest discount first.
- Coupons treat promoted lines like sale items, so they are left out unless the coupon has `allowSaleItems`.
- Public product routes add `promotions` for badges. The order preview adds `promotions`, with what each took off, and `promotionDiscountCents`. Order items keep `promotionName` and `promotionDiscountCents`, so deleting a promotion never changes past orders.

## Coupons

Shoppers enter a coupon code at checkout. Users with `promotions.manage` manage coupons.

| Endpoint                  | Description                                                 |
| ------------------------- | ----------------------------------------------------------- |
| `GET /api/coupons`        | Every coupon, with `usedCount` and `discountGivenCents`     |
| `GET /api/coupons/:id`    | One coupon                                                  |
| `POST /api/coupons`       | Add a coupon                                                |
| `PATCH /api/coupons/:id`  | Update a coupon. Past orders keep their discount.           |
| `DELETE /api/coupons/:id` | Delete an unused coupon. A used one can only be turned off. |

- `discountType` is `percent` (1 to 100, with an optional `maxDiscountCents`), `fixed` (cents), or `free_shipping`.
- Codes are saved in capitals and match whatever case shoppers type.
- `minSubtotalCents`, `startsAt`, `endsAt`, and `usageLimit` are optional.
- `perCustomerLimit` is 1 by default, and `null` means no limit. Guests are counted by email, which they can change, so turn `allowGuests` off for valuable coupons.
- Items already on sale do not count towards a coupon, for its minimum or its discount, unless `allowSaleItems` is on.
- One coupon per order, on the whole order. The discount is split across the eligible lines in proportion to their totals, and tax follows the discounted lines.
- Cancelling an order gives the use back. A refund after delivery does not.
- An account and guest orders with its email count as one customer for `perCustomerLimit`.
- Previews and checkouts that send a `couponCode` are limited to 60 per IP address every 15 minutes, so codes cannot be guessed. Requests without a code are not counted.

### Automatic Discounts

A coupon with `isAutomatic` applies without a code whenever the cart qualifies, such as "₱200 off over ₱2,000". Its code is the label shoppers see. Tiers are several automatic coupons with different minimums. Automatic coupons have no per-customer limit unless one is set.

One discount applies per order: the typed coupon or an automatic one, whichever gives the lower total. A tie goes to the automatic one, so the shopper's code is not used up. When the typed coupon loses, the preview's `couponError` says so, such as "Your cart already gets a better discount (SPEND2000)", and `coupon.automatic` tells the storefront the discount applied itself.

Send `couponCode` to `/api/orders/preview`, then to checkout. The preview never fails because of a coupon. It returns `coupon` when it applies, or `couponError` with the reason to show, such as "This coupon has expired". Send the login token, or `email` for guests, so the preview can check once-per-customer coupons. Checkout returns `409` with the same reason. Orders keep `couponCode` and `discountCents`, and each item its share in `discountCents`.

## Products

Each product belongs to one category and can have up to two options, which you name per product, such as Size and Color. Price and stock live on variants, and each variant is one combination of option values.

```json
{
  "categoryId": "...",
  "name": "Classic T-Shirt",
  "option1Name": "Size",
  "option2Name": "Color",
  "variants": [
    { "option1Value": "M", "option2Value": "Red", "priceCents": 1999, "stock": 12 },
    { "option1Value": "L", "option2Value": "Red", "priceCents": 2199, "stock": 5 }
  ]
}
```

A product with no options still has one variant, without any option values. Prices are in cents.

Categories can be nested up to three levels, such as Men › Shoes › Running, and products can belong to any level. Set `parentId` to place a category under another, or `null` for a top-level one. Changing it moves the category with everything below it. Names must be unique among categories with the same parent, so Men › Shoes and Women › Shoes can both exist. A category can also have an image, set with `imageAssetId` after uploading it to `/api/assets`, and an `icon`, the name of an icon from the frontend's icon set, such as Lucide's `shopping-bag`. Frontends show the icon when it is set, and otherwise the image.

| Endpoint                                       | Description                                                                               | Access                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/categories`                          | List categories                                                                           | Public                                                  |
| `GET /api/categories/tree`                     | Get every category, nested                                                                | Public                                                  |
| `GET /api/categories/:id`                      | Get a category and the categories above it                                                | Public                                                  |
| `POST /api/categories`                         | Create a category                                                                         | `categories.manage`                                     |
| `PATCH /api/categories/:id`                    | Rename, move, or change a category's image                                                | `categories.manage`                                     |
| `DELETE /api/categories/:id`                   | Delete an empty category                                                                  | `categories.manage`                                     |
| `GET /api/products`                            | List products on sale                                                                     | Public                                                  |
| `GET /api/products/:id`                        | Get a product on sale                                                                     | Public                                                  |
| `GET /api/products/admin`                      | List all products, including inactive ones. `?active=true` or `false` shows only one kind | `products.view`                                         |
| `GET /api/products/admin/:id`                  | Get any product, including inactive variants                                              | `products.view`                                         |
| `POST /api/products`                           | Create a product and its variants                                                         | `products.manage`                                       |
| `PATCH /api/products/:id`                      | Update a product                                                                          | `products.manage`                                       |
| `DELETE /api/products/:id`                     | Deactivate a product                                                                      | `products.manage`                                       |
| `POST /api/products/:id/variants`              | Add a variant                                                                             | `products.manage`                                       |
| `PATCH /api/products/:id/variants/:variantId`  | Update a variant                                                                          | `products.manage`, or `inventory.manage` for stock only |
| `DELETE /api/products/:id/variants/:variantId` | Deactivate a variant                                                                      | `products.manage`                                       |

Product lists support `page`, `limit`, `search`, `categoryId`, and `sort` (`newest` or `name`). Filtering by a category includes its subcategories.

To restore a deactivated product or variant, set `active` to `true` with `PATCH`.

## Cart

Each logged-in user has one cart, which follows them across devices. Prices are read from the variants each time, so a cart always shows current prices.

| Endpoint                            | Description                                         | Requires access token |
| ----------------------------------- | --------------------------------------------------- | --------------------- |
| `GET /api/cart`                     | Get the cart                                        | Yes                   |
| `DELETE /api/cart`                  | Empty the cart                                      | Yes                   |
| `POST /api/cart/items`              | Add a variant, combining with any existing quantity | Yes                   |
| `PATCH /api/cart/items/:variantId`  | Set the quantity of an item                         | Yes                   |
| `DELETE /api/cart/items/:variantId` | Remove an item                                      | Yes                   |
| `POST /api/cart/preview`            | Price a guest cart without saving it                | No                    |
| `POST /api/cart/merge`              | Move a guest cart into the user's cart              | Yes                   |

An item can have a quantity of up to 99, and adding more than the available stock returns `409`. Carts do not reserve stock, so `stock` can drop below `quantity` after an item is added. Show a warning when it does. Items that are deactivated stay in the cart with `available: false`, and are left out of the subtotal.

### Guest Carts

The API does not store guest carts. The client keeps each item's `variantId` and `quantity` on the device, then:

1. Sends them to `/api/cart/preview` to show current prices.
2. Asks the guest to log in at checkout.
3. Sends them to `/api/cart/merge`, then clears its local copy.

A merge keeps the higher quantity for an item in both carts, so retrying one is safe. Quantities are reduced to the available stock, and unavailable variants are skipped. Both are listed in `adjustments` in the response, so the client can tell the customer.

## Orders

Customers check out with cash on delivery or a manual payment method, and guests can check out without an account. Tax and shipping are added at checkout, and an order keeps its own copy of its prices and address, so later changes never alter it.

| Endpoint                                     | Description                                                                                                                        | Access          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `POST /api/orders/preview`                   | Price items with shipping and tax                                                                                                  | Public          |
| `POST /api/orders`                           | Check out the cart                                                                                                                 | Customer        |
| `GET /api/orders`                            | List your orders                                                                                                                   | Customer        |
| `GET /api/orders/:id`                        | Get one of your orders                                                                                                             | Customer        |
| `POST /api/orders/:id/payment`               | Submit a payment reference                                                                                                         | Customer        |
| `POST /api/orders/:id/cancel`                | Cancel a pending or unpaid order                                                                                                   | Customer        |
| `POST /api/orders/guest`                     | Check out as a guest                                                                                                               | Public          |
| `GET /api/orders/guest/:token`               | View a guest order                                                                                                                 | Private link    |
| `POST /api/orders/guest/:token/payment`      | Submit a payment reference                                                                                                         | Private link    |
| `GET /api/orders/admin`                      | List all orders. Filter by `status` and `paymentStatus`, and `search` by order number, email, recipient name, or payment reference | `orders.view`   |
| `GET /api/orders/admin/:id`                  | Get any order                                                                                                                      | `orders.view`   |
| `PATCH /api/orders/admin/:id/status`         | Move an order to its next status                                                                                                   | `orders.manage` |
| `POST /api/orders/admin/:id/payment/confirm` | Confirm a submitted payment                                                                                                        | `orders.manage` |
| `POST /api/orders/admin/:id/payment/reject`  | Reject a payment, cancelling the order                                                                                             | `orders.manage` |
| `POST /api/orders/admin/:id/payment/refund`  | Record a refund made outside the system                                                                                            | `orders.refund` |

### Checking Out

1. Call `/api/orders/preview` and show the customer the total, with `couponCode` if they entered one.
2. Call `POST /api/orders` with that total as `expectedTotalCents`, a new `idempotencyKey`, and the same `couponCode`.
3. If the request fails or times out, retry it with the same key. A repeated key returns the original order with `200`.

Checkout returns `409` if the cart is empty, an item is unavailable or short of stock, the coupon cannot be used, or the total has changed. Stock is reduced here, in the same transaction that creates the order.

### Statuses

```text
awaiting_payment → pending → confirmed → shipped → delivered
       ↓              ↓          ↓          ↓
   cancelled      cancelled  cancelled   returned
```

- Customers can cancel a `pending` order, or an `awaiting_payment` order before they submit a payment reference, and admins can also cancel `confirmed` orders. Cancelling returns stock.
- `returned` does not return stock, as the item may be damaged. If it is fine, add it back by updating the variant.
- A COD order becomes `paid` when it is marked `delivered`, as the customer has paid the courier. Whether the courier has sent you the money is not tracked.

### Payments

Checkout takes a `paymentMethod`, which is `cod` or the ID of a manual method. Guests cannot use COD.

Admins manage the manual methods, so GCash, Maya, banks, and PayPal can be added without code changes:

| Endpoint                          | Description                                   | Access                   |
| --------------------------------- | --------------------------------------------- | ------------------------ |
| `GET /api/payment-methods`        | List enabled methods, without account details | Public                   |
| `GET /api/payment-methods/admin`  | List all methods with account details         | `payment_methods.manage` |
| `POST /api/payment-methods`       | Add a method                                  | `payment_methods.manage` |
| `PATCH /api/payment-methods/:id`  | Update or turn off a method                   | `payment_methods.manage` |
| `DELETE /api/payment-methods/:id` | Delete a method no order has used             | `payment_methods.manage` |

```json
{
  "providerName": "GCash",
  "accountName": "Juan Dela Cruz",
  "accountNumber": "09171234567",
  "qrAssetId": "..."
}
```

`accountNumber` can be a mobile number, bank account number, or email. To add a QR code, upload it through `POST /api/assets` and send its ID as `qrAssetId`. QR codes are static, so customers still enter the amount.

Manual payments work like this:

1. The order starts as `awaiting_payment`, and returns `paymentDueAt` and a `payment` object with `providerName`, `accountName`, `accountNumber`, and `qrUrl`. Show the account name, so customers can check who they are paying.
2. The customer pays, then submits the reference, which sets the payment to `submitted`.
3. An admin filters orders with `?paymentStatus=submitted`, checks the reference, and confirms or rejects it.

Confirming marks the order `paid` and moves it to `pending`. Rejecting cancels it and returns the stock. A payment reference can only be used once.

Unpaid orders are cancelled after `PAYMENT_WINDOW_HOURS`, and their stock returned. The API checks every 5 minutes. Orders with a submitted reference never expire, so a customer who has paid cannot lose their order while waiting.

Refunds happen outside the system. Record them with the refund endpoint once the order is cancelled, returned, or delivered.

Orders copy the account they were placed with, so a customer keeps seeing the account they were told to pay, even if the method later changes or is turned off.

### Guest Checkout

Guests send their email, address, and items to `POST /api/orders/guest`, using the same preview flow. The response includes a `guestToken`, which is the only way back to the order, so show it as a private link. It cannot be recovered later, as emails do not carry it yet.

Links do not expire, so a finished order stops showing the shipping address. Guest orders are never linked to an account, even if the email matches one, as emails are not verified. Responses do not reveal whether an email is registered.

### Limits

Unpaid orders hold stock for free, so:

- One customer or guest email can have `MAX_OPEN_UNPAID_ORDERS` unpaid orders open, 5 by default.
- A guest order can have up to 10 items.
- Guest checkout is limited to 10 requests per hour per IP address.
- An unpaid order holding a capped sale or a coupon with a `usageLimit` must be paid within an hour, or `PAYMENT_WINDOW_HOURS` if that is shorter.
- An order that costs nothing, such as with a 100% coupon and free shipping, is marked paid at checkout.

### Adding a Payment Provider

No payment provider is connected. To add one, such as Stripe:

1. Add an `online` value to `payment_method_type` and `payment_type`, and a row in `payment_methods`, which will have no account details.
2. Keep its API keys in `.env`, and its code in its own file.
3. Add a webhook route that verifies the provider's signature, then translates its status.
4. Save its reference and raw status in `payments`, and call `markPaid`, which is safe to repeat.

### Tax and Shipping

Set these in `.env`:

| Variable                  | Default | Description                                                                                                                                                                      |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAX_RATE_PERCENT`        | `12`    | Tax rate. Use `0` to charge none, and decimals such as `7.5` are allowed                                                                                                         |
| `PRICES_INCLUDE_TAX`      | `true`  | `true` means prices contain tax, and `false` adds it on top                                                                                                                      |
| `SHIPPING_FEE_CENTS`      | `10000` | Flat shipping fee                                                                                                                                                                |
| `FREE_SHIPPING_MIN_CENTS` | empty   | Orders at least this much after discounts ship free. Empty always charges shipping. The order preview returns it with `freeShippingRemainingCents`, for an "add ₱X more" message |

Tax applies to items and shipping. Orders show `vatableCents`, `taxCents`, and `totalCents`, and keep the rate and fee they were placed with. This is an order summary, not an official invoice.

To use a courier's rates, change `calculateShipping` in `order.service.ts`, which preview and checkout both use.

## Reports

These endpoints feed an admin dashboard, one part each. `summary`, `sales`, and `top-products` need `reports.sales`, and `order-status` and `low-stock` need `reports.operations`.

| Endpoint                        | Dashboard part   | Returns                                                                                |
| ------------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| `GET /api/reports/summary`      | Headline numbers | Orders, gross sales, collected, refunds, tax, shipping, discounts, average order value |
| `GET /api/reports/sales`        | Sales chart      | Orders, gross sales, and collected per `day`, `week`, or `month`                       |
| `GET /api/reports/top-products` | Best sellers     | Products by `quantity` or `revenue`                                                    |
| `GET /api/reports/order-status` | Needs attention  | Orders per status, and payments to confirm, orders to confirm, and to ship             |
| `GET /api/reports/low-stock`    | Low stock        | Variants on sale with stock at or below `threshold`, 5 by default                      |

Ranges take `from` and `to` as dates, such as `?from=2026-03-01&to=2026-03-31`. Both days are included, days follow Manila time, and the default is the last 30 days. `order-status` and `low-stock` show the store as it is now.

- **Gross sales** are orders placed in the range, apart from cancelled ones.
- **Collected** is payments received in the range, counted on the day they arrived. COD orders are collected on delivery.
- **Refunded** is payments received in the range that were later refunded.
- **Discounts** is what sales took off list prices, as `saleDiscountCents`, what promotions took off, as `promotionDiscountCents`, and what coupons took off, as `couponDiscountCents`, on gross sales. Waived shipping is not included.

Reports use the amounts saved on each order, so changing the tax rate never changes past figures. If the rate changes during a range, `taxByRate` in the summary lists each rate separately.

## Audit Logs

`GET /api/audit-logs` lists changes, newest first, and needs `audit_logs.view`. It records:

- Admin changes to products, variants (including stock), product images, categories, blogs, payment methods, files, and orders.
- Password changes, password resets, signing out everywhere, role changes, and changes to roles.

Customer carts, addresses, and checkouts are not recorded. The request logs cover them.

Each entry has the user who made the change, the entity, an `action` such as `create`, `update`, or `status_change`, and `changes`, which holds each changed field as `[before, after]`:

```json
{ "action": "update", "entityType": "variant", "changes": { "priceCents": [4500, 3900] } }
```

- `actorUserId` is `null` for scripts, such as `db:set-role`.
- `requestId` matches the `requestId` in the server logs.
- Account numbers and password hashes show as `[redacted]`.

Filter with `actorUserId`, `entityType`, `entityId`, `action`, and `from` and `to` dates in Manila time.

Entries are saved in the same transaction as the change, so a failed change leaves none. The API's database role can add and read entries, but cannot change or delete them.

## Addresses

Logged-in users can save up to 20 delivery addresses in the Philippines. Requesting another user's address returns `404`.

| Endpoint                          | Description                   |
| --------------------------------- | ----------------------------- |
| `GET /api/addresses`              | List addresses, default first |
| `GET /api/addresses/:id`          | Get an address                |
| `POST /api/addresses`             | Add an address                |
| `PATCH /api/addresses/:id`        | Update an address             |
| `DELETE /api/addresses/:id`       | Delete an address             |
| `POST /api/addresses/:id/default` | Make an address the default   |

```json
{
  "recipientName": "Juan Dela Cruz",
  "phone": "09171234567",
  "line1": "123 Rizal Street",
  "line2": "Sunrise Village",
  "barangay": "San Antonio",
  "city": "Pasig",
  "province": "Metro Manila",
  "postalCode": "1605"
}
```

- `line2` is optional.
- `phone` must be a Philippine mobile number, and is stored as `+639171234567`. Landlines are not accepted.
- `province` should be `Metro Manila` for addresses in the capital region.
- `postalCode` must be 4 digits.

A user's first address becomes the default. Deleting the default makes the newest remaining address the default.

## Assets

All uploaded files are stored in one `assets` table, and products, variants, categories, blogs, and payment methods point to it. Uploading needs `assets.manage`, and anyone can view uploaded files.

Attaching an image takes two steps:

```text
1. POST /api/assets with the image in the "file" form field. Returns { id, url }.
2. Attach it using the id, as shown below.
```

| Endpoint                                                        | Description                                                 |
| --------------------------------------------------------------- | ----------------------------------------------------------- |
| `GET /api/assets`                                               | List uploaded files                                         |
| `POST /api/assets`                                              | Upload a JPEG, PNG, or WebP image of up to 5 MB             |
| `DELETE /api/assets/:id`                                        | Delete a file that nothing uses                             |
| `POST /api/products/:id/images`                                 | Add an asset to a product, up to 10                         |
| `PATCH /api/products/:id/images/:imageId`                       | Change an image's alt text or position                      |
| `DELETE /api/products/:id/images/:imageId`                      | Remove an image from a product, keeping the file            |
| `PATCH /api/products/:id/variants/:variantId`                   | Set `assetId` to give a variant one of the product's images |
| `POST /api/blogs` or `PATCH /api/blogs/:id`                     | Set `coverAssetId` to give a blog a cover                   |
| `POST /api/banners` or `PATCH /api/banners/:id`                 | Set `assetId`, and optionally `mobileAssetId`, for a banner |
| `POST /api/categories` or `PATCH /api/categories/:id`           | Set `imageAssetId` to give a category an image              |
| `POST /api/payment-methods` or `PATCH /api/payment-methods/:id` | Set `qrAssetId` to give a method a QR code                  |

File types are checked from the file's contents, and uploaded filenames are never used. A file cannot be deleted while anything uses it, including past orders.

### File Storage

Files are saved to disk by default, in the `uploads-data` Docker volume. The volume survives rebuilds, but it is not backed up, and it only works with a single API server. Set `PUBLIC_BASE_URL` to the public address of the API, as it is used to build file URLs.

To use S3 instead, set these in `.env`:

```bash
S3_BUCKET=my-store-assets
S3_REGION=ap-southeast-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

S3 is used whenever `S3_BUCKET` is set, and the API will not start if any of the others are missing. The bucket must allow public reads, as file URLs point directly to it.

For an S3-compatible service, also set `S3_ENDPOINT` and `S3_PUBLIC_URL`. On AWS, `S3_PUBLIC_URL` is optional, and can point to a CDN.

Only the file path is stored, so changing the storage does not touch the database. Copy existing files to the new location first, or their URLs will stop working. Back up the volume or bucket along with the database.

## Logging

The app logs JSON to standard output with [Pino](https://getpino.io), and Docker collects and rotates it. In development, logs are formatted to be readable. Set the level with `LOG_LEVEL`. Each line names its environment in `env`.

Every line from one API request carries the same `requestId`, and a `userId` once the user is logged in. The ID is also returned in the `X-Request-Id` header, and in the body of `500` errors, so a customer can quote it.

To follow a request or a customer in Docker:

```bash
docker compose logs api | grep <requestId>
docker compose logs api | grep <userId>
```

Logs cover every request, all errors, all payment activity, and processes such as checkout, stock, status changes, and the expiry timer.

Errors also show `lastStep` and `steps`, the work a request finished before failing:

```json
{
  "level": 40,
  "requestId": "7f3c9a1e-...",
  "userId": "a81b...",
  "status": 409,
  "lastStep": "Items checked",
  "steps": [
    "Authenticated",
    "Validated body",
    "Checkout started",
    "Address loaded",
    "Cart loaded",
    "Payment method checked",
    "Order limit checked",
    "Items checked"
  ],
  "msg": "The order total has changed"
}
```

To log from anywhere, use `logger` from `src/lib/logger.ts`, and `recordStep` from `src/lib/request-context.ts` to note progress. The IDs are added automatically.

Never log passwords, tokens, emails, phone numbers, addresses, account numbers, or payment references. Use IDs instead.

## Deployment

See [docs/deployment.md](docs/deployment.md) for running on an Ubuntu server, including the differences between development, staging, and production.

## Security

Known gaps and decisions are recorded in [docs/security.md](docs/security.md). Tools for checking the project are described in [docs/security-tools.md](docs/security-tools.md).

## Testing

Tests run against a disposable database on port `5434`, separate from the development database. `npm test` starts it automatically.

```bash
npm test
```

To stop the test database, run `docker compose stop db-test`.

## CORS

Configure `CORS_ORIGINS` in `.env` using a comma-separated list of exact origins.

Example:

```env
CORS_ORIGINS=http://localhost:5173,https://app.example.com
```

Leave it empty to allow no cross-origin browser requests.

Wildcards and values containing paths or trailing slashes are rejected during startup.

**Important:** CORS only restricts browser-based cross-origin requests. It does not protect the API from other clients and is not a substitute for authentication or authorization.

## Development Guidelines

This project prioritizes simplicity, consistency, and maintainability.

- Follow existing project patterns.
- Prefer readable and straightforward implementations.
- Avoid unnecessary abstractions and dependencies.
- Keep controllers focused on HTTP handling.
- Keep business logic in services.
- Use Joi for request validation.
- Use Drizzle ORM for database operations.
- Use ESLint and Prettier to maintain code quality.
- Write tests for important business logic and API behavior.

For additional development instructions and AI coding guidelines, see [AGENTS.md](AGENTS.md).

## License

Add your preferred license here.
