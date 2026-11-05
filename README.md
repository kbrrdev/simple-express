# Simple Express Boilerplate

A simple and maintainable backend boilerplate built with **Express 5, TypeScript, Drizzle ORM, PostgreSQL, Joi, and Docker**.

Includes a sample Blogs CRUD API to demonstrate the project's structure and development patterns.

## Tech Stack

- **Runtime:** Node.js 24.7+
- **Framework:** Express 5
- **Language:** TypeScript
- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **Validation:** Joi
- **API Documentation:** Swagger / OpenAPI
- **Containerization:** Docker and Docker Compose
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

Update the other environment variables as needed.

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

| Script | Description |
|---|---|
| `npm run dev` | Start development server with automatic reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled application |
| `npm run typecheck` | Type-check without emitting files |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Automatically fix ESLint issues |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check code formatting |
| `npm run db:generate` | Generate migrations from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run db:make-admin -- <email>` | Make an existing user an admin |
| `npm run docker:watch` | Run Docker development environment with live reload |
| `npm run docker:down` | Stop Docker development containers |
| `npm run test:db` | Start the disposable test database |
| `npm test` | Start the test database and run the test suite |

## API Documentation

API documentation is provided through Swagger UI using the OpenAPI specification.

With the API running, open the interactive documentation at:

`http://localhost:3000/api-docs`

The raw OpenAPI document is available at `http://localhost:3000/api-docs.json`.

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
    ├── auth/
    ├── blogs/
    ├── cart/
    ├── categories/
    └── products/

drizzle/
tests/
AGENTS.md
README.md
```

### Directory Responsibilities

| Directory | Responsibility |
|---|---|
| `config/` | Application configuration and environment validation |
| `db/` | Database connection, schemas, and migration runner |
| `docs/` | Shared OpenAPI definitions served by Swagger UI |
| `lib/` | Shared application utilities and error classes |
| `middleware/` | Express middleware |
| `routes/` | Central route registration |
| `modules/` | Feature-based application modules |
| `drizzle/` | Generated SQL migrations |
| `tests/` | API tests |

## Architecture

The project follows a simple feature-based modular structure.

Each feature keeps its routes, controllers, services, and validation schemas together when needed.

### Request Flow

```text
Client
  |
  v
Express Middleware
  |
  v
Routes
  |
  v
Request Validation
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

## Adding a New Module

Use the existing Blogs module as a reference.

1. Create a new folder under `src/modules/`.
2. Add only the necessary files for the feature.
3. Export database tables from `src/db/schema.ts`.
4. Generate a migration using `npm run db:generate`.
5. Apply the migration using `npm run db:migrate`.
6. Register the module routes in `src/routes/index.ts`.
7. Document the endpoints in `<name>.openapi.ts` and add its exports to `src/docs/openapi.ts`.

## Viewing the Database

You can browse the development database in a web browser with either tool. Both are free.

**Drizzle Studio** needs the database running. Start it, then open <https://local.drizzle.studio>:

```bash
npm run db:studio
```

The command runs on your host and connects using `DATABASE_URL` from `.env`. The page loads from Drizzle's website, but your data stays on your machine.

**Adminer** starts with `npm run docker:watch` at <http://localhost:8081>. Log in with:

| Field | Value |
|---|---|
| System | PostgreSQL |
| Server | `db` |
| Username | `POSTGRES_USER` from `.env` |
| Password | `POSTGRES_PASSWORD` from `.env` |
| Database | `POSTGRES_DB` from `.env` |

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

| Endpoint | Description | Requires access token |
|---|---|---|
| `POST /api/auth/register` | Create a user | No |
| `POST /api/auth/login` | Start a session | No |
| `POST /api/auth/refresh` | Get new tokens | No |
| `POST /api/auth/logout` | End the current session | Yes |
| `POST /api/auth/logout-all` | End all sessions for the user | Yes |
| `GET /api/auth/me` | Get the current user | Yes |

Login requires a `client` value:

- `web`: the refresh token is set as an `httpOnly` cookie. Keep the access token in memory, and call `/api/auth/refresh` with credentials included.
- `native`: the refresh token is returned in the response body. Keep it in secure storage, and send it as `refreshToken` in the body of `/api/auth/refresh`.

