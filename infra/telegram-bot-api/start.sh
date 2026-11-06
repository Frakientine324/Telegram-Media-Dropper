#!/bin/sh
set -eu

: "${TELEGRAM_API_ID:?Set TELEGRAM_API_ID in the host environment}"
: "${TELEGRAM_API_HASH:?Set TELEGRAM_API_HASH in the host environment}"

exec /usr/local/bin/telegram-bot-api \
  --api-id="$TELEGRAM_API_ID" \
  --api-hash="$TELEGRAM_API_HASH" \
  --local \
  --http-ip-address=0.0.0.0 \
  --http-port=8081 \
  --dir=/var/lib/telegram-bot-api \
  --temp-dir=/tmp
