# 🎮 UmuCraft Launcher

Launcher personalizado para servidor Minecraft Forge com **auto-update de mods**, seleção de RAM, download automático de Java, ping de servidores e integração com Discord.

Construído com **Electron 28** — interface moderna com sidebar, 6 abas (Home, Mods, Servers, Dicas, Discord, Configurações) e sistema de bootstrap para instalação automática do Java.

---

## 🚀 Como usar (jogadores)

1. Baixe o instalador (`.exe` no Windows, `.AppImage` no Linux)
2. Instale normalmente
3. Abra o launcher — o Java será detectado/instalado automaticamente
4. Coloque seu nickname e clique **JOGAR**
5. Os mods são sincronizados automaticamente!

---

## 📂 Estrutura do Projeto

```
src/
├── main/                          # Processo principal (Electron/Node.js - CommonJS)
│   ├── index.js                   # Entry point — lifecycle do app + bootstrap
│   ├── state.js                   # Estado compartilhado (mainWindow, javaPath, etc.)
│   ├── preload.js                 # Bridge IPC para janela principal
│   ├── bootstrap-preload.js       # Bridge IPC para janela de bootstrap
│   ├── bootstrap/                 # Sistema de detecção/instalação do Java
│   │   ├── controller.js          #   Máquina de estados (detect → install → validate)
│   │   ├── detector.js            #   Detecção de executáveis Java
│   │   ├── installer.js           #   Download/extração do Adoptium JDK
│   │   └── logger.js              #   Log de bootstrap + eventos IPC
│   ├── ipc/                       # Handlers IPC separados por domínio
│   │   ├── windowIpc.js           #   Minimize, maximize, close
│   │   ├── bootstrapIpc.js        #   Retry, open-logs
│   │   ├── configIpc.js           #   Load/save config.json
│   │   ├── launcherIpc.js         #   Fetch manifest, sync-and-launch
│   │   ├── serverIpc.js           #   Ping de servidores MC
│   │   └── utilIpc.js             #   Open folder, open external, browse dir, system info
│   ├── services/                  # Lógica de negócio pura
│   │   ├── profileService.js      #   Criação do perfil padrão + download do client MC
│   │   ├── manifestService.js     #   Fetch do manifest remoto
│   │   ├── modSyncService.js      #   Sincronização de mods (download zip + verificação MD5 + extração)
│   │   ├── minecraftLauncher.js   #   Resolução de Java + spawn do Minecraft
│   │   └── serverPingService.js   #   Ping TCP do protocolo MC
│   ├── utils/                     # Utilitários reutilizáveis
│   │   ├── paths.js               #   BASE_DIR, constantes, ensureDirectories
│   │   ├── ipcSender.js           #   send() e log() para o renderer
│   │   ├── download.js            #   Download de arquivos com progresso
│   │   ├── http.js                #   HTTP GET JSON com redirect
│   │   └── fileHash.js            #   Hash MD5 de arquivos
│   └── windows/                   # Criação de janelas
│       ├── mainWindow.js          #   Janela principal (960×640)
│       └── bootstrapWindow.js     #   Janela de bootstrap (520×400)
│
├── renderer/                      # Interface do usuário (ES Modules)
│   ├── index.html                 # Shell HTML com 6 abas
│   ├── bootstrap.html             # HTML da janela de bootstrap
│   ├── bootstrap-renderer.js      # Lógica da janela de bootstrap
│   ├── helpers.js                 # $(), logLine(), escapeHtml()
│   ├── app/
│   │   └── init.js                # Entry point — inicialização da UI
│   ├── store/
│   │   └── state.js               # Estado reativo (config, manifest, sysInfo)
│   ├── data/                      # Dados estáticos
│   │   ├── servers.js             #   Lista de servidores
│   │   ├── tips.js                #   Dicas/vídeos
│   │   └── discord.js             #   Link do Discord
│   ├── services/                  # Comunicação com o main process
│   │   ├── configService.js       #   Apply/collect config da UI
│   │   ├── manifestClient.js      #   Fetch + populate manifest na UI
│   │   └── ipcBridge.js           #   Listeners de eventos IPC
│   ├── components/                # Componentes reutilizáveis
│   │   ├── titlebar.js            #   Barra de título (minimize/maximize/close)
│   │   ├── sidebar.js             #   Navegação lateral de abas
│   │   ├── loadingOverlay.js      #   Overlay de carregamento
│   │   └── serverCard.js          #   Card de servidor (create/update)
│   ├── pages/                     # Lógica por aba
│   │   ├── homePage.js            #   Home — launch, perfil, username
│   │   ├── modsPage.js            #   Mods — grid agrupada por modpack
│   │   ├── serversPage.js         #   Servers — ping + status
│   │   ├── tipsPage.js            #   Dicas — grid por categoria
│   │   ├── discordPage.js         #   Discord — botão de convite
│   │   └── settingsPage.js        #   Config — RAM, diretório, Java
│   └── styles/                    # CSS modular
│       ├── variables.css           #   Custom properties (cores, fontes, dimensões)
│       ├── base.css                #   Reset, scrollbar, empty state, status dot
│       ├── loading.css             #   Overlay de carregamento
│       ├── titlebar.css            #   Barra de título
│       ├── sidebar.css             #   Sidebar de navegação
│       ├── layout.css              #   Content area + tabs
│       ├── home.css                #   Hero, badges, launch, progress
│       ├── forms.css               #   Inputs, selects, sliders, botões
│       ├── mods.css                #   Grid de mods
│       ├── servers.css             #   Cards de servidores
│       ├── tips.css                #   Cards de dicas
│       ├── discord.css             #   Página do Discord
│       └── settings.css            #   Formulário de configurações
│
└── assets/                        # Ícones do app
    └── icon.png / icon.ico
```

