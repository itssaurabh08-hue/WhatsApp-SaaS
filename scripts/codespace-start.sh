#!/usr/bin/env bash
# Builds and starts the app (port 3000) and the background worker in a codespace.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${CODESPACE_NAME:-}" ]; then
  export APP_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
fi
echo "App address: ${APP_URL:-http://localhost:3000}"

npx prisma migrate deploy
npm run build

npm run worker &
WORKER_PID=$!
trap 'kill $WORKER_PID 2>/dev/null' EXIT

echo
echo "Open: ${APP_URL:-http://localhost:3000}    Emails: Ports tab > Emails (8025)"
npx next start -p 3000
