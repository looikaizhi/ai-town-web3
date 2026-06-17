export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null 2>&1
export NO_PROXY=127.0.0.1,localhost; unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
cd "/mnt/d/AI Agent/ai-town-web3/services/e2e"
echo "=== e2e typecheck ==="
npm run typecheck 2>&1 | tail -6 && echo "TYPECHECK CLEAN"
echo "=== validate AgentDied getLogs (recent window) ==="
cp ../../scripts/_probe.mjs ./_probe.mjs && npx tsx _probe.mjs; rm -f ./_probe.mjs
