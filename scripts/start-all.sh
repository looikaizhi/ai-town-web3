#!/bin/bash
# TrumanTown — start all services in separate tmux panes or background jobs
# Usage: bash scripts/start-all.sh

source ~/.nvm/nvm.sh
nvm use 24 > /dev/null 2>&1

PROJECT="/mnt/d/ETH beijing/ai-town-web3"

echo "=== TrumanTown Startup ==="

# Fix WSL IP for Convex env
WSL_IP=$(hostname -I | awk '{print $1}')
echo "[1/6] Updating Convex URLs to host.docker.internal..."
cd "$PROJECT"
npx convex env set EXECUTOR_URL http://host.docker.internal:8404 > /dev/null 2>&1
npx convex env set GATEWAY_URL http://host.docker.internal:8402 > /dev/null 2>&1
npx convex env set PONDER_URL http://host.docker.internal:42069 > /dev/null 2>&1
npx convex env set OLLAMA_HOST http://host.docker.internal:8402 > /dev/null 2>&1
echo "    Done."

# Start facilitator
echo "[2/6] Starting facilitator (:8403)..."
cd "$PROJECT/services/facilitator/tmp_clone/examples/node"
COREPACK_ENABLE_STRICT=0 npx tsx --env-file=.env src/index.ts > /tmp/trumantown-facilitator.log 2>&1 &
echo "    PID=$! — logs: /tmp/trumantown-facilitator.log"

sleep 2

# Start gateway
echo "[3/6] Starting gateway (:8402)..."
cd "$PROJECT/services/gateway"
npm run start > /tmp/trumantown-gateway.log 2>&1 &
echo "    PID=$! — logs: /tmp/trumantown-gateway.log"

sleep 2

# Start executor
echo "[4/6] Starting executor (:8404)..."
cd "$PROJECT/services/executor"
npm run start > /tmp/trumantown-executor.log 2>&1 &
echo "    PID=$! — logs: /tmp/trumantown-executor.log"

sleep 2

# Start indexer
echo "[5/6] Starting indexer (:42069)..."
cd "$PROJECT/services/indexer"
npm run dev > /tmp/trumantown-indexer.log 2>&1 &
echo "    PID=$! — logs: /tmp/trumantown-indexer.log"

sleep 3

# Wait for executor to be ready then fund EOA
echo "[6/6] Waiting for executor to be ready..."
for i in $(seq 1 15); do
  sleep 3
  STATUS=$(curl -s --noproxy '*' http://127.0.0.1:8404/healthz 2>/dev/null)
  if echo "$STATUS" | grep -q "ok"; then
    echo "    Executor ready. Funding all 5 agent EOAs..."
    for agentId in 0 1 2 3 4; do
      RESULT=$(curl -s --noproxy '*' -X POST http://127.0.0.1:8404/actions/fund \
        -H 'content-type: application/json' \
        -d "{\"agentId\":\"$agentId\",\"target\":\"eoa\",\"asset\":\"usdc\"}" 2>/dev/null)
      echo "    Agent $agentId: $RESULT"
    done
    break
  fi
  echo "    Waiting... ($i/15)"
done

echo ""
echo "=== All background services started ==="
echo ""
echo "Logs:"
echo "  facilitator : tail -f /tmp/trumantown-facilitator.log"
echo "  gateway     : tail -f /tmp/trumantown-gateway.log"
echo "  executor    : tail -f /tmp/trumantown-executor.log"
echo "  indexer     : tail -f /tmp/trumantown-indexer.log"
echo ""
echo "Now start Convex + frontend in this terminal:"
echo "  cd \"$PROJECT\" && npm run dev"
echo ""
echo "Health check:"
echo "  curl -s --noproxy '*' http://127.0.0.1:8402/healthz"
echo "  curl -s --noproxy '*' http://127.0.0.1:8404/healthz"
echo "  curl -s --noproxy '*' http://127.0.0.1:42069/healthz"
