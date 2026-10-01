#!/bin/sh
# Starts database migrations, the background worker and the web server in one container.
set -e

# Render provides the public address of the service; use it unless APP_URL is set.
if [ -z "$APP_URL" ] && [ -n "$RENDER_EXTERNAL_URL" ]; then
  export APP_URL="$RENDER_EXTERNAL_URL"
fi

npx prisma migrate deploy

# Worker: restarted automatically if it stops.
(
  while true; do
    node --max-old-space-size=160 --conditions=react-server dist/worker.mjs || true
    echo "worker exited; restarting in 5 seconds"
    sleep 5
  done
) &

exec node --max-old-space-size=224 server.js
