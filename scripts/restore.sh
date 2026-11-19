#!/usr/bin/env bash
# Beauty Salon OS 数据库恢复：把 backup.sh 的 .dump 恢复到目标库（会覆盖目标库同名对象）
# 用法：DATABASE_URL=postgres://... ./scripts/restore.sh backups/salon-YYYYMMDD-HHMMSS.dump
set -euo pipefail

DUMP="${1:?用法: restore.sh <dump文件>}"
if [ -n "${DATABASE_URL:-}" ]; then
  pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" "$DUMP"
else
  docker compose -f infra/docker-compose.yml exec -T postgres \
    pg_restore --clean --if-exists --no-owner -U "${POSTGRES_USER:-salon}" -d "${POSTGRES_DB:-salon}" < "$DUMP"
fi
echo "Restore complete from: $DUMP"
