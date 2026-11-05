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
Global Middleware (CORS, JSON and cookie parsing)
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

Shared OpenAPI definitions, combined with each module's documentation and served by Swagger UI.

### lib/

Shared utilities, including the `AppError` class.

### middleware/

Shared Express middleware for authentication, request validation, and error handling.

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

| Path              | Description                   |
| ----------------- | ----------------------------- |
| `/health`         | API and database health check |
| `/api-docs`       | Swagger UI                    |
| `/api-docs.json`  | OpenAPI document              |
| `/api/addresses`  | Addresses module              |
| `/api/auth`       | Auth module                   |
| `/api/blogs`      | Blogs module                  |
| `/api/cart`       | Cart module                   |
| `/api/categories` | Categories module             |
| `/api/products`   | Products module               |

## Database

- PostgreSQL is the primary database.
- Drizzle ORM handles database queries.
- Drizzle Kit generates migrations into `drizzle/`.
- Each module defines its tables in `<name>.schema.ts`, exported through `src/db/schema.ts`.
- Docker applies pending migrations when the API container starts. Outside Docker, run `npm run db:migrate`.

## Authentication

- Access tokens are JWTs valid for 15 minutes, signed with `JWT_SECRET`, and sent as bearer tokens.
- Refresh tokens are random values valid for 30 days. Only their SHA-256 hashes are stored.
- Each login creates a row in `sessions`, and the session ID is included in the access token.
- The `requireAuth` middleware checks the session on every protected request, so revoking a session takes effect immediately.
- Refresh tokens rotate on each use. Reusing an old token after a 30-second grace period revokes the session.
- Web clients receive the refresh token as an `httpOnly` cookie, and native clients receive it in the response body.
- Users are a `customer` or an `admin`. `requireAuth` reads the role from the database on every request, so role changes apply immediately. `requireAdmin` runs after it and returns `403` for non-admins.
- Roles can only be changed with the `db:make-admin` script, not through the API.
- Passwords are hashed with Argon2id using Node's built-in `crypto` module.
- Login, registration, and token refresh are rate limited per IP address.

## Blogs

Blogs are public to read. Only admins can create, update, and delete them.

## Products

- Each product belongs to one category, and a category cannot be deleted while products use it.
- A product has zero to two options, named per product in `option1_name` and `option2_name`, such as Size and Color.
- Each product has at least one row in `product_variants`, which holds the option values, price, and stock. A product with no options has one variant with no values.
- Prices are stored as integer cents.
- Option values must match the product's options, and each combination is unique within a product. Options can be renamed, but not added or removed after creation.
- Products and variants are deactivated instead of deleted, so that future orders can keep referencing them.
- Public routes only return active products that have an active variant, and only their active variants.

## Cart

- `cart_items` holds one row per user and variant, so each user has one cart.
- Prices are never stored in the cart. They are read from the variant on each request.
- Carts do not reserve stock. Stock is checked when items are added, and must be checked again at checkout.
- Adding to the cart checks the quantity limit inside the upsert, so parallel requests cannot exceed it.
- Guest carts are kept by the client. `POST /api/cart/preview` prices them, and `POST /api/cart/merge` moves them into the user's cart after login, keeping the higher quantity for items in both.

## Addresses

- Addresses are limited to the Philippines, so there is no country column.
- Each user can save up to 20 addresses, and has one default while they have any. A partial unique index enforces the single default.
- Changes that affect the default or the limit lock the user's row, so parallel requests run in turn.
- Addresses are deleted outright. Orders must copy the address, so that editing or deleting one never changes a past order.
- Another user's address returns `404`, so that IDs cannot be probed.

## Validation

The `validate` middleware checks request bodies, parameters, and query strings against Joi schemas. Unknown fields are rejected.

## Response Format

```jsonc
// Single item
{ "data": {} }

// List
{ "data": [], "meta": { "page": 1, "limit": 20, "total": 0 } }

// Error (details are only present on validation errors)
{ "error": { "message": "Validation failed", "details": [] } }
```

## Error Handling

All application errors are handled through centralized error-handling middleware. Expected errors use `AppError`, and unexpected errors return a generic `500` response without internal details.

## Configuration

Application configuration is managed through environment variables, documented in `.env.example`.

## Testing

API tests live in `tests/` and run with Vitest and Supertest against a disposable database, which `npm test` starts automatically.

## Docker

- `docker-compose.yml` runs the production image and PostgreSQL.
- `docker-compose.dev.yml` adds the development image, live reload, and Adminer, used by `npm run docker:watch`.
- PostgreSQL is published on host port `5433` by default.
- The `db-test` service runs only with the `test` profile.
