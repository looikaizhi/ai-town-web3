export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null 2>&1
echo "killing old ponder..."
pkill -f "ponder dev" 2>/dev/null
sleep 2
cd "/mnt/d/AI Agent/ai-town-web3/services/indexer"
echo "clearing .ponder cache (force clean backfill from new START_BLOCK)..."
rm -rf .ponder
# Guaranteed env (Ponder only auto-loads .env.local; export here so this run is certain)
export PONDER_PORT=42069
export PONDER_RPC_URL_84532=https://sepolia.base.org
export FACTORY_ADDRESS=0x5568f7c39874342F66fA1E0876539A6FC94641ce
export REGISTRY_ADDRESS=0xDc4d6521226F1F2ED5E3Ff8D5edF668F256162a6
export USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
export START_BLOCK=42426508
echo "starting ponder dev (node $(node -v)) START_BLOCK=$START_BLOCK FACTORY=$FACTORY_ADDRESS ..."
exec npm run dev
