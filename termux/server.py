# Ashk AI phone tools. Termux: pkg install python termux-api (+ install Termux:API app)
# Run: ASHK_KEY="wahi-key" python termux/server.py
import json, os, re, shlex, subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

KEY = os.environ.get("ASHK_KEY", "")

def sh(*c):
    r = subprocess.run(c, capture_output=True, text=True, timeout=25)
    return (r.stdout or r.stderr).strip() or "done"

def run(t, a, ok=False):
    if t == "battery": return sh("termux-battery-status")
    if t == "torch": return sh("termux-torch", "off" if a.get("state") == "off" else "on")
    if t == "vibrate": return sh("termux-vibrate", "-d", "400")
    if t == "notify": return sh("termux-notification", "--title", str(a.get("title", "Ashk AI")), "--content", str(a.get("text", "")))
    if t == "location": return sh("termux-location", "-p", "network", "-r", "once")
    if t == "open_url":
        u = str(a.get("url", ""))
        return sh("termux-open-url", u) if u.startswith(("http://", "https://")) else "bad url"
    if t in READ: return READ[t](a)
    return write(t, a, ok)

HOST = os.environ.get("VPS_HOST", ""); VUSER = os.environ.get("VPS_USER", "root"); VPORT = os.environ.get("VPS_PORT", "22")

def ssh(cmd):
    if not HOST: return "VPS_HOST set nahi hai"
    return sh("ssh", "-i", os.path.expanduser("~/.ssh/ashk_vps"), "-p", VPORT, "-o", "BatchMode=yes",
              "-o", "ConnectTimeout=10", VUSER + "@" + HOST, cmd)

def sql(q): return ssh("mysql asterisk -e " + shlex.quote(q))

READ = {
    "vps_health": lambda a: ssh("uptime; free -m | sed -n 1,2p; df -h / | tail -1; systemctl is-active mariadb httpd; asterisk -rx 'core show channels count' | tail -3"),
    "vici_agents": lambda a: sql("select user,status,campaign_id from vicidial_live_agents"),
    "vici_campaigns": lambda a: sql("select campaign_id,active,dial_method,auto_dial_level from vicidial_campaigns"),
    "vici_hopper": lambda a: sql("select campaign_id,count(*) hopper from vicidial_hopper group by campaign_id"),
    "vici_calls_today": lambda a: sql("select campaign_id,count(*) calls from vicidial_log where call_date>=curdate() group by campaign_id"),
}

def write(t, a, ok):
    if t not in ("vici_campaign_active", "vici_add_dnc", "vps_cmd"): return "unknown tool"
    if not ok: return "user ki confirmation chahiye"
    if t == "vici_campaign_active":
        c = str(a.get("campaign_id", "")); v = "Y" if a.get("active") == "Y" else "N"
        if not re.fullmatch(r"[A-Za-z0-9_]{1,8}", c): return "bad campaign id"
        return sql(f"update vicidial_campaigns set active='{v}' where campaign_id='{c}'; select campaign_id,active from vicidial_campaigns where campaign_id='{c}'")
    if t == "vici_add_dnc":
        p = re.sub(r"\D", "", str(a.get("phone", "")))
        if not 10 <= len(p) <= 15: return "bad number"
        return sql(f"insert ignore into vicidial_dnc (phone_number) values ('{p}'); select count(*) added from vicidial_dnc where phone_number='{p}'")
    return ssh(str(a.get("command", "")))

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
            out = run(d.get("tool"), d.get("args") or {}, bool(d.get("confirmed")))
        except Exception as e:
            out = "error: " + str(e)
        self._h(200); self.wfile.write(out.encode())
    def log_message(self, *a): pass

print("Ashk AI phone tools on 127.0.0.1:8765")
HTTPServer(("127.0.0.1", 8765), H).serve_forever()
