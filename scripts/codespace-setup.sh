#!/usr/bin/env bash
# Runs once when the codespace is created: installs dependencies, writes .env, prepares the database.
set -euo pipefail
cd "$(dirname "$0")/.."

npm ci

if [ ! -f .env ]; then
  cp .env.example .env
  secret() { node -e "console.log(require('crypto').randomBytes($1).toString('base64'))"; }
  # Inside the dev container the services are reached by their compose names.
  sed -i \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=\"postgresql://whatsflow:whatsflow@postgres:5432/whatsflow\"|" \
    -e "s|^REDIS_URL=.*|REDIS_URL=\"redis://redis:6379\"|" \
    -e "s|^SMTP_HOST=.*|SMTP_HOST=\"mailpit\"|" \
    -e "s|^AUTH_SECRET=.*|AUTH_SECRET=\"$(secret 48)\"|" \
    -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=\"$(secret 32)\"|" \
    -e "s|^TEST_DATABASE_URL=.*|TEST_DATABASE_URL=\"postgresql://whatsflow:whatsflow@postgres:5432/whatsflow_test\"|" \
    -e "s|^E2E_DATABASE_URL=.*|E2E_DATABASE_URL=\"postgresql://whatsflow:whatsflow@postgres:5432/whatsflow_e2e\"|" \
    .env
  echo "Created .env with generated secrets."
fi

# The database container may still be starting.
for i in $(seq 1 30); do
  npx prisma migrate deploy && break
  echo "Waiting for the database..."; sleep 2
done

echo
echo "Setup finished. Start the app with:  npm run codespace"
