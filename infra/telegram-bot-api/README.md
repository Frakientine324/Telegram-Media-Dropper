# Host a large-file Telegram Bot API

This service runs Telegram's official Bot API server in local mode, which allows
uploads up to 2,000 MB. The persistent Docker volume keeps its local state across
container restarts. The Caddy proxy adds HTTPS and Basic Authentication; the Bot
API port itself is not exposed publicly.

## Requirements

- A Linux server with Docker Engine and the Docker Compose plugin.
- A persistent disk with enough free space for the server state and temporary
  files. Leave at least 10 GB free if you plan to send many large files.
- A domain whose DNS A record points to this server, with inbound ports 80 and
  443 open.
- Telegram `api_id` and `api_hash` from <https://my.telegram.org/apps>.

## Configure and start

1. Copy `.env.example` to `.env` on the Linux server. Keep `.env` out of Git.
2. Enter `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, and `TELEGRAM_API_DOMAIN`.
3. Choose a strong Basic Auth username and password. Generate a Caddy password
   hash with:

   ```sh
   docker run --rm -it caddy:2 caddy hash-password
   ```

   Save the hash as `TELEGRAM_API_PASSWORD_HASH` in `.env`. Keep the matching
   plain password available for the Replit API server's Secrets; never put it in
   this repository.
4. Start the service:

   ```sh
   docker compose up -d --build
   ```

5. Check the service logs and confirm that
   `https://TELEGRAM_API_DOMAIN` has a valid TLS certificate.

The Bot API port is only reachable inside the Docker network. Public requests
must pass through Caddy on HTTPS and supply Basic Authentication.

## Connect the Replit API server

After the Linux service is running, configure the Replit API server with:

- `TELEGRAM_BOT_API_BASE_URL` — `https://` plus the configured domain, without
  a trailing slash.
- `TELEGRAM_BOT_API_USERNAME` and `TELEGRAM_BOT_API_PASSWORD` — the Basic Auth
  credentials, saved as Replit Secrets.
- `TELEGRAM_LOCAL_API_MODE` — `true`.
- `TELEGRAM_BOT_API_DATA_DIR` — `/var/lib/telegram-bot-api`, matching this
  Compose configuration.

Do not put these credentials in the Vercel frontend. The Vite app should keep
calling the Replit API server; only that server calls the local Bot API host.

## Important migration step

Telegram requires calling the cloud Bot API `logOut` method before moving the
bot to a local Bot API server. Do this only after the local server and HTTPS
proxy are reachable and you are ready to switch the bot. After `logOut`
succeeds, the bot cannot return to the cloud Bot API for 10 minutes. Do not run
this step from the app or before confirming the host is ready.

## Media previews

In local mode, `getFile` returns an absolute path inside
`/var/lib/telegram-bot-api` instead of a cloud download path. Caddy exposes only
the authenticated `/local-files/` path from that volume so the Replit API can
proxy previews without downloading the file into memory.
