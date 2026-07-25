# CLAUDE.md

Guia rápido pra trabalhar neste repo. Visão geral do projeto, estrutura de
pastas e `manifest.json` já estão documentados em `README.md` — não repetir
aqui. Detalhes de infra do servidor (Pi, Samba, nginx, Cloudflare Tunnel)
ficam em `deploy/pi-server/README.md`.

## Comandos

```bash
npm run dev              # electron . --dev (com DevTools)
npm start                # electron .
npm run build             # instalador Windows (dist/)
npm run build:linux       # AppImage
npm run build:mac         # dmg
npm run publish-launcher  # build + publica no Pi na hora (fallback manual, veja abaixo)
```

Não há suíte de testes automatizada neste projeto ainda.

## Workflow de git

**Branches.** `main` é sempre a branch estável/publicável. Trabalho novo
(feature, fix, chore) vai numa branch a partir de `main`, nomeada por
prefixo: `feat/…`, `fix/…`, `chore/…`, `docs/…`. Merge de volta em `main`
via PR (squash ou merge commit, tanto faz — mas mantenha o título do PR
descritivo, ele vira entrada de changelog automaticamente, ver abaixo).

**Commits.** Mensagem no imperativo, título curto descrevendo o quê; corpo
(quando precisar) explica o *porquê*, não o *como* — o diff já mostra o
como. Sem prefixo `feat:`/`fix:` obrigatório no título do commit (o projeto
não seguiu isso até agora), mas é bem-vindo no título do PR.

**Versionamento.** SemVer em `package.json` → `version`. É a fonte única de
verdade: o workflow de release (`.github/workflows/release-launcher.yml`)
recusa o build se a tag não bater exatamente com esse valor.

## Releases do launcher (automatizado)

Não usa GitHub raw nem Dropbox pro `.exe` — é self-hosted no Pi, publicado
via git:

1. Bump `version` em `package.json`, commit em `main` (via PR ou direto)
2. `git tag vX.Y.Z && git push origin vX.Y.Z` — a tag precisa bater com o
   `version` do `package.json`, senão o workflow falha de propósito
3. GitHub Actions builda num runner `windows-latest` e publica uma
   **GitHub Release** com o `.exe`/`.blockmap`/`latest.yml`
   (`generate_release_notes: true` — o changelog da release é gerado
   sozinho a partir dos PRs/commits desde a tag anterior, por isso títulos
   de PR descritivos importam)
4. O Pi (`deploy/pi-server/pull-launcher-release.py`, timer systemd
   `umucraft-launcher-pull` a cada 5 min) detecta a release nova via API
   pública do GitHub e publica em `www/launcher/` sozinho — sem SSH, sem
   porta aberta, mesma postura "só conexão de saída" do resto do setup
   (Cloudflare Tunnel)
5. Players que já têm o launcher aberto recebem o update sozinhos no
   próximo restart (`electron-updater`, checagem no boot antes do Java)

`npm run publish-launcher` continua existindo como atalho manual — builda
local e sobe via SSH na hora, pulando a fila do Actions/timer. Útil pra
hotfix urgente.

Mods (`mods.zip`) seguem um fluxo totalmente separado e **não** passam por
git/GitHub Actions — é o `watcher.py` no Pi observando uma pasta de rede
(Samba), veja `deploy/pi-server/README.md`.

## Gotchas de infra já mordidos

- **Arquivo temporário → permissão restritiva → nginx 403.**
  `tempfile.mkstemp()` (Python) cria arquivo `0600` (só o dono lê). Se você
  gera um arquivo assim e faz `Path.replace()` pra publicá-lo em
  `www/`, o `nginx` (rodando como `www-data`) não consegue ler e devolve
  `403 Forbidden` — não `404`, o que engana na hora de debugar. Sempre
  `os.chmod(tmp_path, 0o644)` antes do rename final. Já mordeu o
  `watcher.py` (mods.zip) e foi corrigido preventivamente no
  `pull-launcher-release.py` também.

