export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 18 >/dev/null
echo "=== Installing facilitator with pnpm ==="
cd "/mnt/d/ETH beijing/ai-town-web3/services/facilitator/tmp_clone"
npm install -g pnpm 2>/dev/null
pnpm install 2>&1
echo "pnpm install exit: $?"
echo "=== checking @oviato ==="
ls examples/node/node_modules/@oviato/ 2>/dev/null || echo "still missing"
echo "=== FACILITATOR (foreground, 15s) ==="
cd examples/node
cp "/mnt/d/ETH beijing/ai-town-web3/services/facilitator/.env" .env
timeout 15 npx tsx src/index.ts
echo "exit: $?"
