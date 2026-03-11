# 🎮 MyServer Launcher

Launcher personalizado para servidor Minecraft Forge com **auto-update de mods**, seleção de RAM, download automático de Java e painel de notícias.

---

## 🚀 Como usar (jogadores)

1. Baixe o instalador (`.exe` no Windows, `.AppImage` no Linux)
2. Instale normalmente
3. Abra o launcher, coloque seu nickname e clique **JOGAR**
4. Os mods são sincronizados automaticamente!

---

## ⚙️ Setup para admins do servidor

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar a URL do manifesto

Edite `src/main/main.js`, linha com `MANIFEST_URL`:

```js
MANIFEST_URL: 'https://SUA_URL/manifest.json',
```

**Opções de hospedagem:**
- **Dropbox:** Crie um link de compartilhamento e troque `?dl=0` por `?dl=1`
- **GitHub Raw:** `https://raw.githubusercontent.com/usuario/repo/main/manifest.json`
- **Servidor próprio:** Qualquer URL HTTP/HTTPS pública

### 3. Gerar o manifest.json

```bash
# Coloque seus mods na pasta ./mods
node scripts/generate-manifest.js ./mods ./manifest.json "Survival Tech"
```

Isso vai gerar o `manifest.json` com os MD5s de todos os mods.

### 4. Adicionar URLs dos mods

Abra o `manifest.json` gerado e preencha a `url` de cada mod:

```json
{
  "name": "Create",
  "filename": "create-1.20.1-0.5.1.f.jar",
  "md5": "abc123...",
  "url": "https://www.dropbox.com/...?dl=1"
}
```

### 5. Hospedar o manifest.json

Faça upload do `manifest.json` para o Dropbox/GitHub e use o link como `MANIFEST_URL`.

**Formato do link Dropbox:**
```
https://www.dropbox.com/scl/fi/XXXXX/manifest.json?rlkey=XXXXX&dl=1
```

---

## 🔄 Como atualizar mods

1. Substitua o `.jar` na sua pasta de mods
2. Rode novamente:
   ```bash
   node scripts/generate-manifest.js ./mods ./manifest.json "Survival Tech"
   ```
3. Preencha a nova URL no manifest
4. Faça upload do `manifest.json` atualizado

Na próxima vez que um player abrir o launcher, os mods serão baixados automaticamente!

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
      "mods": [
        {
          "name": "Nome amigável",
          "filename": "arquivo.jar",
          "version": "1.0.0",
          "md5": "hash_md5_do_arquivo",
          "url": "url_direta_para_download"
        }
      ]
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

## ☕ Java automático

O launcher baixa e gerencia automaticamente o Java correto:

| Minecraft | Java |
|-----------|------|
| 1.17–1.19 | Java 17 |
| 1.20–1.21 | Java 21 |

Os players **não precisam instalar o Java** manualmente.

---

## 📁 Pastas importantes

| Pasta | Conteúdo |
|-------|---------|
| `~/.minecraft-custom-launcher/java/` | Java gerenciado pelo launcher |
| `~/.minecraft-custom-launcher/cache/` | Manifest em cache |
| `~/.minecraft-custom-launcher/config.json` | Configurações do player |

---

## ❓ FAQ

**Os players precisam instalar o Forge?**  
Sim, o Forge deve ser instalado via o instalador oficial uma vez. O launcher apenas sincroniza os mods.

**O launcher funciona com conta pirata?**  
Sim, basta usar modo offline. O servidor precisa ter `online-mode=false`.

**Como adicionar múltiplos perfis?**  
Adicione mais entradas em `profiles` no manifest.json. O player pode trocar pelo dropdown no launcher.
