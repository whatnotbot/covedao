#!/bin/zsh
# Local regtest Bitcoin + the alkanes stack (metashrew, ord, esplora, gateway)
# for Cove development. Compose file: infra/alkanes/compose.yml.
#
#   scripts/alkanes-up.sh           build if needed, start, mine to height 101
#   scripts/alkanes-up.sh status    height of every service
#   scripts/alkanes-up.sh mine [n]  mine n blocks (default 1)
#   scripts/alkanes-up.sh down      stop (keeps the chain)
#   scripts/alkanes-up.sh reset     stop and delete every volume (fresh chain)
#
# Cove against it (COVE_NETWORK=regtest; RPC is the fixture default user/pass):
#   COVE_ORD_URL=http://127.0.0.1:8090        inscription/rune funding checks
#   COVE_ESPLORA_URL=http://127.0.0.1:50010   address index
# Everything listens on 127.0.0.1 only.
set -e
cd "$(dirname "$0")/.."
DC=(docker compose -f infra/alkanes/compose.yml)
CLI=("${DC[@]}" exec -T bitcoind bitcoin-cli -regtest -rpcuser=user -rpcpassword=pass)
WALLET=cove

height_of() { # name url  → prints the height or "-"
  local h; h=$(curl -fsS -m 3 "$2" 2>/dev/null | tr -dc '0-9' | head -c 12) || true
  printf '  %-10s %s\n' "$1" "${h:--}"
}

metashrew_height() {
  curl -fsS -m 3 http://127.0.0.1:18080 -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"metashrew_height","params":[]}' 2>/dev/null \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("result","-"))' 2>/dev/null || echo -
}

status() {
  echo "service heights:"
  printf '  %-10s %s\n' bitcoind "$("${CLI[@]}" getblockcount 2>/dev/null || echo -)"
  printf '  %-10s %s\n' metashrew "$(metashrew_height)"
  height_of ord http://127.0.0.1:8090/blockheight
  height_of esplora http://127.0.0.1:50010/blocks/tip/height
}

mine() {
  "${CLI[@]}" -rpcwallet=$WALLET generatetoaddress "${1:-1}" "$("${CLI[@]}" -rpcwallet=$WALLET getnewaddress)" >/dev/null
}

case "${1:-up}" in
  status) status; exit 0 ;;
  mine) mine "${2:-1}"; status; exit 0 ;;
  down) "${DC[@]}" down; exit 0 ;;
  reset) "${DC[@]}" down -v; exit 0 ;;
  up) ;;
  *) echo "usage: $0 [up|status|mine [n]|down|reset]"; exit 1 ;;
esac

if lsof -nP -iTCP:18443 -sTCP:LISTEN 2>/dev/null | grep -qv com.docker; then
  if ! docker ps --format '{{.Names}}' | grep -q '^cove-alkanes-bitcoind'; then
    echo "port 18443 is taken by another bitcoind; stop it first:"; lsof -nP -iTCP:18443 -sTCP:LISTEN; exit 1
  fi
fi

echo "building images (first run compiles metashrew, ord and esplora: ~30-60 min)…"
"${DC[@]}" build
"${DC[@]}" up -d
for i in $(seq 1 60); do "${CLI[@]}" getblockcount >/dev/null 2>&1 && break; sleep 2; done

"${CLI[@]}" loadwallet $WALLET >/dev/null 2>&1 || "${CLI[@]}" createwallet $WALLET >/dev/null 2>&1 || true
H=$("${CLI[@]}" getblockcount)
[ "$H" -lt 101 ] && mine $((101 - H))
echo "waiting for the indexers to reach the tip…"
TIP=$("${CLI[@]}" getblockcount)
for i in $(seq 1 120); do
  MS=$(metashrew_height); ORD=$(curl -fsS -m 3 http://127.0.0.1:8090/blockheight 2>/dev/null || echo 0)
  ES=$(curl -fsS -m 3 http://127.0.0.1:50010/blocks/tip/height 2>/dev/null || echo 0)
  [ "$MS" = "$TIP" -o "$MS" = "$((TIP + 1))" ] && [ "$ORD" = "$TIP" ] && [ "$ES" = "$TIP" ] && break
  sleep 2
done
status
echo "alkanes regtest up. Gateway: http://127.0.0.1:18888  ord: :8090  esplora: :50010  metashrew: :18080"
