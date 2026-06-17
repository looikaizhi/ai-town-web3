export PATH="$HOME/.foundry/bin:$PATH"
# forge/cast only talk to the RPC (reachable directly from WSL); proxy is for CDP only.
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy NO_PROXY
cd "/mnt/d/AI Agent/ai-town-web3/contracts"
RPC="https://sepolia.base.org"
echo "=== current block before deploy ==="
cast block-number --rpc-url $RPC
echo "=== forge script Deploy (broadcast) ==="
forge script script/Deploy.s.sol --rpc-url $RPC --broadcast 2>&1 | grep -E "USDC:|MockUSDC:|AgentRegistry:|LaunchpadFactory:|Error|revert|Transactions saved"
echo "=== done ==="
