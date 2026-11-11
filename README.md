# Ashk AI
Voice-first free AI assistant. Frontend: `docs/` (GitHub Pages). Backend: `worker/` (Cloudflare Worker + Workers AI).

## Deploy
1. Termux: `export CF_API_TOKEN=... CF_ACCOUNT_ID=...` (optional `export ASHK_KEY=secret`) then `./deploy.sh`
2. GitHub repo Settings > Pages > Deploy from branch `main`, folder `/docs`
3. Site kholo > Settings > Worker URL (+ Key) daalo

## v2: agent tools
- Worker tools: web_search (Wikipedia, ya `export TAVILY_KEY=...` before deploy for better search), get_time. Memory: "yaad rakhna ..." bolo (browser mein save hoti hai).
- Phone tools (torch, battery, vibrate, notify, open_url, location): Termux mein `pkg install python termux-api`, Termux:API app install karo, phir `ASHK_KEY=wahi-key python termux/server.py`.
