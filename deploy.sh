#!/data/data/com.termux/files/usr/bin/bash
# Termux se Worker deploy. Optional: export ASHK_KEY="koi-secret" (app ki password key)
set -e
T="${CF_API_TOKEN:-$CLOUDFLARE_API_TOKEN}"; A="${CF_ACCOUNT_ID:-$CLOUDFLARE_ACCOUNT_ID}"
[ -z "$T" ] || [ -z "$A" ] && { echo "CF_API_TOKEN / CF_ACCOUNT_ID set nahi hain"; exit 1; }
cd "$(dirname "$0")/worker"
B='{"type":"ai","name":"AI"}'
[ -n "$ASHK_KEY" ] && B="$B,{\"type\":\"secret_text\",\"name\":\"APP_KEY\",\"text\":\"$ASHK_KEY\"}"
[ -n "$TAVILY_KEY" ] && B="$B,{\"type\":\"secret_text\",\"name\":\"TAVILY_KEY\",\"text\":\"$TAVILY_KEY\"}"
API="https://api.cloudflare.com/client/v4/accounts/$A/workers"
curl -s -X PUT "$API/scripts/ashk-ai-worker" -H "Authorization: Bearer $T" \
  -F "metadata={\"main_module\":\"index.js\",\"compatibility_date\":\"2025-01-01\",\"bindings\":[$B]};type=application/json" \
  -F "index.js=@src/index.js;type=application/javascript+module" | head -c 300; echo
curl -s -X POST "$API/scripts/ashk-ai-worker/subdomain" -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" --data '{"enabled":true}' >/dev/null
echo "Subdomain:"; curl -s "$API/subdomain" -H "Authorization: Bearer $T"; echo
echo "URL: https://ashk-ai-worker.<subdomain>.workers.dev"
