# Backend Architecture

## Overview

The backend follows a modular architecture using Express.js and TypeScript.

Features are organized into modules, with each module containing its routes, controller, service, validation, database schema, and API documentation.

## Request Lifecycle

```text
Client
  |
  v
Express Application
  |
  v
Global Middleware (request logging, security headers, CORS, JSON and cookie parsing)
  |
  v
Routes
  |
  v
Authentication (protected routes only)
  |
  v
Request Validation (Joi)
  |
  v
Controller
  |
  v
Service
  |
  v
Drizzle ORM
  |
  v
PostgreSQL
  |
  v
Response
```

Errors raised at any step go to the centralized error handler, which sends the error response.

## Application Structure

### app.ts

Express application setup: global middleware, routes, and error handling.

### index.ts

Server startup and graceful shutdown.

### config/

Environment variables, validated with Joi at startup.

### db/

Database connection, migration runner, and schema exports.

### docs/

Shared OpenAPI definitions, combined with each module's documentation and served by Swagger UI outside production. The Postman collection in this folder is generated from them.

### lib/

Shared utilities, including the `AppError` class, the logger, and file storage.

### middleware/

Shared Express middleware for request logging, authentication, request validation, rate limits, and error handling.

### modules/

Feature-based application modules.

Each module can contain:

- routes
- controller
- service
- validation
- schema
- openapi

### routes/

Central route registration. Module routes are mounted under `/api`.

## Routes

| Path                   | Description                   |
| ---------------------- | ----------------------------- |
| `/health`              | API and database health check |
| `/api-docs`            | Swagger UI, not in production |
| `/api-docs.json`       | OpenAPI, not in production    |
| `/api/addresses`       | Addresses module              |
| `/api/assets`          | Assets module                 |
| `/api/audit-logs`      | Audit logs module             |
| `/api/auth`            | Auth module                   |
| `/api/blogs`           | Blogs module                  |
| `/api/cart`            | Cart module                   |
| `/api/categories`      | Categories module             |
| `/api/orders`          | Orders module                 |
| `/api/payment-methods` | Payment methods module        |
| `/api/products`        | Products module               |
| `/api/reports`         | Reports module                |
| `/api/roles`           | Roles module                  |
| `/api/users`           | Users module                  |

## Database

- PostgreSQL is the primary database.
- Drizzle ORM handles database queries.
- Drizzle Kit generates migrations into `drizzle/`.
- Each module defines its tables in `<name>.schema.ts`, exported through `src/db/schema.ts`.
- Docker applies pending migrations when the API container starts. Outside Docker, run `npm run db:migrate`.
- `src/db/seed.ts` fills an empty database through the module services, so sample data follows the same rules as the API. It refuses to run in production.
- The API connects with `DATABASE_URL`, a limited role that can read and write rows only. Migrations use `MIGRATION_DATABASE_URL`, and create the limited role and its grants.

## Authentication

- Access tokens are JWTs valid for 15 minutes, signed with `JWT_SECRET`, and sent as bearer tokens.
- Refresh tokens are valid for 30 days, and hold the session ID, a random secret, and an HMAC signature. Only their SHA-256 hashes are stored.
- Each login creates a row in `sessions`, and the session ID is included in the access token.
- The `requireAuth` middleware checks the session on every protected request, so revoking a session takes effect immediately.
- Refresh tokens rotate on each use. A correctly signed token that is no longer current revokes its session, apart from the previous token, which is allowed for 30 seconds. Forged tokens are rejected without touching the session.
- Web clients receive the refresh token as an `httpOnly` cookie, and native clients receive it in the response body.
- Customers have no role. Staff users have one role, through `users.role_id`. See Roles and Permissions below.
- Passwords are hashed with Argon2id using Node's built-in `crypto` module.
- New passwords are checked against a bundled list of common passwords. Changing a password keeps the current session and revokes the others.
- Password reset emails a link to `PASSWORD_RESET_URL` with `#token=...`, as fragments are never sent to servers or logged. Only the token's SHA-256 hash is stored in `password_resets`.
- A reset token expires in 30 minutes and works once. Each new request cancels the older tokens, and an account gets at most three emails an hour. Resetting revokes every session and clears failed logins.
- `forgot-password` always returns `202` and sends the email after the response, so neither the response nor its timing shows whether an email has an account.
- Login, registration, password changes, and token refresh are rate limited per IP address, in memory.
- Failed logins are also tracked per email in `login_attempts`, including unknown emails. After five failures, the email is delayed for 30 seconds, doubling up to five minutes.

