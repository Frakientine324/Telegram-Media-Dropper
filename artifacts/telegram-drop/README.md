# Telegram Drop

## Run locally

From the workspace root:

```sh
pnpm install
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/telegram-drop run dev
```

The Vite page uses the shared `/api` service by default. The Telegram bot token and
destination chat ID belong on the API server only:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Deploy the website to Vercel

The root `vercel.json` builds this Vite app and serves the `/inbox` route. The API
must also be deployed somewhere that supports the app's multipart uploads up to
50 MB per file; Vercel's static site does not host the Express API.

Set `VITE_API_BASE_URL` in the Vercel project to the API server's public origin
(for example, `https://api.example.com`, without a trailing slash or `/api`).
Keep `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` set only on that API server,
never as `VITE_` variables. The API server must allow requests from the Vercel
site's origin.
