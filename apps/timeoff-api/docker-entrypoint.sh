#!/bin/sh
set -e
# Run migrations on every boot (idempotent)
pnpm prisma:deploy
if [ "$ROLE" = "worker" ]; then
  exec node dist/worker.js
else
  exec node dist/main.js
fi