## Roles and Permissions

- Permissions are a fixed list in `src/modules/roles/permissions.ts`, as each one guards specific routes. A new feature adds its own.
- Roles are data in `roles` and `role_permissions`, so super admins can change them and create new ones without a deploy.
- Super admin is a built-in role with a fixed ID. It has every permission, including ones added later, and cannot be changed or deleted.
- `requireAuth` reads the user's permissions in the same query that checks the session, so changes apply on the next request. That subquery names its tables in plain SQL, because Drizzle leaves table names out of single-table queries and a bare `role_id` would match the subquery's own column.
- `requirePermission` guards each admin route. Changing only a variant's stock needs `inventory.manage`, and any other change needs `products.manage`.
- Managing roles uses `requireSuperAdmin` and is not a permission, so nobody can grant themselves more access.
- Role changes and role assignments take an advisory lock. Assigning a role checks again under the lock that the actor is still a super admin, and super admins cannot change their own role, so two super admins cannot remove each other and leave none.
- A role that users have cannot be deleted, as `users.role_id` restricts it.
- `db:set-role` assigns roles from the command line, and is how the first super admin is made.
- `GET /api/users` lets super admins find who to give a role. The user's `superAdmin` flag tells a frontend when to show role management, as Admin can hold every permission too.
- Searches escape `%` and `_` with `src/lib/escape-like-pattern.ts`, so they match literally.

## Blogs

Published blogs are public to read, and drafts are hidden, including by direct link. Writing blogs and reading drafts need `blogs.manage`.

## Categories

- `parent_id` nests categories, up to three levels. Products can belong to any level, and filtering products by a category includes its subcategories.
- Names are unique among siblings. The unique index treats nulls as equal, so top-level names are unique too.
- Changing `parent_id` moves the whole subtree. Moves into the category's own subtree, or past three levels, are rejected.
- Changes take an advisory lock and run one at a time, so that two moves cannot form a loop. Stores have few categories, so they are read whole for these checks and for `/api/categories/tree`.
- A category cannot be deleted while it has subcategories or products.

## Products

- Each product belongs to one category.
- A product has zero to two options, named per product in `option1_name` and `option2_name`, such as Size and Color.
- Each product has at least one row in `product_variants`, which holds the option values, price, and stock. A product with no options has one variant with no values.
- Prices are stored as integer cents.
- Option values must match the product's options, and each combination is unique within a product. Options can be renamed, but not added or removed after creation.
- Products and variants are deactivated instead of deleted, so that future orders can keep referencing them.
- Public routes only return active products that have an active variant, and only their active variants.
- Admin routes, `/api/products/admin` and `/api/products/admin/:id`, return every product and variant, so that inactive ones can be edited and turned back on.

## Cart

- `cart_items` holds one row per user and variant, so each user has one cart.
- Prices are never stored in the cart. They are read from the variant on each request.
- Carts do not reserve stock. Stock is checked when items are added, and must be checked again at checkout.
- Adding to the cart checks the quantity limit inside the upsert, so parallel requests cannot exceed it.
- Guest carts are kept by the client. `POST /api/cart/preview` prices them, and `POST /api/cart/merge` moves them into the user's cart after login, keeping the higher quantity for items in both.

## Payment Methods

