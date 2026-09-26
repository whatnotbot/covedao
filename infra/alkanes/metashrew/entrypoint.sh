#!/bin/sh
set -eu
set -- --host "${HOST:-0.0.0.0}" --port "${PORT:-8080}" \
  --indexer "${INDEXER:-/metashrew/indexer.wasm}" --db-path "${DB_PATH:-/data}" \
  --auth "${AUTH}" --daemon-rpc-url "${DAEMON_RPC_ADDR}"
[ -n "${START_BLOCK:-}" ] && set -- "$@" --start-block "$START_BLOCK"
export RUST_LOG="${RUST_LOG:-info}"
exec /usr/local/bin/rockshrew-mono "$@"
