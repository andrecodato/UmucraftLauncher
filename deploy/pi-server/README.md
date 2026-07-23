# Umucraft Launcher — File Server no Raspberry Pi

Substitui o Dropbox + GitHub raw por um servidor próprio no Pi:

- **Samba** — você arrasta a pasta do modpack (mods + o `instance.json` exportado pelo ATLauncher) direto de um drive de rede no Windows.
- **watcher.py** — observa a pasta, zipa os mods, calcula o MD5, importa a versão do Minecraft/loader (Forge/NeoForge/Fabric) do `instance.json` e atualiza o `manifest.json` sozinho (~20s de debounce após a última mudança).
- **nginx** — serve os arquivos estaticamente (LAN e via túnel).
- **Cloudflare Tunnel** — expõe isso publicamente sem abrir porta no roteador.

Esforço do dia a dia depois de configurado: **exportar o pack no ATLauncher e arrastar a pasta pra rede.** Nada de zipar, gerar manifest, configurar loader ou subir em lugar nenhum na mão.

---

## 1. Copiar esta pasta para o Pi

Do Windows (PowerShell), com o repo já no seu PC:

```powershell
scp -r deploy\pi-server andrecodato@microlab:~/pi-server
```

## 2. Rodar o instalador no Pi

```bash
ssh andrecodato@microlab
cd ~/pi-server
sudo ./install.sh
```

Isso instala samba + nginx, cria `/srv/umucraft/{staging,www}`, sobe o serviço `umucraft-watcher` (systemd) e configura os shares Samba:

- `\\microlab\modpacks` → solte os `.jar` em `modpacks\<Nome do Perfil>\mods\` e o `instance.json` do ATLauncher direto em `modpacks\<Nome do Perfil>\instance.json` (os nomes de perfil são os mesmos do `manifest.json`, ex: `Umucraft Modded 2026`, `Umucraft Vanilla`)
- `\\microlab\umucraft-public` → contém `manifest.json` (editável direto, ex. pra mexer em `news`) e a pasta `maps\` (solte os mundos/backups de mapa aqui)

## 3. Senha do Samba

```bash
sudo smbpasswd -a andrecodato
```

Essa é a senha que o Windows vai pedir ao mapear o drive de rede.

## 4. Mapear os drives no Windows

No Explorer, "Mapear unidade de rede":

```
\\microlab\modpacks
\\microlab\umucraft-public
```

Usuário/senha: os que você definiu no passo 3.

## 5. Cloudflare Tunnel

Você já instalou o `cloudflared` — falta só criar e apontar o túnel:

```bash
cloudflared tunnel login          # abre o navegador, autoriza seu domínio na Cloudflare
cloudflared tunnel create umucraft
cloudflared tunnel route dns umucraft updates.SEUDOMINIO.com
```

Copie `cloudflared-config.yml.example` para `~/.cloudflared/config.yml`, trocando:
- `SAMBA_USER_PLACEHOLDER` pelo seu usuário (ex: `andrecodato`)
- `TUNNEL_ID` pelo ID que o `tunnel create` imprimiu
- `updates.SEUDOMINIO.com` pelo hostname real

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Teste: `https://updates.SEUDOMINIO.com/manifest.json` deve responder o JSON.

## 6. Apontar o watcher para a URL pública final

```bash
sudo nano /etc/umucraft/watcher.env
# UMU_PUBLIC_BASE_URL=https://updates.SEUDOMINIO.com
sudo systemctl restart umucraft-watcher
```

## 7. Apontar o launcher para o novo manifest

Em `src/main/utils/paths.js`, no `CONFIG.MANIFEST_URL`:

```js
MANIFEST_URL: 'https://updates.SEUDOMINIO.com/manifest.json',
```

Rebuild/redistribua o launcher (`npm run build`) para os players pegarem a nova URL.

---

## Uso do dia a dia

- **Atualizar mods:** arraste os `.jar` novos/atualizados para `\\microlab\modpacks\<Perfil>\mods\`. Espere ~20s — o zip, o MD5 e o `manifest.json` são atualizados sozinhos. Os players recebem o update automaticamente na próxima vez que abrirem o launcher.
- **Atualizar a versão/loader (ex: subiu o NeoForge, mudou a versão do Minecraft):** no ATLauncher, exporte o instance novamente e substitua `\\microlab\modpacks\<Perfil>\instance.json`. O watcher importa `minecraftVersion`/`loader`/`loaderVersion`/`javaMajor` automaticamente e publica um `version.json` novo.
- **Criar um servidor novo:** crie a pasta `\\microlab\modpacks\<Nome do Novo Perfil>\`, solte `mods\` + `instance.json` lá dentro, e adicione `host`/`port` à mão na entrada correspondente do `manifest.json` (único campo que o watcher não preenche sozinho).
- **Publicar um mapa antigo:** arraste a pasta do mundo (ou um `.zip` dela) para `\\microlab\umucraft-public\maps\`. Fica disponível em `https://updates.SEUDOMINIO.com/maps/`.
- **Editar notícias/descrição:** edite `manifest.json` direto em `\\microlab\umucraft-public\manifest.json` — o watcher só mexe nos campos de mods/versão/loader de cada perfil, o resto (`news`, `serverName`, `host`, `port`, etc) fica intocado.
- **Publicar uma versão nova do launcher (.exe):** bump o `version` em `package.json`, commit, e crie/dê push numa tag `vX.Y.Z` igual à versão. O GitHub Actions builda e publica uma Release sozinho; o timer `umucraft-launcher-pull` no Pi (roda a cada 5 min) detecta a release nova e publica em `/srv/umucraft/www/launcher/` automaticamente — nenhum passo manual no Pi. Quem já tem o launcher aberto recebe a atualização e reinicia sozinho no próximo boot do app. (`npm run publish-launcher` continua funcionando como fallback manual/imediato, caso precise pular a fila do Actions.)

