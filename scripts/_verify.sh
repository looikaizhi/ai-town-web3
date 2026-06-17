#!/bin/bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null
cd "/mnt/d/AI Agent/ai-town-web3/services/indexer"
echo "=== ponder codegen ==="
npx ponder codegen
echo "=== tsc --noEmit ==="
npx tsc --noEmit
echo "=== npm run typecheck ==="
npm run typecheck