- `payment_methods` lists the methods admins manage, such as GCash, banks, and PayPal, so adding one needs no code. Accounts can be any text, as no single format fits them all.
- The public list leaves out account details, which are only shown on an order after checkout.
- A method that orders use cannot be deleted, only turned off.
- A provider such as Stripe would be a row with an `online` type and no account details. Its keys belong in `.env`, and its code and webhook in their own files.

## Orders

- Orders copy the prices, product details, tax, and address they were placed with, so that later changes never alter them.
- Order statuses, payment statuses, and payment types are the store's own enums. A future payment provider's statuses are mapped onto them.
- Checkout runs in one transaction. It locks the user, handles repeated `idempotencyKey` values, reads prices from the database, compares the total with `expectedTotalCents`, reduces stock with a conditional update in variant order, then saves the order and empties the cart.
- Queries inside the transaction use its connection, so that a burst of checkouts cannot exhaust the pool.
- Status changes lock the order row, so that stock is only returned once. `adminTransitions` in `order.service.ts` lists the allowed moves.
- Unpaid orders hold stock for free. `MAX_OPEN_UNPAID_ORDERS` limits them per customer or guest email, and guest orders are limited to 10 items. Guest checkout takes an advisory lock on the email, so that parallel requests cannot pass the limit or create duplicates.
- Order amounts are `bigint`, as a total can pass the 32-bit limit.
- `markPaid` is the only way an order becomes paid, and is safe to repeat, so a future webhook can use it. It sets `paid_at`, which reports use to count payments by the day they arrived. `calculateShipping` is the only place that sets the fee.
- Manual orders start as `awaiting_payment`, and a row in `payments` records the reference. The unique provider and reference stop a payment being counted twice.
- Orders copy the provider, account name, account number, and QR of the `payment_methods` row they were placed with. The QR has a foreign key, so a file an unpaid order still shows cannot be deleted.
- `expireUnpaidOrders` runs every 5 minutes from `index.ts`. It uses `FOR UPDATE SKIP LOCKED`, so several servers can run it safely, and it skips orders with a submitted reference.
- Guest orders have a `guest_email` and no `user_id`, and are never linked to accounts. Their links do not expire, so finished orders hide the shipping address. Their `guestToken` is the order ID with an HMAC signature, so a retry can return the same link without storing it. Changing `JWT_SECRET` invalidates these links.
- Tax is calculated per line and on shipping. `TAX_RATE_PERCENT` and `PRICES_INCLUDE_TAX` set it, and both are saved on each order.

## Reports

- `/api/reports` is for admins only, and reads the amounts saved on each order. A change to the tax rate or a product's price never changes past figures, and the summary splits tax by the rate each order was placed with.
- Days, weeks, and months follow Manila time, as the store only ships within the Philippines. Ranges include both dates and default to the last 30 days.
- Gross sales are orders placed in the range, apart from cancelled ones. Collected counts payments by `paid_at`, and refunds against the period the payment arrived in, as no refund date is stored.
- Orders paid before `paid_at` existed took their `updated_at` as a best guess.
- Reports are aggregated on each request, as a store this size needs no caching. `orders.created_at` and `orders.paid_at` are indexed for date ranges, and a daily chart covers up to 366 days.

## Audit Logs

- `audit_logs` records admin changes, and password, session, and role changes. Customer carts, addresses, and checkouts are left to the request logs.
- Services call `recordAudit` inside the transaction that makes the change, so an entry is kept only if the change is. Rows changed by admins are locked first, so the values before are accurate.
- The actor and `requestId` come from the request context, so services do not pass them. Scripts have no actor.
- `changes` holds each changed field as `[before, after]`. `accountNumber` and `passwordHash` are replaced with `[redacted]`.
- `migrate.ts` revokes `UPDATE` and `DELETE` on `audit_logs` from the API's role, so history can only be added to.
- Role changes are recorded by role name, from both the API and `db:set-role`.

## Addresses

