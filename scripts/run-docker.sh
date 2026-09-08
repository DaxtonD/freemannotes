#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Build and run Freeman Notes locally in Docker, pointed at your EXTERNAL Postgres
# + Redis (e.g. your Unraid containers). Connection settings live in .env.docker.
#
#   ./scripts/run-docker.sh          Build from the current code + start (default)
#   ./scripts/run-docker.sh down     Stop and remove the container
#   ./scripts/run-docker.sh logs     Follow the container logs
#
# First run copies .env.docker.example to .env.docker and asks you to fill in your
# Postgres/Redis IPs before starting.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Run from the repo root regardless of where the script is invoked from.
cd "$(dirname "$0")/.."

compose=(compose -f docker-compose.local.yml --env-file .env.docker)

case "${1:-up}" in
  down)
    docker "${compose[@]}" down
    exit $?
    ;;
  logs)
    docker "${compose[@]}" logs -f
    exit $?
    ;;
  up)
    ;;
  *)
    echo "Usage: $0 [up|down|logs]" >&2
    exit 2
    ;;
esac

if [ ! -f .env.docker ]; then
  cp .env.docker.example .env.docker
  echo ''
  echo 'Created .env.docker from the example.'
  echo 'Edit it and set DATABASE_URL and REDIS_URL to your Postgres/Redis'
  echo 'container IP addresses and ports, then run this script again:'
  echo ''
  echo '  DATABASE_URL=postgresql://USER:PASS@POSTGRES_IP:5432/DBNAME?schema=public'
  echo '  REDIS_URL=redis://REDIS_IP:6379'
  echo ''
  echo 'Tip: pointing DATABASE_URL at your PRODUCTION database gives the truest'
  echo 'repro, but the app reads AND writes it. Use a dev/throwaway DB, or set'
  echo 'DB_SCHEMA_SYNC=none in .env.docker, if you want to be conservative.'
  exit 1
fi

echo 'Building and starting Freeman Notes (rebuilds from your current code)...'
docker "${compose[@]}" up -d --build

echo ''
echo 'Freeman Notes is running at http://localhost:27015'
echo 'Force virtualization (bug repro):  http://localhost:27015/?forceVirtualization=1'
echo ''
echo 'Logs:  ./scripts/run-docker.sh logs'
echo 'Stop:  ./scripts/run-docker.sh down'
