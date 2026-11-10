# Deployment

This explains how to run the API on an Ubuntu server, for staging and production. Local development is covered in the [README](../README.md).

## How It Fits Together

```text
Internet → Caddy (HTTPS, ports 80 and 443) → API (127.0.0.1:3000) → PostgreSQL (127.0.0.1)
```

The API and database only listen on `127.0.0.1`, so Caddy is the only way in. Caddy gets and renews HTTPS certificates automatically.

## Environments

All environments use the same Docker image, and only `.env` changes.

| Setting            | Development   | Staging               | Production               |
| ------------------ | ------------- | --------------------- | ------------------------ |
| `NODE_ENV`         | `development` | `production`          | `production`             |
| `APP_ENV`          | `development` | `staging`             | `production`             |
| `LOG_LEVEL`        | `debug`       | `debug`               | `info`                   |
| `TRUST_PROXY_HOPS` | `0`           | `1`                   | `1`                      |
| Log format         | Readable      | JSON                  | JSON                     |
| Swagger            | On            | On                    | Off                      |
| Secure cookies     | Off           | On                    | On                       |
| Files              | Local disk    | Disk or a test bucket | S3 or a backed-up volume |

Staging runs with `NODE_ENV=production`, so that it behaves like production. `APP_ENV` is what tells them apart, and it is added to every log line. If it is not set, it follows `NODE_ENV`, so a production server never exposes Swagger by accident.

Set `TRUST_PROXY_HOPS` to the number of proxies in front of the API. It is `1` with Caddy, and `2` with Cloudflare in front of Caddy.

### Keeping Environments Apart

- Give each environment its own database, `JWT_SECRET`, `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, and storage. A shared `JWT_SECRET` would let a staging token work in production.
- Use made-up data in staging. Never copy production data there, as it holds real names, phones, and addresses.
- Use test payment accounts in staging, so that nobody can send real money while testing.
- Keep staging private, with a password, an IP allowlist, or a private network. It serves Swagger, so it must not be left open.
- Create separate admin accounts for each environment.

## Set Up the Server

Use the current Ubuntu LTS release.

### 1. Secure Access

Log in with an SSH key, then turn off password and root login by setting these in `/etc/ssh/sshd_config`:

```text
PasswordAuthentication no
PermitRootLogin no
```

```bash
sudo systemctl restart ssh
```

### 2. Turn On the Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

Docker can bypass `ufw` for published ports, which is why `docker-compose.yml` binds them to `127.0.0.1`. Do not remove that.

### 3. Turn On Security Updates

```bash
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

### 4. Install Docker and Caddy

Follow the official instructions for [Docker Engine](https://docs.docker.com/engine/install/ubuntu/) and [Caddy](https://caddyserver.com/docs/install#debian-ubuntu-raspbian).

### 5. Configure Caddy

Point your domain at the server, then put this in `/etc/caddy/Caddyfile`:

```text
api.your-store.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

### 6. Configure the App

```bash
git clone https://github.com/kbrrdev/simple-express.git
cd simple-express
cp .env.example .env
chmod 600 .env
```

Fill in `.env`, using a different random value for each secret:

```bash
node -p "require('crypto').randomBytes(24).toString('hex')"
```

The values that matter most:

```bash
NODE_ENV=production
APP_ENV=production
LOG_LEVEL=info
TRUST_PROXY_HOPS=1
PUBLIC_BASE_URL=https://api.your-store.com
CORS_ORIGINS=https://your-store.com
PASSWORD_RESET_URL=https://your-store.com/reset-password
JWT_SECRET=
POSTGRES_PASSWORD=
APP_DB_PASSWORD=
```

Email is optional, and stays off while `SMTP_HOST` is empty. To send real email, set up your domain with a provider such as Brevo, including its SPF and DKIM records, or messages land in spam. Then add its SMTP details:

```bash
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM="Your Store <orders@your-store.com>"
```

To check it works:

```bash
docker compose exec api node dist/lib/send-test-email.js you@example.com
```

In staging, use a test account or send only to your own addresses, so that customers never get test emails.

### 7. Start the API

```bash
docker compose up -d --build
docker compose logs -f api
```

Migrations run when the API starts.

### 8. Create the First Admin

Register a user through the API, then:

```bash
docker compose exec api node dist/db/make-admin.js you@your-store.com
```

Use a long, unique password, as admin logins have no second factor yet.

### 9. Add Payment Methods

Customers can only use COD until an admin adds a method through `POST /api/payment-methods`.

## Deploy an Update

```bash
git pull
docker compose up -d --build
```

Staging deploys from `main`. Production deploys from a release tag:

```bash
git fetch --tags
git checkout v1.0.0
docker compose up -d --build
```

To roll back, check out the previous tag and run the same command. Database migrations do not roll back, so restore from a backup if one must be undone.

## Staging and Production on One Server

Separate servers are safer, as a staging mistake cannot touch production. If you need to share one, give staging its own folder and `.env`, with different ports:

```bash
PORT=3100
POSTGRES_PORT=5533
```

```bash
docker compose -p staging up -d --build
```

Then add a second site to the Caddyfile, pointing at `127.0.0.1:3100`.

## Backups

Neither the database nor the uploads are backed up automatically. Run this nightly with `cron`, and copy the files off the server:

```bash
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "db-$(date +%F).sql.gz"
docker run --rm -v simple-express_uploads-data:/data -v "$PWD":/backup alpine \
  tar czf "/backup/uploads-$(date +%F).tar.gz" -C /data .
```

Skip the second command if you use S3. Test restoring a backup at least once, as an untested backup may not work when you need it.

## Viewing Logs

```bash
docker compose logs -f api
docker compose logs api | grep <requestId>
docker compose logs api | grep <userId>
```

Docker keeps up to 50 MB per container and rotates the rest. Logs stay on the server, so ship them elsewhere if you need a longer history.

## Before Going Live

- [ ] `https://` works, and `http://` redirects to it
- [ ] The API and database cannot be reached directly from another machine
- [ ] `/api-docs` returns `404` in production
- [ ] Every secret is unique to this environment
- [ ] A backup has been restored successfully
- [ ] CodeQL and secret scanning are on, as described in [security-tools.md](security-tools.md)
- [ ] Payment methods show the right account names and numbers
- [ ] Admins have long, unique passwords
