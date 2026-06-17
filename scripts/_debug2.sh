export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 18 >/dev/null
echo "=== EXECUTOR ==="
cd "/mnt/d/ETH beijing/ai-town-web3/services/executor"
timeout 10 npx tsx src/index.ts 2>&1
echo "exit: $?"