Every access token belongs to a session, and the session is checked on each protected request, so logout takes effect immediately. Reusing an old refresh token more than 30 seconds after it was replaced revokes the session.

To protect a route, add the `requireAuth` middleware. The current user is then available in `res.locals.auth`. Reading blogs is public.

Users are either a `customer` or an `admin`, and new users are always customers. To restrict a route to admins, add `requireAdmin` after `requireAuth`.

There is no API for changing roles. Register the user, then promote them from the command line:

```bash
npm run db:make-admin -- jane@example.com
```

In the production container, run `docker compose exec api node dist/db/make-admin.js jane@example.com`.

## Blogs

Blogs are public to read. Any logged-in user can create one and becomes its owner. Customers can update and delete their own blogs, and admins can update and delete any blog.

To let only admins write blogs, set this in `.env`:

```bash
BLOG_CUSTOMER_WRITES_ENABLED=false
```

Customers then cannot create, update, or delete blogs, including ones they already own. Blogs created before ownership was added have no owner, so only admins can change them.

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

| Endpoint | Description | Access |
|---|---|---|
| `GET /api/categories` | List categories | Public |
| `GET /api/categories/:id` | Get a category | Public |
| `POST /api/categories` | Create a category | Admin |
| `PATCH /api/categories/:id` | Rename a category | Admin |
| `DELETE /api/categories/:id` | Delete a category with no products | Admin |
| `GET /api/products` | List products on sale | Public |
| `GET /api/products/:id` | Get a product on sale | Public |
| `GET /api/products/admin` | List all products, including inactive ones | Admin |
| `POST /api/products` | Create a product and its variants | Admin |
| `PATCH /api/products/:id` | Update a product | Admin |
| `DELETE /api/products/:id` | Deactivate a product | Admin |
| `POST /api/products/:id/variants` | Add a variant | Admin |
| `PATCH /api/products/:id/variants/:variantId` | Update a variant | Admin |
| `DELETE /api/products/:id/variants/:variantId` | Deactivate a variant | Admin |

Product lists support `page`, `limit`, `search`, `categoryId`, and `sort` (`newest` or `name`).

To restore a deactivated product or variant, set `active` to `true` with `PATCH`.

## Cart

Each logged-in user has one cart, which follows them across devices. Prices are read from the variants each time, so a cart always shows current prices.

| Endpoint | Description | Requires access token |
|---|---|---|
| `GET /api/cart` | Get the cart | Yes |
| `DELETE /api/cart` | Empty the cart | Yes |
| `POST /api/cart/items` | Add a variant, combining with any existing quantity | Yes |
| `PATCH /api/cart/items/:variantId` | Set the quantity of an item | Yes |
| `DELETE /api/cart/items/:variantId` | Remove an item | Yes |
| `POST /api/cart/preview` | Price a guest cart without saving it | No |
| `POST /api/cart/merge` | Move a guest cart into the user's cart | Yes |

An item can have a quantity of up to 99, and adding more than the available stock returns `409`. Carts do not reserve stock, so `stock` can drop below `quantity` after an item is added. Show a warning when it does. Items that are deactivated stay in the cart with `available: false`, and are left out of the subtotal.

### Guest Carts

The API does not store guest carts. The client keeps each item's `variantId` and `quantity` on the device, then:

1. Sends them to `/api/cart/preview` to show current prices.
2. Asks the guest to log in at checkout.
3. Sends them to `/api/cart/merge`, then clears its local copy.

A merge keeps the higher quantity for an item in both carts, so retrying one is safe. Quantities are reduced to the available stock, and unavailable variants are skipped. Both are listed in `adjustments` in the response, so the client can tell the customer.

## Addresses

Logged-in users can save up to 20 delivery addresses in the Philippines. Requesting another user's address returns `404`.

| Endpoint | Description |
|---|---|
| `GET /api/addresses` | List addresses, default first |
| `GET /api/addresses/:id` | Get an address |
| `POST /api/addresses` | Add an address |
| `PATCH /api/addresses/:id` | Update an address |
| `DELETE /api/addresses/:id` | Delete an address |
| `POST /api/addresses/:id/default` | Make an address the default |

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
