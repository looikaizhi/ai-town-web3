export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null 2>&1
cd "/mnt/d/AI Agent/ai-town-web3/services/executor"
echo "starting executor (node $(node -v)) on :8404 ..."
exec npm run start
