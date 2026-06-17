#!/usr/bin/env bash
set -e
source ~/.nvm/nvm.sh
nvm use 24

BASE="/mnt/d/ETH beijing/ai-town-web3"
LOGS="/tmp/trumantown-logs"
mkdir -p "$LOGS"

echo "=== Starting TrumanTown services ==="

# Facilitator :8403
cd "$BASE/services/facilitator/tmp_clone"
PORT=8403 ./node_modules/.bin/tsx --env-file=.env src/index.ts > "$LOGS/facilitator.log" 2>&1 &
echo "facilitator PID: $!"

# Gateway :8402
cd "$BASE/services/gateway"
npm run start > "$LOGS/gateway.log" 2>&1 &
echo "gateway PID: $!"

# Executor :8404
cd "$BASE/services/executor"
npm run start > "$LOGS/executor.log" 2>&1 &
echo "executor PID: $!"

# Indexer :42069
cd "$BASE/services/indexer"
npm run dev > "$LOGS/indexer.log" 2>&1 &
echo "indexer PID: $!"

echo ""
echo "All services started. Waiting 15s for them to come up..."
sleep 15

echo ""
echo "=== Health checks ==="
curl -s --noproxy '*' http://127.0.0.1:8403/facilitator/supported 2>&1 | head -1 && echo " [facilitator OK]" || echo " [facilitator FAILED]"
curl -s --noproxy '*' http://127.0.0.1:8402/healthz 2>&1 | head -1 && echo " [gateway OK]" || echo " [gateway FAILED]"
curl -s --noproxy '*' http://127.0.0.1:8404/healthz 2>&1 | head -1 && echo " [executor OK]" || echo " [executor FAILED]"
curl -s --noproxy '*' http://127.0.0.1:42069/healthz 2>&1 | head -1 && echo " [indexer OK]" || echo " [indexer FAILED]"

echo ""
echo "Logs in $LOGS/"
echo "  tail -f $LOGS/facilitator.log"
echo "  tail -f $LOGS/gateway.log"
echo "  tail -f $LOGS/executor.log"
echo "  tail -f $LOGS/indexer.log"

# Keep alive so background jobs stay running
wait
