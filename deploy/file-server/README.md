# Umucraft Launcher — File Server (Proxmox LXC/VM)

Substitui Dropbox + GitHub raw por um servidor Debian próprio (hoje:
**LXC CT `umucraft-updater`**, `192.168.201.26`):

- **Samba** — arraste a pasta do modpack (mods + `instance.json` do ATLauncher) num drive de rede.
- **watcher.py** — zipa mods, calcula MD5, importa loader do `instance.json` e atualiza o `manifest.json` (~20s de debounce).
- **nginx** — serve os arquivos (LAN e via túnel).
- **Cloudflare Tunnel** — expõe publicamente sem abrir porta no roteador.

Dia a dia: **exportar o pack no ATLauncher e arrastar pra rede.**

URL pública de produção: `https://umucraft-updates.codato.dev`

---

## 1. Copiar esta pasta para o host

Do Windows (PowerShell), com o repo no PC:

```powershell
scp -r deploy\file-server root@192.168.201.26:/root/file-server
```

(Se o `scp` vier do Windows, o `install.sh` pode chegar com CRLF — o instalador em si é bash; se der `env: 'bash\r'`, rode `sed -i 's/\r$//' /root/file-server/install.sh` antes.)

## 2. Rodar o instalador

```bash
ssh root@192.168.201.26
cd /root/file-server
SAMBA_USER=andrecodato ./install.sh
```

Isso instala samba + nginx, cria `/srv/umucraft/{staging,www}`, sobe
`umucraft-watcher` / puller de release / painel admin, e configura os shares:

- `\\192.168.201.26\modpacks` → `modpacks\<Perfil>\mods\` + `instance.json`
- `\\192.168.201.26\umucraft-public` → `manifest.json`, `maps\`, `launcher\`

Em LXC, o `sysctl` de inotify pode falhar dentro do container — aplique
`deploy/file-server/sysctl-umucraft.conf` no **host Proxmox** se copias
grandes via Samba floodarem o log do watcher.

## 3. Senha do Samba

```bash
smbpasswd -a andrecodato
```

## 4. Mapear os drives no Windows

Explorer → "Mapear unidade de rede" (pela VPN use o **IP**, não o hostname —
NetBIOS não atravessa bem):

```
\\192.168.201.26\modpacks
\\192.168.201.26\umucraft-public
```

Usuário: `andrecodato` (ou `.\andrecodato`). Senha: a do passo 3.

Se o Windows cachear credencial velha:

```cmd
cmdkey /delete:192.168.201.26
net use * /delete /y
```

## 5. Cloudflare Tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create umucraft-updates
cloudflared tunnel route dns umucraft-updates umucraft-updates.codato.dev
```

Copie credentials + cert para `/etc/cloudflared/`, use
`cloudflared-config.yml.example` como base de `/etc/cloudflared/config.yml`,
depois:

```bash
cloudflared --config /etc/cloudflared/config.yml service install
systemctl enable --now cloudflared
```

Teste: `https://umucraft-updates.codato.dev/launcher/latest.yml`

Se migrou de outro host (ex. Raspberry antigo), **pare** o `cloudflared` lá
antes de ligar aqui — dois conectores no mesmo túnel brigam.

## 6. Watcher / launcher

O `install.sh` já grava `UMU_PUBLIC_BASE_URL=https://umucraft-updates.codato.dev`
em `/etc/umucraft/watcher.env`. Confira e reinicie se mudar:

```bash
systemctl restart umucraft-watcher
```

No app, `src/main/utils/paths.js` já aponta para esse hostname:

```js
MANIFEST_URL: 'https://umucraft-updates.codato.dev/manifest.json',
```

---

## Uso do dia a dia

- **Atualizar mods:** `\\192.168.201.26\modpacks\<Perfil>\mods\` — espere ~20s.
- **Extras (config/shaderpacks/resourcepacks/options.txt):** solte irmão de `mods\` no mesmo perfil; vira `extras.zip` (overlay no player, sem apagar saves). Não solte `saves\`.
- **Loader/versão MC:** substitua `instance.json` do ATLauncher na pasta do perfil.
- **Servidor novo:** pasta nova em `modpacks\<Nome>\` + `host`/`port` à mão no `manifest.json`.
- **Mapas:** `\\192.168.201.26\umucraft-public\maps\`
- **Notícias:** edite `umucraft-public\manifest.json` (watcher só mexe em campos de mods/loader/extras).
- **Release do launcher:** bump `version` + tag `vX.Y.Z` → Actions builda → timer `umucraft-launcher-pull` publica em `www/launcher/`. Fallback imediato: `npm run publish-launcher`.

## Logs / troubleshooting

```bash
journalctl -u umucraft-watcher -f
journalctl -u umucraft-launcher-pull -f
journalctl -u cloudflared -f
systemctl status nginx smbd umucraft-watcher umucraft-launcher-pull.timer cloudflared
systemctl start umucraft-launcher-pull   # forçar pull agora
```

---

## Publicação automática do launcher via GitHub Actions

```
git: bump version + tag vX.Y.Z + push
  -> GitHub Actions builda o .exe e publica GitHub Release
  -> file-server (pull-launcher-release.py, timer 5 min) baixa assets
     para www/launcher/ (só tráfego de saída)
```

**Deploy pontual do puller** (host já instalado, sem rerodar o install inteiro):

```bash
scp deploy/file-server/pull-launcher-release.py \
    deploy/file-server/umucraft-launcher-pull.service \
    deploy/file-server/umucraft-launcher-pull.timer \
    root@192.168.201.26:/root/file-server/
ssh root@192.168.201.26
cp /root/file-server/pull-launcher-release.py /srv/umucraft/pull-launcher-release.py
chown andrecodato:andrecodato /srv/umucraft/pull-launcher-release.py
sed "s#{{UMU_ROOT}}#/srv/umucraft#g; s#{{SAMBA_USER}}#andrecodato#g" \
  /root/file-server/umucraft-launcher-pull.service > /etc/systemd/system/umucraft-launcher-pull.service
cp /root/file-server/umucraft-launcher-pull.timer /etc/systemd/system/umucraft-launcher-pull.timer
systemctl daemon-reload
systemctl enable --now umucraft-launcher-pull.timer
```

---

## Painel admin

`https://umucraft-updates.codato.dev/admin/` (Flask + waitress em
`127.0.0.1:8787`, nginx com basic auth em `/admin/`):

- Estado dos serviços
- Perfis do manifest (MC/loader, versão/tamanho do `mods.zip`)
- Tail dos logs do watcher e do puller
- Botão **Forçar rebuild** por perfil

```bash
htpasswd -c /etc/nginx/.htpasswd-umucraft-admin admin
nginx -t && systemctl reload nginx
```
