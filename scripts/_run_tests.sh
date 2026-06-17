#!/bin/bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null
cd "/mnt/d/AI Agent/ai-town-web3/services/gateway"
npx vitest run