#!/usr/bin/env bash
# Instalador do file-server do Umucraft Launcher no Raspberry Pi.
# Rode como root a partir desta pasta: sudo ./install.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UMU_ROOT=/srv/umucraft
SAMBA_USER="${SAMBA_USER:-${SUDO_USER:-$(whoami)}}"

if [[ $EUID -ne 0 ]]; then
  echo "Rode como root: sudo ./install.sh" >&2
  exit 1
fi

echo ">> Usuario samba/dono dos arquivos: $SAMBA_USER"

echo ">> Instalando pacotes (samba, nginx, python3-venv, apache2-utils)..."
apt-get update
apt-get install -y samba nginx python3-venv python3-pip apache2-utils

echo ">> Criando estrutura de diretorios em $UMU_ROOT..."
mkdir -p "$UMU_ROOT/staging/profiles"
mkdir -p "$UMU_ROOT/www/profiles"
mkdir -p "$UMU_ROOT/www/maps"

if [[ -f "$SCRIPT_DIR/../../manifest.json" && ! -f "$UMU_ROOT/www/manifest.json" ]]; then
  cp "$SCRIPT_DIR/../../manifest.json" "$UMU_ROOT/www/manifest.json"
  echo ">> manifest.json inicial copiado do repositorio."
fi

chown -R "$SAMBA_USER":"$SAMBA_USER" "$UMU_ROOT"

echo ">> Criando virtualenv Python para o watcher..."
python3 -m venv "$UMU_ROOT/venv"
"$UMU_ROOT/venv/bin/pip" install --quiet --upgrade pip watchdog flask waitress
chown -R "$SAMBA_USER":"$SAMBA_USER" "$UMU_ROOT/venv"

cp "$SCRIPT_DIR/watcher.py" "$UMU_ROOT/watcher.py"
chown "$SAMBA_USER":"$SAMBA_USER" "$UMU_ROOT/watcher.py"

cp "$SCRIPT_DIR/pull-launcher-release.py" "$UMU_ROOT/pull-launcher-release.py"
chown "$SAMBA_USER":"$SAMBA_USER" "$UMU_ROOT/pull-launcher-release.py"

mkdir -p "$UMU_ROOT/admin"
cp "$SCRIPT_DIR/admin/app.py" "$UMU_ROOT/admin/app.py"
chown -R "$SAMBA_USER":"$SAMBA_USER" "$UMU_ROOT/admin"

mkdir -p /etc/umucraft
if [[ ! -f /etc/umucraft/watcher.env ]]; then
  cp "$SCRIPT_DIR/config.env.example" /etc/umucraft/watcher.env
  echo ">> Criado /etc/umucraft/watcher.env - EDITE UMU_PUBLIC_BASE_URL antes de ir para producao."
fi

echo ">> Ajustando limites de inotify (evita overflow de fila em copias grandes via Samba)..."
cp "$SCRIPT_DIR/sysctl-umucraft.conf" /etc/sysctl.d/99-umucraft-inotify.conf
sysctl --system > /dev/null

echo ">> Configurando nginx..."
cp "$SCRIPT_DIR/nginx-umucraft.conf" /etc/nginx/sites-available/umucraft.conf
ln -sf /etc/nginx/sites-available/umucraft.conf /etc/nginx/sites-enabled/umucraft.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
systemctl enable nginx

echo ">> Configurando Samba..."
sed "s/SAMBA_USER_PLACEHOLDER/$SAMBA_USER/g" "$SCRIPT_DIR/smb-umucraft.conf" > /etc/samba/smb-umucraft.conf
if ! grep -q "include = /etc/samba/smb-umucraft.conf" /etc/samba/smb.conf; then
  printf '\ninclude = /etc/samba/smb-umucraft.conf\n' >> /etc/samba/smb.conf
fi
systemctl restart smbd
systemctl enable smbd

echo ">> Instalando servico systemd do watcher..."
sed "s#{{UMU_ROOT}}#$UMU_ROOT#g; s#{{SAMBA_USER}}#$SAMBA_USER#g" "$SCRIPT_DIR/umucraft-watcher.service" > /etc/systemd/system/umucraft-watcher.service
systemctl daemon-reload
systemctl enable --now umucraft-watcher

echo ">> Instalando timer do puller de releases do launcher..."
sed "s#{{UMU_ROOT}}#$UMU_ROOT#g; s#{{SAMBA_USER}}#$SAMBA_USER#g" "$SCRIPT_DIR/umucraft-launcher-pull.service" > /etc/systemd/system/umucraft-launcher-pull.service
cp "$SCRIPT_DIR/umucraft-launcher-pull.timer" /etc/systemd/system/umucraft-launcher-pull.timer
systemctl daemon-reload
systemctl enable --now umucraft-launcher-pull.timer

echo ">> Instalando servico do painel admin..."
sed "s#{{UMU_ROOT}}#$UMU_ROOT#g; s#{{SAMBA_USER}}#$SAMBA_USER#g" "$SCRIPT_DIR/umucraft-admin.service" > /etc/systemd/system/umucraft-admin.service
systemctl daemon-reload
systemctl enable --now umucraft-admin

echo ""
echo "======================================================"
echo " Instalacao base concluida!"
echo "======================================================"
echo ""
echo "Passos manuais restantes:"
echo "  1. Defina a senha Samba do usuario '$SAMBA_USER':"
echo "       sudo smbpasswd -a $SAMBA_USER"
echo "  2. Configure o Cloudflare Tunnel (veja README.md nesta pasta)."
echo "  3. Edite /etc/umucraft/watcher.env com a URL publica final e rode:"
echo "       sudo systemctl restart umucraft-watcher"
echo "  4. Crie a senha do painel admin (fica em /admin/ atras do nginx):"
echo "       sudo htpasswd -c /etc/nginx/.htpasswd-umucraft-admin admin"
echo "       sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "Shares Samba criados: \\\\$(hostname)\\modpacks  e  \\\\$(hostname)\\umucraft-public"
echo ""
