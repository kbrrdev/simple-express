# Security

This records the project's known security gaps and what has been decided about them. Update it whenever a gap is found, fixed, or accepted.

The tools used to find problems are described in [security-tools.md](security-tools.md).

## Status

| #   | Gap                                    | Severity      | Status               |
| --- | -------------------------------------- | ------------- | -------------------- |
| 1   | `trust proxy` not configured           | High          | Fixed                |
| 2   | API connected as a database superuser  | High          | Fixed                |
| 3   | Swagger public in production           | Low to Medium | Fixed                |
| 4   | No way to change a password            | High          | Fixed                |
| 5   | No password reset                      | High          | Open, email is ready |
| 6   | Rate limits were IP-only               | Medium        | Fixed, with a note   |
| 7   | No security headers                    | Medium        | Fixed                |
| 8   | Weak passwords allowed                 | Medium        | Fixed                |
| 9   | Stolen-token detection was shallow     | Medium        | Fixed                |
| 10  | No email verification                  | Medium        | Later                |
| 11  | Registration reveals existing emails   | Low           | Later                |
| 12  | Database published with a weak default | Critical      | Fixed                |
| 13  | Stock could be held for free           | High          | Fixed, with a note   |
| 14  | Secrets in error logs                  | High          | Fixed                |
| 15  | Draft blogs were public                | Medium        | Fixed                |
| 16  | Admin login has no second factor       | High          | Open                 |
| 17  | Guest links never expire               | Medium        | Fixed, with a note   |
| 18  | No automatic checks on GitHub          | Medium        | Fixed, with a note   |
| 19  | Large order totals failed              | Low           | Fixed                |
| 20  | API published on all addresses         | Medium        | Fixed                |

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

### 12. Database published with a weak default

PostgreSQL was published on all network addresses, with a default password of `postgres`, and Docker can bypass firewall rules. It is now bound to `127.0.0.1`, and `POSTGRES_PASSWORD` is required.

### 13. Stock could be held for free

A guest could reserve large quantities without paying, then submit a fake reference so the order never expired.

- One customer or guest email can have `MAX_OPEN_UNPAID_ORDERS` unpaid orders open, 5 by default.
- A guest order can have up to 10 items.
- Guest checkout is limited to 10 requests per hour per IP address.

**Remaining limitation:** someone with many IP addresses and email addresses can still hold stock, and orders with a submitted reference wait for an admin. Review `GET /api/orders/admin?paymentStatus=submitted` often.

### 14. Secrets in error logs

Failed queries logged their values, including password hashes and emails. `toSafeLog` now logs the query text and the kind of failure only.

### 15. Draft blogs were public

Unpublished blogs could be read through the list and by ID. Public routes now return published blogs only, and admins read drafts through `/api/blogs/admin`.

### 17. Guest links never expire

Finished orders now hide the shipping address from their link, so an old link stops exposing it. An open order still shows it, as the guest needs it.

**Remaining limitation:** links still show the order itself, and do not expire.

### 18. No automatic checks on GitHub

`.github/workflows/ci.yml` runs on pull requests, and `.github/dependabot.yml` checks dependencies weekly.

**Remaining step:** CodeQL, secret scanning, and push protection are turned on in the repository's settings, as described in [security-tools.md](security-tools.md).

### 19. Large order totals failed

Order amounts now use `bigint`, as a total above about 21 million pesos overflowed a 32-bit integer.

### 20. API published on all addresses

The API could be reached directly, skipping the proxy and HTTPS, as Docker can bypass firewall rules. It is now bound to `127.0.0.1`, so a proxy such as Caddy is the only way in. This also protects rate limits, which trust the proxy's forwarded IP address.

## Open

### 16. Admin login has no second factor

**Risk:** a stolen admin password gives full control of products, orders, and customer data.

**Plan:** add two-factor login for admins. Until then, use a long, unique password, and only make admins who need it.

### 5. No password reset

**Risk:** a forgotten password locks the customer out for good.

**Plan:** email a random, single-use token that expires in about 30 minutes, and store only its hash. Using it revokes all sessions. Send it with `sendEmail` from `src/lib/email.ts`, which uses Mailpit in development.

## Later

### 10. No email verification

**Risk:** anyone can register with another person's email. This matters most if guest orders are ever linked to accounts.

**Plan:** send a verification link, and require it before checkout.

### 11. Registration reveals existing emails

**Risk:** the `409` response shows whether an email has an account. Registration is rate limited, which slows this down.

**Plan:** always return the same response, and send an email to explain. Until this is built, it is an accepted risk.

## Ready to Build with Email

Email is set up with `sendEmail` in `src/lib/email.ts`, Mailpit in development, and a provider set in [deployment.md](deployment.md). These can now be built:

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
- **Manual payments:** always confirm a payment in the GCash or bank app itself, never from a reference or screenshot alone.
- **Staging:** it serves Swagger, so it must stay private. Each environment has its own secrets and data, as described in [deployment.md](deployment.md).
- **Traffic floods:** these are handled in front of the API, such as by a free Cloudflare plan, not in the API.

- **Row Level Security:** not used. The API is the only client of the database, and queries are scoped to the user in the service layer. Reconsider it if anything else connects directly.
