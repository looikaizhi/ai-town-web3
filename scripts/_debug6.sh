export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 18 >/dev/null
echo "node: $(node -v), npm: $(npm -v)"

cd "/mnt/d/ETH beijing/ai-town-web3/services/facilitator/tmp_clone"

echo "=== building main package ==="
npm install 2>&1 | tail -3
npm run build 2>&1 | tail -10

echo "=== linking into example ==="
cd examples/node
npm install 2>&1 | tail -3
# manually link the built package
mkdir -p node_modules/@oviato
ln -sfn "/mnt/d/ETH beijing/ai-town-web3/services/facilitator/tmp_clone" node_modules/@oviato/x402-facilitator-hono

echo "=== @oviato check ==="
ls node_modules/@oviato/x402-facilitator-hono/dist/ 2>/dev/null | head -5 || echo "no dist"

cp "/mnt/d/ETH beijing/ai-town-web3/services/facilitator/.env" .env

echo "=== running facilitator (15s) ==="
timeout 15 npx tsx src/index.ts
echo "exit: $?"
