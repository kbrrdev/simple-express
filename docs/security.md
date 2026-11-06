# Security

This records the project's known security gaps and what has been decided about them. Update it whenever a gap is found, fixed, or accepted.

The tools used to find problems are described in [security-tools.md](security-tools.md).

## Status

| #   | Gap                                   | Severity      | Status             |
| --- | ------------------------------------- | ------------- | ------------------ |
| 1   | `trust proxy` not configured          | High          | Fixed              |
| 2   | API connected as a database superuser | High          | Fixed              |
| 3   | Swagger public in production          | Low to Medium | Fixed              |
| 4   | No way to change a password           | High          | Fixed              |
| 5   | No password reset                     | High          | Open, needs email  |
| 6   | Rate limits were IP-only              | Medium        | Fixed, with a note |
| 7   | No security headers                   | Medium        | Fixed              |
| 8   | Weak passwords allowed                | Medium        | Fixed              |
| 9   | Stolen-token detection was shallow    | Medium        | Fixed              |
| 10  | No email verification                 | Medium        | Later, needs email |
| 11  | Registration reveals existing emails  | Low           | Later, needs email |

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

### 4. No way to change a password

`POST /api/auth/change-password` checks the current password, keeps the current session, and revokes the others, in case the password was changed because of a leak. It shares the login rate limit, and a wrong current password returns `400`, so clients do not treat it as an expired session.

### 6. Rate limits were IP-only

Failed logins are now tracked per email in `login_attempts`, so an attacker using many IP addresses is still slowed down.

- After five failures, the email is delayed for 30 seconds, doubling up to five minutes. A hard lockout would let anyone lock a customer out on purpose.
- Unknown emails are tracked the same way, so that delays do not reveal which accounts exist.
- A quiet 15 minutes clears the record.

**Remaining limitations:**

- Anyone who knows an email can still delay that person's login by up to five minutes at a time.
- The IP limits stay in memory, so they reset on restart and are not shared between servers. The per-email limit is in PostgreSQL, and covers password guessing in both cases.

### 7. No security headers

`helmet` now sets the headers on every response. A ZAP scan had reported `X-Content-Type-Options` as missing, and the next scan reported no warnings or failures. Neither scan used a token, so they did not reach protected routes.

- `Cross-Origin-Resource-Policy` is set to `cross-origin`, so that storefronts on other origins can show uploaded images.
- `upgrade-insecure-requests` is removed, as it breaks Swagger UI over plain HTTP in development.

### 8. Weak passwords allowed

New passwords are checked against `src/modules/auth/common-passwords.ts`, which holds the entries of 8 or more characters from the SecLists 10k-most-common list, ignoring case. Existing accounts can still log in with their current password.

### 9. Stolen-token detection was shallow

Only the most recent old refresh token used to be remembered. Each token now holds its session ID and an HMAC signature, so any correctly signed token that is no longer current proves reuse, however old it is, and revokes that session. This needs no token history.

- The signature means a made-up token is rejected without touching the session, even if its session ID is known.
- The token just replaced is still accepted for 30 seconds, for retries and parallel tabs. A token stolen and used inside that window can still work.
- Sessions created before this change must log in again.

## Open

### 5. No password reset

**Risk:** a forgotten password locks the customer out for good.

**Plan:** email a random, single-use token that expires in about 30 minutes, and store only its hash. Using it revokes all sessions. Add Mailpit to `docker-compose.dev.yml` at the same time, so that development emails are caught locally, and use a real email provider in production.

## Later

### 10. No email verification

**Risk:** anyone can register with another person's email. This matters most if guest orders are ever linked to accounts.

**Plan:** send a verification link, and require it before checkout.

### 11. Registration reveals existing emails

**Risk:** the `409` response shows whether an email has an account. Registration is rate limited, which slows this down.

**Plan:** always return the same response, and send an email to explain. Until email exists, this is an accepted risk.

## Waiting on Email

These need an email service. Use Mailpit in development and a real provider in production.

- Password reset (gap 5)
- Email verification (gap 10)
- Hiding whether an email is registered (gap 11)
- Sending guests their private order link
- Claiming past guest orders after verifying an email
- Order confirmation and status update emails
- Manual payment instructions and payment confirmed emails
- Security notices, such as password changed or session revoked

## Decisions

- **Guest orders:** guests cannot use COD, as anonymous orders invite fake ones. Guest checkout has its own rate limit per IP address.
- **Guest order links:** the link is the only access to a guest order, so it is sent with `Cache-Control: no-store`. Changing `JWT_SECRET` invalidates all of them.

- **Row Level Security:** not used. The API is the only client of the database, and queries are scoped to the user in the service layer. Reconsider it if anything else connects directly.
