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
