#!/usr/bin/env bash
# Aloqa: install or update on the server (Docker + the server's own nginx, Cloudflare in front).
#
#   bash deploy/install.sh
#
# Run as root from the project folder. The first run creates .env (random TURN secret, public IP);
# later runs rebuild and restart, keeping the database and secrets.
# What it does:
#   1. builds and starts the containers (app, web on 127.0.0.1:$WEB_PORT, coturn);
#   2. adds the site to the server's nginx (checked with `nginx -t`, rolled back if it fails).
set -euo pipefail
cd "$(dirname "$0")/.."

die() {
  echo "Xato: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "skriptni root sifatida ishga tushiring (nginx sozlamasi uchun kerak)."
command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 ||
  die "Docker (compose bilan) topilmadi. O'rnatish: curl -fsSL https://get.docker.com | sh"
command -v nginx >/dev/null 2>&1 || die "serverda nginx topilmadi."

if [ ! -f .env ]; then
  detected_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')"
  cat >.env <<EOF
DOMAIN=${DOMAIN:-video.n-shohrux.uz}
# Public IPv4 of this server. TURN (calls) goes here directly: Cloudflare doesn't pass UDP.
PUBLIC_IP=${PUBLIC_IP:-$detected_ip}
TURN_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
# The "web" container listens here on localhost; the server's nginx forwards to it.
WEB_PORT=8090
# Certificate the server's nginx uses for DOMAIN (Cloudflare Origin certificate).
SSL_CERT=/etc/nginx/ssl/n-shohrux.crt
SSL_KEY=/etc/nginx/ssl/n-shohrux.key
EOF
  chmod 600 .env
  echo "==> .env yaratildi"
fi
set -a
. ./.env
set +a
[ -n "${PUBLIC_IP:-}" ] || die "PUBLIC_IP aniqlanmadi, uni .env fayliga yozing."
echo "==> Domen: $DOMAIN | ochiq IP: $PUBLIC_IP | ichki port: $WEB_PORT"

# coturn runs on the host network, so a host firewall must let TURN through.
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow 3478 >/dev/null
  ufw allow 49160:49999/udp >/dev/null
fi

echo "==> Docker: build va ishga tushirish"
docker compose build --pull
docker compose up -d --remove-orphans

for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$WEB_PORT/api/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$WEB_PORT/api/health" >/dev/null 2>&1 ||
  die "ilova javob bermayapti. Loglar: docker compose logs app web"

echo "==> Server nginx'i: $DOMAIN"
[ -f "$SSL_CERT" ] && [ -f "$SSL_KEY" ] || die "sertifikat topilmadi: $SSL_CERT / $SSL_KEY (.env faylida to'g'rilang)."
if ! openssl x509 -in "$SSL_CERT" -noout -ext subjectAltName 2>/dev/null | grep -qF -e "DNS:*.${DOMAIN#*.}" -e "DNS:$DOMAIN"; then
  echo "Ogohlantirish: $SSL_CERT sertifikati $DOMAIN ni qamramaydi; Cloudflare 526 xatosini berishi mumkin." >&2
fi

site="/etc/nginx/sites-available/$DOMAIN"
link="/etc/nginx/sites-enabled/$DOMAIN"
backup=""
if [ -f "$site" ]; then
  backup="$(mktemp)"
  cp "$site" "$backup"
fi
sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__WEB_PORT__|$WEB_PORT|g" \
  -e "s|__SSL_CERT__|$SSL_CERT|g" -e "s|__SSL_KEY__|$SSL_KEY|g" deploy/host-nginx.conf >"$site"
ln -sf "$site" "$link"

check="$(mktemp)"
if nginx -t 2>"$check"; then
  systemctl reload nginx
  if [ -n "$backup" ]; then rm -f "$backup"; fi
else
  cat "$check" >&2
  if [ -n "$backup" ]; then mv "$backup" "$site"; else rm -f "$link" "$site"; fi
  die "nginx sozlamasi tekshiruvdan o'tmadi, o'zgarish qaytarildi. Boshqa saytlarga ta'sir qilmadi."
fi
rm -f "$check"

code="$(curl -sk -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" || true)"
[ "$code" = "200" ] || die "server nginx'i orqali tekshiruv $code qaytardi (200 kutilgan)."

echo
docker compose ps
echo
echo "Tayyor: https://$DOMAIN"
echo "Hetzner Cloud Firewall yoqilgan bo'lsa, unda oching: UDP 3478 va 49160-49999, TCP 3478."
