#!/bin/bash
sed -i "s/\r//" "/mnt/d/AI Agent/ai-town-web3/scripts/_cmd.sh"
bash "/mnt/d/AI Agent/ai-town-web3/scripts/_cmd.sh" && echo "script ok"
