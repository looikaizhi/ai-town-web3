export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 18 >/dev/null
echo "node: $(node -v)"

echo "=== EXECUTOR ==="
cd "/mnt/d/ETH beijing/ai-town-web3/services/executor"
npx tsx src/index.ts 2>&1 &
EPID=$!
sleep 6
kill $EPID 2>/dev/null

echo "=== FACILITATOR ==="
cd "/mnt/d/ETH beijing/ai-town-web3/services/facilitator/tmp_clone/examples/node"
npx tsx src/index.ts 2>&1 &
FPID=$!
sleep 6
kill $FPID 2>/dev/null