- Addresses are limited to the Philippines, so there is no country column.
- Each user can save up to 20 addresses, and has one default while they have any. A partial unique index enforces the single default.
- Changes that affect the default or the limit lock the user's row, so parallel requests run in turn.
- Addresses are deleted outright. Orders must copy the address, so that editing or deleting one never changes a past order.
- Another user's address returns `404`, so that IDs cannot be probed.

## Assets

- `assets` is the central table for uploaded files. Other tables reference it with foreign keys, which block deleting a file that is in use.
- Uploads go to memory first and are limited to 5 MB. Types are detected from the file's bytes, and only JPEG, PNG, and WebP are accepted.
- Files use random names. Only the path is stored, and URLs are built when responses are sent.
- `src/lib/storage.ts` holds all file access. It uses S3 when `S3_BUCKET` is set, and otherwise writes to disk and serves files at `/uploads`.
- `env.ts` rejects a partial S3 setup at startup, so that uploads never fall back to disk by accident.
- A product has up to 10 rows in `product_images`, which hold the alt text and position. A variant's `asset_id` has a composite foreign key to `product_images`, which keeps the image on the same product and blocks removing it while in use.
- Cart and order items use the variant's image, then the product's first image. Order items also block deleting the asset.
- Blogs have an optional cover image, and categories an optional image, each referencing `assets`.

## Logging

- `src/lib/logger.ts` writes JSON to standard output with Pino, and Docker rotates it. Each line names its environment. Redaction is a safety net, and sensitive values should not reach the logger.
- `src/lib/request-context.ts` uses `AsyncLocalStorage` to carry a `requestId`, the `userId`, and recent steps through a request, so nothing has to pass them around. Timers call `runWithContext` to get their own ID.
- `requestLogger` runs first, creates the context, and logs each request. It drops query strings and masks guest links.
- `recordStep` notes progress. Steps stay out of normal logs, and the error handler adds them to errors as `steps` and `lastStep`.
- A client disconnecting fires the `close` event outside the request, so that listener is bound with `AsyncLocalStorage.bind`.
- Expected errors are logged as `warn`, without their details, and unexpected ones as `error`.

## Email

- `src/lib/email.ts` sends email with Nodemailer over SMTP, so changing provider only changes `.env`. It holds the only connection to the mail server.
- Development uses Mailpit, which delivers nothing.
- Logging in to a mail server requires an encrypted connection.
- Recipients and content stay out of the logs, as they can hold personal data and private links.

## Validation

The `validate` middleware checks request bodies, parameters, and query strings against Joi schemas. Unknown fields are rejected.

## Response Format

```jsonc
// Single item
{ "data": {} }

// List
{ "data": [], "meta": { "page": 1, "limit": 20, "total": 0 } }

// Error (details are only present on validation errors and failed checkouts, and requestId on 500 errors)
{ "error": { "message": "Validation failed", "details": [] } }
```

## Error Handling

All application errors are handled through centralized error-handling middleware. Expected errors use `AppError`, and unexpected errors return a generic `500` response without internal details. `toSafeLog` keeps query values out of the logs, as they can include password hashes and personal data.

## Configuration

Application configuration is managed through environment variables, documented in `.env.example`.

`NODE_ENV` controls runtime behaviour, and staging sets it to `production`. `APP_ENV` names the environment as `development`, `staging`, or `production`. It controls Swagger and is added to logs, and it follows `NODE_ENV` when unset. See [deployment.md](deployment.md).

## Testing

API tests live in `tests/` and run with Vitest and Supertest against a disposable database, which `npm test` starts automatically.

## Docker

- `docker-compose.yml` runs the production image and PostgreSQL, and keeps uploads in the `uploads-data` volume.
- `docker-compose.dev.yml` adds the development image, live reload, Adminer, and Mailpit, used by `npm run docker:watch`.
- The API and PostgreSQL are published on `127.0.0.1` only, so that a proxy such as Caddy is the only way in. `POSTGRES_PASSWORD` is required.
- The `db-test` service runs only with the `test` profile.
