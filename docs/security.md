# Security

This records the project's known security gaps and what has been decided about them. Update it whenever a gap is found, fixed, or accepted.

The tools used to find problems are described in [security-tools.md](security-tools.md).

## Status

| #   | Gap                                   | Severity      | Status                     |
| --- | ------------------------------------- | ------------- | -------------------------- |
| 1   | `trust proxy` not configured          | High          | Fixed                      |
| 2   | API connected as a database superuser | High          | Fixed                      |
| 3   | Swagger public in production          | Low to Medium | Fixed                      |
| 4   | No way to change a password           | High          | Fix soon                   |
| 5   | No password reset                     | High          | Fix soon, needs email      |
| 6   | Rate limits are IP-only and in memory | Medium        | Fix soon                   |
| 7   | No security headers                   | Medium        | Fix soon                   |
| 8   | Weak passwords allowed                | Medium        | Fix soon                   |
| 9   | Stolen-token detection is shallow     | Medium        | Fix soon, design to decide |
| 10  | No email verification                 | Medium        | Later, needs email         |
| 11  | Registration reveals existing emails  | Low           | Later, needs email         |

## Fixed

### 1. `trust proxy` not configured

Behind a proxy, Express sees every customer as the proxy's IP address, so the login rate limit would be shared by the whole store.

Set `TRUST_PROXY_HOPS` to the number of proxies in front of the API. It defaults to `0`, which ignores `X-Forwarded-For`. Never set it higher than the real number, as clients could then fake their IP address and dodge rate limits.

### 2. API connected as a database superuser

If SQL injection or a credential leak ever happened, a superuser could read or destroy everything.

- `DATABASE_URL` now uses a limited role, which can only read and write rows.
- `MIGRATION_DATABASE_URL` uses the owner role, and is only needed to run migrations.
- `npm run db:migrate` creates or updates the limited role, using the username and password in `DATABASE_URL`, and grants it access to every table.
- Docker removes `MIGRATION_DATABASE_URL` from the API's environment after migrations finish.

### 3. Swagger public in production

Swagger UI and `/api-docs.json` are only served when `NODE_ENV` is not `production`. The API's routes were already protected, so this only removes a map of the API.

Use [postman-collection.json](postman-collection.json) to call the API. It does not depend on Swagger being served.

## Fix Soon

### 4. No way to change a password

**Risk:** a customer who suspects a leak has no way to act.

**Plan:** add `POST /api/auth/change-password`, which checks the current password and revokes the user's other sessions. This does not need email.

### 5. No password reset

**Risk:** a forgotten password locks the customer out for good.

**Plan:** email a random, single-use token that expires in about 30 minutes, and store only its hash. Using it revokes all sessions. Add Mailpit to `docker-compose.dev.yml` at the same time, so that development emails are caught locally, and use a real email provider in production.

### 6. Rate limits are IP-only and in memory

**Risk:** an attacker with many IP addresses can keep guessing one account's password. Limits also reset on restart, and are not shared between servers.

**Plan:** also limit by email, and keep attempts in PostgreSQL. Use short delays instead of a hard lockout, which would let anyone lock a customer out on purpose.

### 7. No security headers

**Risk:** browsers do not get protections such as forcing HTTPS and blocking MIME-type guessing.

A ZAP scan confirmed this, reporting `X-Content-Type-Options` as missing. It was the scan's only warning, with no failures. That scan did not use a token, so it did not reach protected routes.

**Plan:** add `helmet`, and check that Swagger UI still works in development.

### 8. Weak passwords allowed

**Risk:** `password1` and `12345678` pass validation, and are the first values attackers try.

**Plan:** block common passwords with a bundled list. Avoid rules that force symbols, as NIST guidance favours blocklists over them.

### 9. Stolen-token detection is shallow

**Risk:** only the most recent old refresh token is remembered. Replaying an older one returns `401`, so it gives no access, but the session is not revoked, so the warning is lost. A stolen token used within the 30-second grace period can still work.

**Plan:** to be decided. The recommended option needs no storage: put the session ID inside the refresh token, so that any token for a session that does not match its current hash proves reuse. Existing sessions would need to log in again.

## Later

### 10. No email verification

**Risk:** anyone can register with another person's email. This matters most if guest orders are ever linked to accounts.

**Plan:** send a verification link, and require it before checkout.

### 11. Registration reveals existing emails

**Risk:** the `409` response shows whether an email has an account. Registration is rate limited, which slows this down.

**Plan:** always return the same response, and send an email to explain. Until email exists, this is an accepted risk.

## Decisions

- **Row Level Security:** not used. The API is the only client of the database, and queries are scoped to the user in the service layer. Reconsider it if anything else connects directly.
