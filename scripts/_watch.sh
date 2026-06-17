B="http://127.0.0.1:8404"
b0=$(curl -s -m 30 --noproxy '*' "$B/balances/0" | sed -E 's/.*"eoaUsdc":"([0-9]+)".*/\1/')
echo "organic watch (NO driving): eoaUsdc start=$b0  — does the town pay on its own?"
for i in $(seq 1 12); do
  sleep 15
  eoa=$(curl -s -m 30 --noproxy '*' "$B/balances/0" | sed -E 's/.*"eoaUsdc":"([0-9]+)".*/\1/')
  d="same"; [ -n "$b0" ] && [ -n "$eoa" ] && [ "$eoa" -lt "$b0" ] 2>/dev/null && d="DROP $((b0-eoa))"
  echo "  t+$((i*15))s eoaUsdc=$eoa  [$d]"
done