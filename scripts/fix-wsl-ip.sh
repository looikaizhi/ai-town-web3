#!/bin/bash
# Run this once after WSL starts to fix all IPs automatically.
source ~/.nvm/nvm.sh
nvm use 24 > /dev/null 2>&1

# With mirrored networking, everything uses 127.0.0.1
IP="127.0.0.1"

echo "Using IP: $IP (mirrored networking)"

# Update gateway Ollama upstream
python3 -c "
import re
with open('/mnt/d/ETH beijing/ai-town-web3/services/gateway/.env', 'r') as f:
    content = f.read()
content = re.sub(r'OLLAMA_UPSTREAM=.*', f'OLLAMA_UPSTREAM=http://{\"$IP\"}:11434', content)
with open('/mnt/d/ETH beijing/ai-town-web3/services/gateway/.env', 'w') as f:
    f.write(content)
print('gateway .env updated')
"

# Update Convex env vars
cd "/mnt/d/ETH beijing/ai-town-web3"
npx convex env set EXECUTOR_URL http://$IP:8404
npx convex env set GATEWAY_URL http://$IP:8402
npx convex env set PONDER_URL http://$IP:42069
npx convex env set OLLAMA_HOST http://$IP:8402

echo "Done! All URLs updated to 127.0.0.1"
