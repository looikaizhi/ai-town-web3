export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"

# Kill any previous instances
pkill -f "services/facilitator" 2>/dev/null
pkill -f "services/executor" 2>/dev/null
sleep 1

# Facilitator — Node 18 is fine
nvm use 18 >/dev/null
cd "/mnt/d/ETH beijing/ai-town-web3/services/facilitator/tmp_clone/examples/node"
npx tsx src/index.ts > /tmp/facilitator.log 2>&1 &
echo "facilitator PID: $!"

# Executor — needs Node 20
nvm install 20 --no-progress 2>/dev/null
nvm use 20 >/dev/null
node -v
cd "/mnt/d/ETH beijing/ai-town-web3/services/executor"
npx tsx src/index.ts > /tmp/executor.log 2>&1 &
echo "executor PID: $!"

echo "waiting 20s..."
sleep 20

echo "=== facilitator log ==="
cat /tmp/facilitator.log

echo "=== executor log ==="
cat /tmp/executor.log

echo "=== port check ==="
curl -s http://127.0.0.1:8403/facilitator/supported && echo " facilitator OK" || echo " facilitator NOT UP"
curl -s http://127.0.0.1:8404/health && echo " executor OK" || echo " executor NOT UP"