- **Assets de imagem brutos são pesados demais pra `src/assets/`.** Prints/
  renders (ex: banner 4K de referência do modpack) chegam na casa de
  10MB+ em PNG. Não commitar o arquivo bruto — ele infla o instalador
  (`files: ["src/**/*"]` no `package.json` empacota tudo). Redimensione
  pra resolução de exibição real (ex: 1920px de largura pra um hero de
  fundo) e exporte em JPEG de qualidade ~80-85 antes de comitar; a
  fonte bruta fica local e no `.gitignore`. Não há ImageMagick/ffmpeg
  disponível por padrão neste ambiente Windows — `System.Drawing` via
  PowerShell resolve sem instalar nada:
  ```powershell
  Add-Type -AssemblyName System.Drawing
  $img = [System.Drawing.Image]::FromFile("$src")
  $w = 1920; $h = [int]($img.Height * ($w / $img.Width))
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, $w, $h)
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq "image/jpeg"
  $p = New-Object System.Drawing.Imaging.EncoderParameters 1
  $p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [int64]82)
  $bmp.Save("$dst", $codec, $p)
  ```

- **Testando mudanças de UI no Electron neste ambiente.** Sem Playwright
  instalado e sem skill de `run` própria do projeto ainda. Pra
  verificar visualmente: `Start-Process cmd.exe -ArgumentList "/c","npm run dev > log 2>&1"`,
  achar o processo com `Get-Process | Where MainWindowTitle -ne ''`, e
  capturar a janela com `GetWindowRect` + `Graphics.CopyFromScreen`
  (Win32 via `Add-Type` no PowerShell). Funciona porque é um desktop
  Windows real (não headless) — considere gerar uma skill de `run` com
  `/run-skill-generator` se isso virar rotina. **Cuidado:** simular clique
  (`SetCursorPos`+`mouse_event`) toma o controle do mouse físico de
  verdade nessa máquina, não é um cursor virtual isolado — incomoda se o
  usuário estiver usando o PC ao mesmo tempo. Avise antes de automatizar
  cliques, ou prefira só ler logs/screenshot sem interagir.

- **`extras.zip`/`mods.zip` cacheados no Cloudflare com conteúdo velho.**
  O `nginx` não manda `Cache-Control`, então o Cloudflare aplica o cache
  padrão dele por extensão de arquivo (`.zip` entra nessa lista) mesmo sem
  header nenhum — por padrão ~4h (`max-age=14400`) na borda. Quando o
  `watcher.py` republica um zip novo no mesmo path, quem cai numa borda
  com cache quente ainda recebe os bytes velhos, com hash que não bate
  mais com o `manifest.json` → "MD5 inválido" no launcher. Fix: as URLs
  de `modsZipUrl`/`extrasZipUrl` levam `?v=<md5>` (query string entra na
  cache key do CF), então cada versão nova vira uma URL nova — cache miss
  garantido, sem depender de header nenhum. Se isso voltar a acontecer
  pra um perfil específico que ainda está com a URL antiga em cache (ex:
  o conteúdo não mudou desde que o fix foi deployado), forçar: tocar o
  mtime de qualquer arquivo dentro da pasta desse perfil (fora de `mods/`)
  já basta pra gerar um hash novo, já que o `zipfile` embute o mtime de
  cada entrada nos bytes do zip.

- **`watchdog`/inotify reemitindo "mudança" pra arquivo que não mudou.**
  Uma cópia grande via Samba (300+ mods + shaderpacks/resourcepacks/config)
  pode gerar mais eventos do que a fila do kernel aguenta
  (`fs.inotify.max_queued_events`, padrão 16384) — o kernel derruba
  eventos por overflow, e a lib `watchdog` reage refazendo uma varredura
  completa da árvore e reemitindo evento sintético pra cada arquivo
  existente, mesmo os que não mudaram. Sintoma: o log do watcher (visível
  no `/admin/`) enche de "mudança detectada" pro pack inteiro, em rajadas
  periódicas, mas o `mtime` real dos arquivos não mudou (confirmável com
  `stat`). Não corrompe nada (o rebuild só publica se o md5 realmente
  mudar), só desperdiça CPU/log. Fix: `deploy/pi-server/sysctl-umucraft.conf`
  sobe `max_queued_events`/`max_user_watches` — aplicado via
  `/etc/sysctl.d/99-umucraft-inotify.conf` (`install.sh` já faz isso em
  instalação nova).
