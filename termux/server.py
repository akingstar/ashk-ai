# Ashk AI phone tools. Termux: pkg install python termux-api (+ install Termux:API app)
# Run: ASHK_KEY="wahi-key" python termux/server.py
import json, os, subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

KEY = os.environ.get("ASHK_KEY", "")

def sh(*c):
    r = subprocess.run(c, capture_output=True, text=True, timeout=25)
    return (r.stdout or r.stderr).strip() or "done"

def run(t, a):
    if t == "battery": return sh("termux-battery-status")
    if t == "torch": return sh("termux-torch", "off" if a.get("state") == "off" else "on")
    if t == "vibrate": return sh("termux-vibrate", "-d", "400")
    if t == "notify": return sh("termux-notification", "--title", str(a.get("title", "Ashk AI")), "--content", str(a.get("text", "")))
    if t == "location": return sh("termux-location", "-p", "network", "-r", "once")
    if t == "open_url":
        u = str(a.get("url", ""))
        return sh("termux-open-url", u) if u.startswith(("http://", "https://")) else "bad url"
    return "unknown tool"

class H(BaseHTTPRequestHandler):
    def _h(self, code):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,X-Key")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
    def do_OPTIONS(self): self._h(204)
    def do_POST(self):
        if KEY and self.headers.get("X-Key") != KEY:
            self._h(401); self.wfile.write(b"galat key"); return
        try:
            d = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            out = run(d.get("tool"), d.get("args") or {})
        except Exception as e:
            out = "error: " + str(e)
        self._h(200); self.wfile.write(out.encode())
    def log_message(self, *a): pass

print("Ashk AI phone tools on 127.0.0.1:8765")
HTTPServer(("127.0.0.1", 8765), H).serve_forever()
