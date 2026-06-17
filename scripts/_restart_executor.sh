export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null 2>&1
# Guarantee CDP egress proxy is active (loadEnv -> global-agent reads these)
export HTTPS_PROXY=http://127.0.0.1:10808
export HTTP_PROXY=http://127.0.0.1:10808
echo "killing old executor procs..."
pkill -f "services/executor/node_modules/.bin/tsx src/index.ts" 2>/dev/null
pkill -f "services/executor.*tsx/dist" 2>/dev/null
sleep 2
cd "/mnt/d/AI Agent/ai-town-web3/services/executor"
echo "starting executor (node $(node -v)) on :8404 ..."
exec npm run start
