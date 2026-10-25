#!/usr/bin/env bash
# LOCAL ONLY: drops and recreates the local dev database, applies migrations, seeds the demo workspace.
set -euo pipefail
DB_URL="${DATABASE_URL:-postgres://growth:growth@localhost:5432/growth_os}"
DB_NAME="${DB_URL##*/}"
ADMIN_URL="${DB_URL%/*}/postgres"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "drop database if exists \"$DB_NAME\" with (force)" -c "create database \"$DB_NAME\""
DATABASE_URL="$DB_URL" npx tsx scripts/migrate.ts
DATABASE_URL="$DB_URL" npx tsx scripts/seed-demo.ts