## Logs / troubleshooting

```bash
sudo journalctl -u umucraft-watcher -f
sudo journalctl -u umucraft-launcher-pull -f
sudo journalctl -u cloudflared -f
sudo systemctl status nginx smbd umucraft-watcher umucraft-launcher-pull.timer cloudflared
```

Forçar uma checagem de release fora do timer (útil pra testar sem esperar os 5 min):

```bash
sudo systemctl start umucraft-launcher-pull
```

---

## Publicação automática do launcher via GitHub Actions

Além do watcher de mods, o Pi roda um segundo serviço, `umucraft-launcher-pull`
(timer systemd, a cada 5 min), que fica de olho na release mais recente do
repositório no GitHub e publica sozinho em `www/launcher/`:

```
git: bump version + tag vX.Y.Z + push
  -> GitHub Actions (.github/workflows/release-launcher.yml) builda o .exe
     num runner windows-latest e publica como GitHub Release
  -> Pi (pull-launcher-release.py, via timer) detecta a release nova,
     baixa os assets e substitui www/launcher/ (sem SSH, sem porta aberta —
     o Pi so faz requisicoes de saida pra API publica do GitHub)
```

Isso mantém a mesma postura de segurança do resto do setup (Cloudflare
Tunnel, sem inbound): o Pi nunca recebe conexão de fora pra publicar,
só puxa.

**Deploy inicial desses dois arquivos num Pi já configurado** (sem
precisar rodar o `install.sh` inteiro de novo):

```bash
scp deploy/pi-server/pull-launcher-release.py deploy/pi-server/umucraft-launcher-pull.service deploy/pi-server/umucraft-launcher-pull.timer andrecodato@microlab:~/pi-server/
ssh andrecodato@microlab
sudo cp ~/pi-server/pull-launcher-release.py /srv/umucraft/pull-launcher-release.py
sudo chown andrecodato:andrecodato /srv/umucraft/pull-launcher-release.py
sudo sed "s#{{UMU_ROOT}}#/srv/umucraft#g; s#{{SAMBA_USER}}#andrecodato#g" ~/pi-server/umucraft-launcher-pull.service > /etc/systemd/system/umucraft-launcher-pull.service
sudo cp ~/pi-server/umucraft-launcher-pull.timer /etc/systemd/system/umucraft-launcher-pull.timer
sudo systemctl daemon-reload
sudo systemctl enable --now umucraft-launcher-pull.timer
```

**Pra publicar uma versão nova a partir daqui:**
```bash
# no repo, local
# 1. bump "version" em package.json e commit
git tag v1.0.1
git push origin v1.0.1
# 2. acompanhe o build em github.com/andrecodato/UmucraftLauncher/actions
# 3. em ate 5 min o Pi pega a release sozinho — ou force com:
#    ssh andrecodato@microlab sudo systemctl start umucraft-launcher-pull
```

---

## Painel admin

Uma página em `https://updates.SEUDOMINIO.com/admin/` (Flask + waitress,
`deploy/pi-server/admin/app.py`) que mostra, sem precisar de SSH:

- Estado dos serviços (`umucraft-watcher`, `umucraft-launcher-pull.timer`,
  `nginx`, `smbd`, `cloudflared`)
- Cada perfil do `manifest.json`: versão do MC/loader, versão dos mods,
  tamanho e data do `mods.zip`
- Final do log do `umucraft-watcher` e do `umucraft-launcher-pull`
- Botão **Forçar rebuild** por perfil — útil se você quer republicar sem
  esperar o debounce, ou depois de corrigir um mod com problema sem tocar
  em mais nenhum arquivo (o que não disparia o watcher sozinho)

O processo Flask/waitress escuta só em `127.0.0.1:8787` — nunca é exposto
direto, só via nginx com autenticação básica em `/admin/`.

**Deploy inicial num Pi já configurado** (sem rodar o `install.sh` de novo):

```bash
scp -r deploy/pi-server/admin andrecodato@microlab:~/pi-server/admin
scp deploy/pi-server/umucraft-admin.service deploy/pi-server/nginx-umucraft.conf andrecodato@microlab:~/pi-server/
ssh andrecodato@microlab

mkdir -p /srv/umucraft/admin
cp ~/pi-server/admin/app.py /srv/umucraft/admin/app.py
/srv/umucraft/venv/bin/pip install --quiet flask waitress

sudo cp ~/pi-server/nginx-umucraft.conf /etc/nginx/sites-available/umucraft.conf
sudo htpasswd -c /etc/nginx/.htpasswd-umucraft-admin admin   # cria a senha do painel
sudo nginx -t && sudo systemctl reload nginx

sudo sed "s#{{UMU_ROOT}}#/srv/umucraft#g; s#{{SAMBA_USER}}#andrecodato#g" ~/pi-server/umucraft-admin.service > /etc/systemd/system/umucraft-admin.service
sudo systemctl daemon-reload
sudo systemctl enable --now umucraft-admin
```

(`apache2-utils` precisa estar instalado pro comando `htpasswd` existir —
`sudo apt-get install -y apache2-utils` se ainda não tiver.)
