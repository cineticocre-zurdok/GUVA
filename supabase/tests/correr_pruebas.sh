#!/usr/bin/env bash
# Recrea la base de prueba local y corre todas las migraciones y pruebas.
set -euo pipefail
DB=${1:-guva_test}
cd "$(dirname "$0")/.."
dropdb --if-exists "$DB"; createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/00_stub_supabase.sql
for f in migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
for f in tests/0[1-9]_*.sql; do psql -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