---

## ⚙️ Setup para admins do servidor

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar a URL do manifesto

Edite `src/main/utils/paths.js`, objeto `CONFIG`:

```js
const CONFIG = {
  MANIFEST_URL: 'https://SUA_URL/manifest.json',
  DEFAULT_PROFILE: 'Default',
};
```

**Opções de hospedagem:**
- **Dropbox:** Crie um link de compartilhamento e troque `?dl=0` por `?dl=1`
- **GitHub Raw:** `https://raw.githubusercontent.com/usuario/repo/main/manifest.json`
- **Servidor próprio:** Qualquer URL HTTP/HTTPS pública

### 3. Configurar servidores

Edite `src/renderer/data/servers.js`:

```js
export const SERVERS = [
  { name: 'Meu Servidor Modded', host: 'mc.meuserver.com', port: 25565 },
  { name: 'Meu Servidor Vanilla', host: 'vanilla.meuserver.com', port: 25565 },
];
```

### 4. Criar o pacote de mods (.zip)

1. Coloque todos os `.jar` de mods numa pasta
2. Compacte tudo num `.zip` (ex: `mods.zip`)
3. Suba o `mods.zip` no **Dropbox** e pegue o link compartilhável
   - Troque `?dl=0` por `?dl=1` no final do link

### 5. Gerar o manifest.json

```bash
node scripts/generate-manifest.js ./mods.zip "https://www.dropbox.com/scl/fi/XXX/mods.zip?rlkey=YYY&dl=1"
```

Isso gera o `manifest.json` com a versão, link do Dropbox e MD5 do zip.

Para especificar versão e perfil:
```bash
node scripts/generate-manifest.js ./mods.zip "URL_DROPBOX" ./manifest.json "Default" "1.0.1"
```

### 6. Hospedar o manifest.json no GitHub

1. Crie um repositório no GitHub (público)
2. Faça upload do `manifest.json`
3. Use a URL raw como `MANIFEST_URL`:

```
https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPO/main/manifest.json
```

---

## 🔄 Como atualizar mods

1. Atualize os `.jar` na sua pasta de mods
2. Compacte tudo num novo `mods.zip`
3. Suba o novo zip no Dropbox (mesmo link ou novo)
4. Rode o script com uma versão nova:
   ```bash
   node scripts/generate-manifest.js ./mods.zip "URL_DROPBOX" ./manifest.json "Default" "1.0.1"
   ```
