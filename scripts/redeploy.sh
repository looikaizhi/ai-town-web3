#!/bin/bash
source ~/.nvm/nvm.sh
nvm use 24 > /dev/null 2>&1
export PATH="$HOME/.foundry/bin:$PATH"
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy

RPC="https://base-sepolia.g.alchemy.com/v2/3cXQI9WPc-gQQQj1GSNTZ"
PK="0x41d2d4bbc25688ee7015e4509235a5489ae36649700ecfd06172cc0d8caacc2b"
SMART="0x9Bc388e650d855120d7723dF0Ab1e6E1135b52c9"

cd "/mnt/d/ETH beijing/ai-town-web3/contracts"

echo "=== Deploying fresh contracts ==="
OUTPUT=$(forge script script/Deploy.s.sol --rpc-url $RPC --broadcast 2>&1)
echo "$OUTPUT" | grep -E "USDC:|AgentRegistry:|LaunchpadFactory:"

FACTORY=$(echo "$OUTPUT" | grep "LaunchpadFactory:" | awk '{print $2}')
REGISTRY=$(echo "$OUTPUT" | grep "AgentRegistry:" | awk '{print $2}')
BLOCK=$(cast block-number --rpc-url $RPC)

echo ""
echo "=== Spawning agent 0 with wallet=$SMART ==="
cast send $FACTORY \
  "spawnAgent(string,string,address,uint256,uint256,uint256)" \
  "Alice Coin" "ALICE" $SMART 10000 0 100 \
  --rpc-url $RPC --private-key $PK 2>&1 | grep -E "status|blockNumber"

echo ""
echo "=== Verifying agent 0 ==="
cast call $REGISTRY "agents(uint256)(address,address,uint256,uint256,uint256,bool)" 0 --rpc-url $RPC

echo ""
echo "=== RESULTS ==="
echo "REGISTRY_ADDRESS=$REGISTRY"
echo "FACTORY_ADDRESS=$FACTORY"
echo "START_BLOCK=$BLOCK"
