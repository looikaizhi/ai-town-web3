export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null 2>&1
echo "killing old gateway..."
pkill -f "services/gateway.*tsx" 2>/dev/null
pkill -f "services/gateway/node_modules/.bin/tsx" 2>/dev/null
sleep 2
cd "/mnt/d/AI Agent/ai-town-web3/services/gateway"
echo "starting gateway (node $(node -v)) on :8402 ..."
exec npm run start
