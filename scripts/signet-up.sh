#!/bin/zsh
# Run Cove on public signet, on this machine, for testing with real browser
# wallets (Xverse, Unisat, Leather …). Signet coins are free and worthless.
#
#   scripts/signet-up.sh          start (or restart) node, worker and web
#   scripts/signet-up.sh stop     stop worker and web (the node keeps running)
#
# Everything lives in .signet/ (gitignored): the Bitcoin Core binaries, a
# pruned signet datadir, the logs, and keys.env with the signet-only Guardian,
# recovery and fee keys this script generates on first run. They are TEST keys
# for a test network. Never reuse them anywhere else.
set -e
cd "$(dirname "$0")/.."
ROOT=$PWD
D=$ROOT/.signet
CLI=($D/bin/bitcoin-cli -signet -rpcport=38332 -rpcuser=cove -rpcpassword=cove-signet)

stop_app() {
  lsof -ti tcp:${COVE_SIGNET_PORT:-3000} | xargs kill 2>/dev/null || true
  pkill -f "COVE_SIGNET_WORKER" 2>/dev/null || true
  [ -f $D/worker.pid ] && kill $(cat $D/worker.pid) 2>/dev/null || true
  rm -f $D/worker.pid
}

if [ "$1" = "stop" ]; then stop_app; echo "stopped web + worker"; exit 0; fi

[ -x $D/bin/bitcoind ] || { echo "Put bitcoind and bitcoin-cli (v28+) in $D/bin first."; exit 1; }
mkdir -p $D/data

# 1. Bitcoin Core, pruned: a few GB instead of the whole chain.
if ! $CLI getblockchaininfo >/dev/null 2>&1; then
  $D/bin/bitcoind -signet -daemon -server=1 -rpcuser=cove -rpcpassword=cove-signet -rpcport=38332 \
    -prune=4000 -dbcache=1000 -fallbackfee=0.0002 -datadir=$D/data
  sleep 5
fi
echo "waiting for signet to sync…"
while true; do
  INFO=$($CLI getblockchaininfo)
  B=$(echo $INFO | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["blocks"])')
  H=$(echo $INFO | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["headers"])')
  [ "$B" -ge "$H" ] && [ "$H" -gt 0 ] && break
  echo "  block $B of $H"; sleep 20
done

# 2. Signet-only keys + activation height, generated once.
if [ ! -f $D/keys.env ]; then
  key() { python3 -c 'import secrets;print(secrets.token_hex(32))'; }
  cat > $D/keys.env <<EOF
COVE_GUARDIAN_PRIVATE_KEY_HEX=$(key)
COVE_RECOVERY_PRIVATE_KEY_HEX=$(key)
COVE_FEE_PRIVATE_KEY_HEX=$(key)
COVE_ACTIVATION_HEIGHT=$B
EOF
  chmod 600 $D/keys.env
  echo "generated signet keys; indexing starts at block $B"
fi

set -a
source $D/keys.env
COVE_NETWORK=signet
COVE_V3_APP_ENABLED=true
COVE_BITCOIN_RPC_URL=http://127.0.0.1:38332
COVE_BITCOIN_RPC_USER=cove
COVE_BITCOIN_RPC_PASSWORD=cove-signet
COVE_DATABASE_URL=${COVE_SIGNET_DATABASE_URL:-postgres://cove:cove@127.0.0.1:5432/cove_signet}
DATABASE_URL=$COVE_DATABASE_URL
COVE_ESPLORA_URL=https://mempool.space/signet/api
COVE_SIMPLICITY_BIN=$ROOT/packages/cove-simplicity/rust/target/release/cove-simplicity
NEXT_PUBLIC_COVE_NETWORK=signet
NEXT_PUBLIC_EXPLORER_URL=https://mempool.space/signet
set +a

# 3. Database.
DBNAME=${COVE_DATABASE_URL##*/}
psql -h 127.0.0.1 postgres -tc "SELECT 1 FROM pg_database WHERE datname='$DBNAME'" | grep -q 1 \
  || psql -h 127.0.0.1 postgres -c "CREATE DATABASE $DBNAME OWNER cove;" >/dev/null
pnpm --filter @crclaunch/db db:migrate >/dev/null

# 4. Worker + web. The build bakes NEXT_PUBLIC_COVE_NETWORK in.
stop_app
echo "building web for signet…"
pnpm --filter @crclaunch/web build > $D/build.log 2>&1 || { tail -30 $D/build.log; exit 1; }
COVE_SIGNET_WORKER=1 nohup pnpm --filter @crclaunch/worker v3 > $D/worker.log 2>&1 &
echo $! > $D/worker.pid
nohup pnpm --filter @crclaunch/web start --port ${COVE_SIGNET_PORT:-3000} > $D/web.log 2>&1 &
for i in $(seq 1 60); do
  curl -fsS http://127.0.0.1:${COVE_SIGNET_PORT:-3000}/api/v3/status >/dev/null 2>&1 && break
  sleep 1
done
echo "Cove on signet: http://localhost:${COVE_SIGNET_PORT:-3000}"
echo "logs: $D/worker.log  $D/web.log"
