#!/usr/bin/env bash
# Instalador do file-server do Umucraft Launcher (Debian em Proxmox LXC/VM).
# Rode como root a partir desta pasta: sudo ./install.sh
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UMU_ROOT=/srv/umucraft
SAMBA_USER="${SAMBA_USER:-${SUDO_USER:-$(whoami)}}"
PUBLIC_BASE_URL_DEFAULT="https://umucraft-updates.codato.dev"

if [[ $EUID -ne 0 ]]; then
  echo "Rode como root: sudo ./install.sh" >&2
  exit 1
fi

# Se rodou via sudo e SAMBA_USER caiu em root, preferir o usuario que chamou sudo.
if [[ "$SAMBA_USER" == "root" && -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
  SAMBA_USER="$SUDO_USER"
fi

echo ">> Usuario samba/dono dos arquivos: $SAMBA_USER"

if ! id "$SAMBA_USER" &>/dev/null; then
  echo ">> Criando usuario de sistema '$SAMBA_USER'..."
  useradd -m -s /bin/bash "$SAMBA_USER"
fi

echo ">> Instalando pacotes (samba, nginx, python3-venv, apache2-utils, curl, smbclient)..."
apt-get update
apt-get install -y samba nginx python3-venv python3-pip apache2-utils curl smbclient

echo ">> Criando estrutura de diretorios em $UMU_ROOT..."
mkdir -p "$UMU_ROOT/staging/profiles"
mkdir -p "$UMU_ROOT/www/profiles"
mkdir -p "$UMU_ROOT/www/maps"
mkdir -p "$UMU_ROOT/www/launcher"

if [[ -f "$SCRIPT_DIR/../../manifest.json" && ! -f "$UMU_ROOT/www/manifest.json" ]]; then
  cp "$SCRIPT_DIR/../../manifest.json" "$UMU_ROOT/www/manifest.json"
  echo ">> manifest.json inicial copiado do repositorio."
fi

chown -R "$SAMBA_USER":"$SAMBA_USER" "$UMU_ROOT"

echo ">> Criando/atualizando virtualenv Python..."
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
  sed "s|UMU_PUBLIC_BASE_URL=.*|UMU_PUBLIC_BASE_URL=$PUBLIC_BASE_URL_DEFAULT|" \
    "$SCRIPT_DIR/config.env.example" > /etc/umucraft/watcher.env
  echo ">> Criado /etc/umucraft/watcher.env com $PUBLIC_BASE_URL_DEFAULT"
else
  echo ">> /etc/umucraft/watcher.env ja existe — mantendo."
fi

echo ">> Ajustando limites de inotify..."
cp "$SCRIPT_DIR/sysctl-umucraft.conf" /etc/sysctl.d/99-umucraft-inotify.conf
if grep -qa 'container=lxc' /proc/1/environ 2>/dev/null || [[ -f /run/systemd/container ]]; then
  if ! sysctl --system >/dev/null 2>&1; then
    echo ">> AVISO: sysctl falhou (comum em LXC)."
    echo "   Os limites de inotify precisam estar no HOST Proxmox, ex:"
    echo "   /etc/sysctl.d/99-umucraft-inotify.conf no node, depois sysctl --system"
  fi
else
  sysctl --system >/dev/null 2>&1 || echo ">> AVISO: sysctl --system retornou erro (seguindo)."
fi

echo ">> Configurando nginx..."
cp "$SCRIPT_DIR/nginx-umucraft.conf" /etc/nginx/sites-available/umucraft.conf
ln -sf /etc/nginx/sites-available/umucraft.conf /etc/nginx/sites-enabled/umucraft.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
systemctl enable nginx

echo ">> Configurando Samba (shares + tweaks Windows/VPN)..."
sed "s/SAMBA_USER_PLACEHOLDER/$SAMBA_USER/g" "$SCRIPT_DIR/smb-umucraft.conf" > /etc/samba/smb-umucraft.conf
if ! grep -q "include = /etc/samba/smb-umucraft.conf" /etc/samba/smb.conf; then
  printf '\ninclude = /etc/samba/smb-umucraft.conf\n' >> /etc/samba/smb.conf
fi

# Tweaks idempotentes no [global] — Windows 10/11 via VPN nao resolve NetBIOS bem.
python3 - <<'PY'
from pathlib import Path

path = Path("/etc/samba/smb.conf")
text = path.read_text()
marker = "# Umucraft Windows/VPN tweaks"
wanted = {
    "map to guest": "never",
    "server min protocol": "SMB2",
    "client min protocol": "SMB2",
    "ntlm auth": "ntlmv2-only",
    "server signing": "auto",
}

lines = text.splitlines(True)
out = []
in_global = False
seen_keys = set()
inserted_block = False

def block():
    body = "\n".join(f"   {k} = {v}" for k, v in wanted.items())
    return f"\n{marker}\n{body}\n"

for line in lines:
    stripped = line.strip()
    if stripped.startswith("[") and stripped.endswith("]"):
        in_global = stripped == "[global]"
        if in_global and marker not in text and not inserted_block:
            out.append(line)
            out.append(block())
            inserted_block = True
            continue
    if in_global:
        for key in wanted:
            if stripped.lower().startswith(key + " ") or stripped.lower().startswith(key + "="):
                out.append(f"   {key} = {wanted[key]}\n")
                seen_keys.add(key)
                break
        else:
            out.append(line)
        continue
    out.append(line)

path.write_text("".join(out))
print(">> Samba global tweaks aplicados.")
PY

systemctl restart smbd nmbd 2>/dev/null || systemctl restart smbd
systemctl enable smbd

echo ">> Instalando servico systemd do watcher..."
sed "s#{{UMU_ROOT}}#$UMU_ROOT#g; s#{{SAMBA_USER}}#$SAMBA_USER#g" \
  "$SCRIPT_DIR/umucraft-watcher.service" > /etc/systemd/system/umucraft-watcher.service
systemctl daemon-reload
systemctl enable --now umucraft-watcher

echo ">> Instalando timer do puller de releases do launcher..."
sed "s#{{UMU_ROOT}}#$UMU_ROOT#g; s#{{SAMBA_USER}}#$SAMBA_USER#g" \
  "$SCRIPT_DIR/umucraft-launcher-pull.service" > /etc/systemd/system/umucraft-launcher-pull.service
cp "$SCRIPT_DIR/umucraft-launcher-pull.timer" /etc/systemd/system/umucraft-launcher-pull.timer
systemctl daemon-reload
systemctl enable --now umucraft-launcher-pull.timer

echo ">> Instalando servico do painel admin..."
sed "s#{{UMU_ROOT}}#$UMU_ROOT#g; s#{{SAMBA_USER}}#$SAMBA_USER#g" \
  "$SCRIPT_DIR/umucraft-admin.service" > /etc/systemd/system/umucraft-admin.service
systemctl daemon-reload
systemctl enable --now umucraft-admin

echo ""
echo ">> Checagens rapidas:"
for svc in nginx smbd umucraft-watcher umucraft-admin umucraft-launcher-pull.timer; do
  printf "   %-32s %s\n" "$svc" "$(systemctl is-active "$svc" 2>/dev/null || echo unknown)"
done
if curl -fsS -o /dev/null -w "   nginx /launcher/latest.yml     HTTP %{http_code}\n" \
    http://127.0.0.1/launcher/latest.yml 2>/dev/null; then
  :
else
  echo "   nginx /launcher/latest.yml     (ainda sem release — normal em install limpo)"
fi

echo ""
echo "======================================================"
echo " Instalacao base concluida!"
echo "======================================================"
echo ""
echo "Passos manuais restantes:"
echo "  1. Defina a senha Samba do usuario '$SAMBA_USER':"
echo "       sudo smbpasswd -a $SAMBA_USER"
echo "  2. Configure o Cloudflare Tunnel (veja README.md nesta pasta)."
echo "  3. Confira /etc/umucraft/watcher.env (default: $PUBLIC_BASE_URL_DEFAULT) e:"
echo "       sudo systemctl restart umucraft-watcher"
echo "  4. Crie a senha do painel admin (fica em /admin/ atras do nginx):"
echo "       sudo htpasswd -c /etc/nginx/.htpasswd-umucraft-admin admin"
echo "       sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "Shares Samba: \\\\$(hostname)\\modpacks  e  \\\\$(hostname)\\umucraft-public"
echo "Na VPN, prefira IP: \\\\IP\\modpacks (NetBIOS nao atravessa bem)."
echo ""
