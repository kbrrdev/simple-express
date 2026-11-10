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
| `/api/auth`            | Auth module                   |
| `/api/blogs`           | Blogs module                  |
| `/api/cart`            | Cart module                   |
| `/api/categories`      | Categories module             |
| `/api/orders`          | Orders module                 |
| `/api/payment-methods` | Payment methods module        |
| `/api/products`        | Products module               |

## Database

- PostgreSQL is the primary database.
- Drizzle ORM handles database queries.
- Drizzle Kit generates migrations into `drizzle/`.
- Each module defines its tables in `<name>.schema.ts`, exported through `src/db/schema.ts`.
- Docker applies pending migrations when the API container starts. Outside Docker, run `npm run db:migrate`.
- The API connects with `DATABASE_URL`, a limited role that can read and write rows only. Migrations use `MIGRATION_DATABASE_URL`, and create the limited role and its grants.

## Authentication

- Access tokens are JWTs valid for 15 minutes, signed with `JWT_SECRET`, and sent as bearer tokens.
- Refresh tokens are valid for 30 days, and hold the session ID, a random secret, and an HMAC signature. Only their SHA-256 hashes are stored.
- Each login creates a row in `sessions`, and the session ID is included in the access token.
- The `requireAuth` middleware checks the session on every protected request, so revoking a session takes effect immediately.
- Refresh tokens rotate on each use. A correctly signed token that is no longer current revokes its session, apart from the previous token, which is allowed for 30 seconds. Forged tokens are rejected without touching the session.
- Web clients receive the refresh token as an `httpOnly` cookie, and native clients receive it in the response body.
- Users are a `customer` or an `admin`. `requireAuth` reads the role from the database on every request, so role changes apply immediately. `requireAdmin` runs after it and returns `403` for non-admins.
- Roles can only be changed with the `db:make-admin` script, not through the API.
- Passwords are hashed with Argon2id using Node's built-in `crypto` module.
- New passwords are checked against a bundled list of common passwords. Changing a password keeps the current session and revokes the others.
- Login, registration, password changes, and token refresh are rate limited per IP address, in memory.
- Failed logins are also tracked per email in `login_attempts`, including unknown emails. After five failures, the email is delayed for 30 seconds, doubling up to five minutes.

## Blogs

Published blogs are public to read, and drafts are hidden, including by direct link. Only admins can write blogs or read drafts.

## Products

- Each product belongs to one category, and a category cannot be deleted while products use it.
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
- `markPaid` is the only way an order becomes paid, and is safe to repeat, so a future webhook can use it. `calculateShipping` is the only place that sets the fee.
- Manual orders start as `awaiting_payment`, and a row in `payments` records the reference. The unique provider and reference stop a payment being counted twice.
- Orders copy the provider, account name, account number, and QR of the `payment_methods` row they were placed with. The QR has a foreign key, so a file an unpaid order still shows cannot be deleted.
- `expireUnpaidOrders` runs every 5 minutes from `index.ts`. It uses `FOR UPDATE SKIP LOCKED`, so several servers can run it safely, and it skips orders with a submitted reference.
- Guest orders have a `guest_email` and no `user_id`, and are never linked to accounts. Their links do not expire, so finished orders hide the shipping address. Their `guestToken` is the order ID with an HMAC signature, so a retry can return the same link without storing it. Changing `JWT_SECRET` invalidates these links.
- Tax is calculated per line and on shipping. `TAX_RATE_PERCENT` and `PRICES_INCLUDE_TAX` set it, and both are saved on each order.

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
