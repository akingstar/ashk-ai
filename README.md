# Ashk AI
Voice-first free AI assistant. Frontend: `docs/` (GitHub Pages). Backend: `worker/` (Cloudflare Worker + Workers AI).

## Deploy
1. Termux: `export CF_API_TOKEN=... CF_ACCOUNT_ID=...` (optional `export ASHK_KEY=secret`) then `./deploy.sh`
2. GitHub repo Settings > Pages > Deploy from branch `main`, folder `/docs`
3. Site kholo > Settings > Worker URL (+ Key) daalo
