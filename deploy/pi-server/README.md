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
- **Publicar uma versão nova do launcher (.exe):** bump o `version` em `package.json` e rode `npm run publish-launcher` do seu PC — builda e sobe pro Pi (`\srv\umucraft\www\launcher\`) sozinho. Quem já tem o launcher aberto recebe a atualização e reinicia sozinho no próximo boot do app.

## Logs / troubleshooting

```bash
sudo journalctl -u umucraft-watcher -f
sudo journalctl -u cloudflared -f
sudo systemctl status nginx smbd umucraft-watcher cloudflared
```
