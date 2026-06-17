export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 18 >/dev/null

# Gateway
cd "/mnt/d/ETH beijing/ai-town-web3/services/gateway"
nohup npx tsx src/index.ts > /tmp/gateway.log 2>&1 &
echo "gateway PID: $!"

# Executor
cd "/mnt/d/ETH beijing/ai-town-web3/services/executor"
nohup npx tsx src/index.ts > /tmp/executor.log 2>&1 &
echo "executor PID: $!"

# Facilitator
cd "/mnt/d/ETH beijing/ai-town-web3/services/facilitator/tmp_clone/examples/node"
cp "/mnt/d/ETH beijing/ai-town-web3/services/facilitator/.env" .env 2>/dev/null
nohup npx tsx src/index.ts > /tmp/facilitator.log 2>&1 &
echo "facilitator PID: $!"

sleep 5
echo "--- checking ports ---"
curl -s http://127.0.0.1:8402/healthz && echo " gateway OK" || echo " gateway NOT UP"
curl -s http://127.0.0.1:8404/health && echo " executor OK" || echo " executor NOT UP"
curl -s http://127.0.0.1:8403/facilitator/supported && echo " facilitator OK" || echo " facilitator NOT UP"