5. Faça push do `manifest.json` atualizado no GitHub

Na próxima vez que um player abrir o launcher, o pacote de mods será baixado e substituído automaticamente!

---

## 🏗️ Estrutura do manifest.json

```json
{
  "serverName": "Meu Servidor",
  "description": "Descrição que aparece no launcher",
  "tags": ["Forge 1.20.1", "Survival"],

  "profiles": {
    "Nome do Perfil": {
      "minecraftVersion": "1.20.1",
      "forgeVersion": "47.2.0",
      "modsVersion": "1.0.0",
      "modsZipUrl": "https://www.dropbox.com/scl/fi/.../mods.zip?rlkey=...&dl=1",
      "modsZipMd5": "hash_md5_do_zip"
    }
  },

  "news": [
    {
      "title": "Título da notícia",
      "date": "2024-03-10",
      "tag": "update",
      "pinned": true,
      "body": "Texto da notícia"
    }
  ]
}
```

**Tags de notícia disponíveis:** `update`, `maintenance`, `event`, `info`

---

## 🔨 Build (gerar instalador)

```bash
# Windows
npm run build

# Linux
npm run build:linux

# macOS
npm run build:mac
```

O instalador será gerado na pasta `dist/`.

---

## 🛠️ Desenvolvimento

```bash
# Iniciar em modo dev (com DevTools)
npm run dev

# Iniciar normalmente
npm start
```

---

## ☕ Java automático

O launcher detecta e instala automaticamente o Java através do sistema de bootstrap:

1. Ao abrir, uma janela de bootstrap verifica o Java instalado
2. Se não encontrar uma versão compatível, baixa o Adoptium JDK automaticamente
3. Após validação, abre o launcher principal

| Minecraft | Java |
|-----------|------|
| 1.17–1.19 | Java 17 |
| 1.20–1.21 | Java 21 |

Os players **não precisam instalar o Java** manualmente.

---

## 📁 Pastas de dados (`~/.UmuCraft/`)

| Pasta | Conteúdo |
|-------|---------|
| `java/` | Java gerenciado pelo launcher (Adoptium JDK) |
| `versions/` | Versões do Minecraft (client jars + JSONs) |
| `mods/` | Mods sincronizados |
| `modpacks/` | Modpacks |
| `libraries/` | Bibliotecas do Minecraft/Forge |
| `assets/` | Assets do Minecraft |
| `cache/` | Manifest em cache (offline fallback) |
| `config/` | Configurações de mods |
| `logs/` | Logs (bootstrap.log) |
| `config.json` | Configurações do player (username, RAM, perfil) |

---

## 🏛️ Arquitetura

O projeto segue uma **arquitetura modular por camadas**:

- **Main Process** (CommonJS): `index.js` → `windows/` → `ipc/` → `services/` → `utils/`
- **Renderer** (ES Modules): `app/init.js` → `pages/` → `components/` + `services/` → `store/` + `data/`
- **IPC Bridge**: `preload.js` expõe `window.launcher.*` com ~15 métodos seguros via `contextBridge`
- **Estilos**: 12 arquivos CSS modulares importados no `index.html`

---

## ❓ FAQ

**Os players precisam instalar o Forge?**  
Sim, o Forge deve ser instalado via o instalador oficial uma vez. O launcher apenas sincroniza os mods.

**O launcher funciona com conta pirata?**  
Sim, usa autenticação offline por padrão. O servidor precisa ter `online-mode=false`.

**Como adicionar múltiplos perfis?**  
Adicione mais entradas em `profiles` no manifest.json. O player pode trocar pelo dropdown no launcher.

**Como adicionar novos servidores no launcher?**  
Edite `src/renderer/data/servers.js` e adicione objetos `{ name, host, port }`.

**Onde configuro o link do Discord?**  
Edite `src/renderer/data/discord.js`.

**Como adicionar novas dicas/vídeos?**  
Edite `src/renderer/data/tips.js` — cada entrada tem `title`, `thumbnail`, `url` e `category`.
