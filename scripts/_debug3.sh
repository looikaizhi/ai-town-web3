export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 18 >/dev/null

echo "=== EXECUTOR (10s) ==="
cd "/mnt/d/ETH beijing/ai-town-web3/services/executor"
timeout 10 npx tsx src/index.ts &
EPID=$!
sleep 8
curl -s http://127.0.0.1:8404/health && echo "executor OK" || echo "executor NOT UP"
kill $EPID 2>/dev/null
wait $EPID 2>/dev/null

echo "=== FACILITATOR (10s) ==="
cd "/mnt/d/ETH beijing/ai-town-web3/services/facilitator/tmp_clone/examples/node"
timeout 10 npx tsx src/index.ts &
FPID=$!
sleep 8
curl -s http://127.0.0.1:8403/facilitator/supported && echo "facilitator OK" || echo "facilitator NOT UP"
kill $FPID 2>/dev/null
wait $FPID 2>/dev/null
