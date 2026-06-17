export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 18 >/dev/null

echo "=== FACILITATOR ==="
cd "/mnt/d/ETH beijing/ai-town-web3/services/facilitator/tmp_clone/examples/node"
timeout 15 npx tsx src/index.ts 2>&1
echo "facilitator exit: $?"

echo "=== EXECUTOR ==="
cd "/mnt/d/ETH beijing/ai-town-web3/services/executor"
timeout 30 npx tsx src/index.ts 2>&1
echo "executor exit: $?"
