# Security Tools

This explains the tools for checking this project, what each one is for, and how to set it up and use it. Known gaps and decisions are recorded in [security.md](security.md).

Each tool finds different problems, so they work best together.

| Tool                                          | Finds                                           | Runs             | Cost                                    | Status      |
| --------------------------------------------- | ----------------------------------------------- | ---------------- | --------------------------------------- | ----------- |
| [CodeQL](#codeql-github-code-scanning)        | Risky patterns in the source code               | On GitHub        | Free for public repos                   | Recommended |
| [Secret scanning](#secret-scanning)           | Passwords and keys in commits                   | On GitHub        | Free for public repos                   | Recommended |
| [Dependabot](#dependabot)                     | Vulnerable packages and images                  | On GitHub        | Free                                    | Recommended |
| [CI checks](#ci-checks)                       | Failing tests, lint errors, vulnerable packages | On GitHub        | Free within GitHub Actions limits       | Recommended |
| [ZAP](#zap)                                   | Problems in the running API                     | On your machine  | Free and open source                    | Recommended |
| [Burp Suite Community](#burp-suite-community) | Logic flaws, by hand                            | On your machine  | Community is free, Professional is paid | Optional    |
| [Snyk](#snyk)                                 | Code, packages, and images                      | Cloud or locally | Free tier with monthly limits           | Not needed  |

Pricing and limits change, so check each provider's site before relying on them. These tools rarely catch ecommerce logic flaws, such as changing a price or reaching another customer's order. Tests in `tests/` are the main protection against those.

## CodeQL (GitHub Code Scanning)

**What it is for:** reading the source code without running it, to find problems such as injection and unsafe data flows.

**How to implement:**

1. Open the repository on GitHub, then **Settings**, then **Advanced Security** (or **Code security**).
2. Under **Code scanning**, set up **CodeQL analysis**.
3. Choose **Default**. No files are needed.

**Usage:** scans run on pushes and pull requests. Results appear under the repository's **Security** tab, and as comments on pull requests. Open each alert, fix it or dismiss it with a reason.

**Limit:** on a free GitHub plan, this only works on public repositories.

## Secret Scanning

**What it is for:** finding passwords and API keys committed by mistake. Push protection blocks them before they reach GitHub.

**How to implement:** on the same settings page, turn on **Secret scanning** and **Push protection**.

**Usage:** if a push is blocked, remove the secret from the commit instead of bypassing the block. If a secret ever reaches GitHub, treat it as leaked and replace it, as deleting the commit is not enough.

## Dependabot

**What it is for:** warning about known vulnerabilities in packages, and opening pull requests to update them.

**How to implement:** updates are set up in [`.github/dependabot.yml`](../.github/dependabot.yml). Also turn on **Dependabot alerts** on the same settings page.

**Usage:** review the pull requests it opens, and merge them when the checks pass. Close major updates to Node.js, TypeScript, and `@types/node`, as those are upgraded on purpose, together with the Dockerfile and CI. Alerts appear under the **Security** tab.

## CI Checks

**What it is for:** running the project's checks on every pull request, so that broken or vulnerable code is not merged unnoticed.

**How to implement:** already set up in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). `docker-compose.yml` needs `JWT_SECRET`, `APP_DB_PASSWORD`, and `POSTGRES_PASSWORD` even to start the test database, so the workflow sets test-only values.

**Usage:** results appear on each pull request. To block merging until they pass, add a branch protection rule for `main` under **Settings**, then **Branches**.

To run the same audit locally:

```bash
npm audit --omit=dev
```

## ZAP

**What it is for:** attacking the running API from outside, by sending bad input and looking for injection, missing headers, and leaked errors. CodeQL reads the code, while ZAP tests how it behaves.

**How to implement:** it runs from Docker, so nothing needs installing.

Only scan systems you own. ZAP submits junk data and, with an admin token, can delete records, so never point it at a database you care about. These steps use a separate stack and remove it afterwards.

**Usage:**

1. Save the OpenAPI document. Production does not serve it, so get it from the development stack:

   ```powershell
   curl.exe -s http://localhost:3000/api-docs.json -o openapi.json
   ```

2. Start a separate production stack on port `3001`:

   ```powershell
   $env:PORT = '3001'; $env:POSTGRES_PORT = '5435'
   docker compose -p zap-scan up -d --build --wait
   ```

3. Run the scan:

   ```powershell
   docker run --rm -v "${PWD}:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable `
     zap-api-scan.py -t openapi.json -f openapi -O http://host.docker.internal:3001 -r zap-report.html
   ```

4. Open `zap-report.html`, then remove the stack and the temporary files:

   ```powershell
   docker compose -p zap-scan down -v
   Remove-Item openapi.json, zap-report.html
   Remove-Item Env:PORT, Env:POSTGRES_PORT
   ```

**Reading the results:**

- Exit code `0` means no warnings, `1` means failures, and `2` means warnings.
- `429` responses are the rate limits working.
- Some findings will be false alarms, so check each one before acting on it.
- Without a token, ZAP only reaches public routes and `401` responses on protected ones. To cover them, add this to the scan, using a fresh access token, which lasts 15 minutes:

  ```text
  -z "-config replacer.full_list(0).description=auth -config replacer.full_list(0).enabled=true -config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Authorization -config replacer.full_list(0).regex=false -config replacer.full_list(0).replacement=Bearer\ YOUR_TOKEN"
  ```

## Burp Suite Community

**What it is for:** pausing, editing, and resending requests by hand. It suits logic flaws that scanners miss.

**How to implement:** install it from PortSwigger, and start a temporary project.

**Usage:**

1. Point your API client's proxy at `127.0.0.1:8080`. In Postman, this is under **Settings**, then **Proxy**.
2. Send a request, and find it under **Proxy**, then **HTTP history**.
3. Send it to **Repeater**, edit it, and resend it.

**What to try:**

- Replace an ID with one belonging to another customer.
- Use a customer's token on an admin route.
- Send a negative quantity, or a very large one.
- Add fields the API should reject, such as `role` or `priceCents`.
- Once orders exist, try to change a price at checkout, or pay for less than the total.

## Snyk

**What it is for:** scanning code, packages, and Docker images. It overlaps with CodeQL and Dependabot, so it is not needed here unless the repository becomes private.

**How to implement:** create a free account, then log in:

```bash
npx snyk auth
```

**Usage:**

```bash
npx snyk test
npx snyk code test
```

The free tier limits tests per month, so check the current limits first.
