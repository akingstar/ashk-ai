#!/data/data/com.termux/files/usr/bin/bash
# Ek baar VPS details poochta hai aur ~/.ashk_env mein save karta hai, phir server chalata hai.
F=~/.ashk_env
if [ ! -f "$F" ]; then
  read -p "VPS IP: " h; read -p "SSH port (Enter = 22): " p; read -p "SSH user (Enter = root): " u
  read -p "ASHK_KEY (app wali key): " k
  printf 'export VPS_HOST=%q VPS_PORT=%q VPS_USER=%q ASHK_KEY=%q\n' "$h" "${p:-22}" "${u:-root}" "$k" > "$F"; chmod 600 "$F"
fi
. "$F"; termux-wake-lock
exec python "$(dirname "$0")/server.py"
