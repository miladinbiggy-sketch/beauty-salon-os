#!/usr/bin/env bash
# Beauty Salon OS 数据库备份：pg_dump 自定义格式（含排斥约束等全部对象）
# 用法：DATABASE_URL=postgres://... ./scripts/backup.sh [输出目录]
set -euo pipefail

OUT_DIR="${1:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"

if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump "$DATABASE_URL" -Fc -f "$OUT_DIR/salon-$STAMP.dump"
else
  # Docker Compose 环境：经 postgres 容器执行
  docker compose -f infra/docker-compose.yml exec -T postgres \
    pg_dump -U "${POSTGRES_USER:-salon}" -Fc "${POSTGRES_DB:-salon}" > "$OUT_DIR/salon-$STAMP.dump"
fi
echo "Backup written: $OUT_DIR/salon-$STAMP.dump"
ls -lh "$OUT_DIR/salon-$STAMP.dump"
