#!/usr/bin/env python3
"""Umucraft Launcher - puller de releases do GitHub.

Roda periodicamente (via systemd timer) e checa a release publica mais
recente de GITHUB_REPO. Se for mais nova que a ja publicada, baixa os
assets (o instalador .exe, o .blockmap e o latest.yml gerados pelo
electron-builder) para WWW_DIR/launcher, sobrescrevendo a versao anterior.

So funciona com repositorio publico: usa a API de releases sem
autenticacao (limite de 60 req/h por IP, tranquilo pra rodar a cada
poucos minutos). O workflow que publica a release fica em
.github/workflows/release-launcher.yml no repo.
"""
import json
import logging
import os
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

GITHUB_REPO = os.environ.get("UMU_GITHUB_REPO", "andrecodato/UmucraftLauncher")
WWW_DIR = Path(os.environ.get("UMU_WWW_DIR", "/srv/umucraft/www"))
LAUNCHER_DIR = WWW_DIR / "launcher"
STATE_PATH = LAUNCHER_DIR / ".release-tag"
API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
REQUEST_HEADERS = {
    "User-Agent": "umucraft-launcher-puller",
    "Accept": "application/vnd.github+json",
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("umucraft-launcher-pull")


def fetch_latest_release() -> dict:
    req = urllib.request.Request(API_URL, headers=REQUEST_HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(suffix=".part", dir=str(dest.parent))
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        req = urllib.request.Request(url, headers=REQUEST_HEADERS)
        with urllib.request.urlopen(req, timeout=120) as resp, open(tmp_path, "wb") as f:
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
        # mkstemp() cria o arquivo 0600 (so o dono le); nginx (www-data)
        # precisa ler, entao libera antes do rename (mesmo bug que ja
        # mordeu o mods.zip do watcher.py).
        os.chmod(tmp_path, 0o644)
        tmp_path.replace(dest)
    finally:
        tmp_path.unlink(missing_ok=True)


def sync_release(release: dict) -> None:
    tag = release["tag_name"]
    assets = release.get("assets", [])
    wanted = [a for a in assets if a["name"].endswith((".exe", ".blockmap", ".yml", ".AppImage"))]
    if not wanted:
        log.warning("Release %s nao tem assets de launcher (.exe/.blockmap/.yml/.AppImage), ignorando", tag)
        return

    log.info("Nova release %s, baixando %d asset(s)...", tag, len(wanted))
    new_names = set()
    for asset in wanted:
        name = asset["name"]
        new_names.add(name)
        log.info("Baixando %s...", name)
        download(asset["browser_download_url"], LAUNCHER_DIR / name)

    # Limpa versoes antigas pra nao acumular instalador velho no disco.
    if LAUNCHER_DIR.is_dir():
        for existing in LAUNCHER_DIR.iterdir():
            if existing.name in new_names or existing.name == STATE_PATH.name:
                continue
            if existing.suffix in (".exe", ".blockmap", ".yml", ".AppImage"):
                existing.unlink()

    STATE_PATH.write_text(tag, encoding="utf-8")
    log.info("Release %s publicada em %s", tag, LAUNCHER_DIR)


def main() -> None:
    LAUNCHER_DIR.mkdir(parents=True, exist_ok=True)
    current_tag = STATE_PATH.read_text(encoding="utf-8").strip() if STATE_PATH.exists() else None

    try:
        release = fetch_latest_release()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            log.info("Repositorio %s ainda nao tem nenhuma release publicada.", GITHUB_REPO)
        else:
            log.error("Falha ao consultar a API do GitHub: HTTP %s", e.code)
        return
    except urllib.error.URLError as e:
        log.error("Falha ao consultar a API do GitHub: %s", e.reason)
        return

    latest_tag = release.get("tag_name")
    if not latest_tag:
        log.warning("Resposta da API sem tag_name, ignorando.")
        return

    if latest_tag == current_tag:
        log.info("Ja estamos na release %s, nada a fazer.", current_tag)
        return

    log.info("Release atual: %s -> nova: %s", current_tag or "nenhuma", latest_tag)
    sync_release(release)


if __name__ == "__main__":
    main()
