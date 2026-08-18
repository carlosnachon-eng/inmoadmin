#!/usr/bin/env bash
set -euo pipefail

: "${FASE1_DEV_DATABASE_URL:?Define FASE1_DEV_DATABASE_URL con la URL de inmoadmin-dev}"
case "$FASE1_DEV_DATABASE_URL" in
  *hjfwjnejbcpmknvfpdcq*) ;;
  *) echo "ABORT: la URL no contiene el project ref DEV autorizado" >&2; exit 1 ;;
esac
case "$FASE1_DEV_DATABASE_URL" in
  *bnzrnizrmonjxlktbhlp*) echo "ABORT: la URL contiene el ref productivo" >&2; exit 1 ;;
esac

psql "$FASE1_DEV_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/dev/seed/202608180003_fase_1_operational_stress_seed.sql
psql "$FASE1_DEV_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/dev/tests/202608180003_fase_1_operational_stress_seed_checks.sql
