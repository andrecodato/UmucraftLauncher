#!/usr/bin/env python3
"""Umucraft Launcher - watcher de auto-update de mods.

Observa staging/profiles/<Perfil>/mods/*.jar e staging/profiles/<Perfil>/instance.json.
A cada mudanca (com debounce): gera mods.zip + MD5, e se houver um instance.json
(export do ATLauncher), importa dele a versao do Minecraft, o loader (Forge/NeoForge/
Fabric/vanilla) e a versao do Java, publicando um version.json enxuto para o launcher
baixar. So os campos relacionados a mods/versao/loader sao tocados no manifest.json;
o resto (news, serverName, host, port, etc) fica intacto.
"""
import hashlib
import json
import logging
import os
import tempfile
import threading
import time
import urllib.parse
import zipfile
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

STAGING_DIR = Path(os.environ.get("UMU_STAGING_DIR", "/srv/umucraft/staging/profiles"))
WWW_DIR = Path(os.environ.get("UMU_WWW_DIR", "/srv/umucraft/www"))
PUBLIC_BASE_URL = os.environ.get("UMU_PUBLIC_BASE_URL", "http://localhost").rstrip("/")
DEBOUNCE_SECONDS = float(os.environ.get("UMU_DEBOUNCE_SECONDS", "20"))
MANIFEST_PATH = WWW_DIR / "manifest.json"

# Campos do version-json (formato Mojang) que o ATLauncher embute no topo do
# instance.json, ja mesclados com as libraries/mainClass/arguments do loader.
ATLAUNCHER_VERSION_FIELDS = (
    "id", "type", "time", "releaseTime", "minimumLauncherVersion",
    "assetIndex", "assets", "downloads", "logging", "libraries",
    "mainClass", "arguments", "complianceLevel", "javaVersion",
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("umucraft-watcher")


def zip_profile_mods(mods_dir: Path, dest_zip: Path) -> str:
    dest_zip.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(suffix=".zip", dir=str(dest_zip.parent))
    os.close(fd)
    tmp_path = Path(tmp_name)
    with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for jar in sorted(mods_dir.glob("*.jar")):
            zf.write(jar, arcname=jar.name)
    md5 = hashlib.md5(tmp_path.read_bytes()).hexdigest()
    tmp_path.replace(dest_zip)
    return md5


def load_manifest() -> dict:
    if MANIFEST_PATH.exists():
        try:
            return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.warning("manifest.json invalido, recriando do zero")
    return {"profiles": {}}


def save_manifest(manifest: dict) -> None:
    tmp_path = MANIFEST_PATH.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp_path.replace(MANIFEST_PATH)


def rebuild_mods_zip(profile_name: str, mods_dir: Path, profile: dict) -> bool:
    jars = sorted(mods_dir.glob("*.jar"))
    if not jars:
        log.info("[%s] pasta de mods vazia, nada a fazer", profile_name)
        return False

    dest_zip = WWW_DIR / "profiles" / profile_name / "mods.zip"
    md5 = zip_profile_mods(mods_dir, dest_zip)

    if profile.get("modsZipMd5") == md5:
        log.info("[%s] mods identicos ao ultimo build (md5 %s), pulando", profile_name, md5)
        return False

    profile["modsVersion"] = md5
    profile["modsZipMd5"] = md5
    profile["modsZipUrl"] = f"{PUBLIC_BASE_URL}/profiles/{urllib.parse.quote(profile_name)}/mods.zip"

    log.info("[%s] mods atualizados -> versao %s (%d mods)", profile_name, md5, len(jars))
    return True


def import_atlauncher_instance(profile_name: str, instance_path: Path, profile: dict) -> bool:
    try:
        data = json.loads(instance_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        log.warning("[%s] instance.json invalido, ignorando", profile_name)
        return False

    launcher = data.get("launcher")
    mc_version = data.get("id")
    if not launcher or not mc_version:
        log.warning("[%s] instance.json nao parece ser um export do ATLauncher, ignorando", profile_name)
        return False

    loader_info = launcher.get("loaderVersion") or {}
    loader_type = loader_info.get("type")
    loader = "vanilla" if launcher.get("vanillaInstance") or not loader_type else loader_type.lower()
    loader_version = loader_info.get("version") if loader != "vanilla" else None
    java_major = (data.get("javaVersion") or {}).get("majorVersion")

    lean = {k: data[k] for k in ATLAUNCHER_VERSION_FIELDS if k in data}
    lean_bytes = json.dumps(lean, indent=2, ensure_ascii=False).encode("utf-8")
    version_md5 = hashlib.md5(lean_bytes).hexdigest()

    changed = (
        profile.get("minecraftVersion") != mc_version
        or profile.get("loader") != loader
        or profile.get("loaderVersion") != loader_version
        or profile.get("javaMajor") != java_major
        or profile.get("versionJsonMd5") != version_md5
    )
    if not changed:
        log.info("[%s] instance.json identico ao ultimo import, pulando", profile_name)
        return False

    version_json_path = WWW_DIR / "profiles" / profile_name / "version.json"
    version_json_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = version_json_path.with_suffix(".json.tmp")
    tmp_path.write_bytes(lean_bytes)
    tmp_path.replace(version_json_path)

    profile["minecraftVersion"] = mc_version
    profile["loader"] = loader
    profile["loaderVersion"] = loader_version
    if java_major:
        profile["javaMajor"] = java_major
    profile["versionJsonUrl"] = f"{PUBLIC_BASE_URL}/profiles/{urllib.parse.quote(profile_name)}/version.json"
    profile["versionJsonMd5"] = version_md5

    log.info("[%s] instance.json importado -> mc %s, loader %s %s",
              profile_name, mc_version, loader, loader_version or "")
    return True


def rebuild_profile(profile_name: str) -> None:
    profile_dir = STAGING_DIR / profile_name
    manifest = load_manifest()
    profiles = manifest.setdefault("profiles", {})
    profile = profiles.setdefault(profile_name, {})
    changed = False

    mods_dir = profile_dir / "mods"
    if mods_dir.is_dir():
        changed = rebuild_mods_zip(profile_name, mods_dir, profile) or changed

    instance_path = profile_dir / "instance.json"
    if instance_path.is_file():
        changed = import_atlauncher_instance(profile_name, instance_path, profile) or changed

    if changed:
        save_manifest(manifest)


class DebouncedRebuilder:
    def __init__(self, delay: float):
        self.delay = delay
        self._timers = {}
        self._lock = threading.Lock()

    def schedule(self, profile_name: str) -> None:
        with self._lock:
            existing = self._timers.get(profile_name)
            if existing:
                existing.cancel()
            timer = threading.Timer(self.delay, self._fire, args=(profile_name,))
            timer.daemon = True
            self._timers[profile_name] = timer
            timer.start()

    def _fire(self, profile_name: str) -> None:
        with self._lock:
            self._timers.pop(profile_name, None)
        try:
            rebuild_profile(profile_name)
        except Exception:
            log.exception("[%s] falha ao reconstruir", profile_name)


class ModsHandler(FileSystemEventHandler):
    def __init__(self, rebuilder: DebouncedRebuilder):
        self.rebuilder = rebuilder

    def _profile_from_path(self, path: str):
        try:
            rel = Path(path).relative_to(STAGING_DIR)
        except ValueError:
            return None
        parts = rel.parts
        if len(parts) >= 2 and parts[1] == "mods" and path.endswith(".jar"):
            return parts[0]
        if len(parts) == 2 and parts[1] == "instance.json":
            return parts[0]
        return None

    def on_any_event(self, event):
        if event.is_directory:
            return
        profile_name = self._profile_from_path(event.src_path)
        if profile_name:
            log.info("[%s] mudanca detectada: %s", profile_name, os.path.basename(event.src_path))
            self.rebuilder.schedule(profile_name)


def main():
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    WWW_DIR.mkdir(parents=True, exist_ok=True)
    (WWW_DIR / "maps").mkdir(parents=True, exist_ok=True)

    rebuilder = DebouncedRebuilder(DEBOUNCE_SECONDS)
    handler = ModsHandler(rebuilder)
    observer = Observer()
    observer.schedule(handler, str(STAGING_DIR), recursive=True)
    observer.start()
    log.info("Observando %s (debounce %.0fs) -> publicando em %s", STAGING_DIR, DEBOUNCE_SECONDS, PUBLIC_BASE_URL)

    # Builda uma vez no start, cobre o caso de mods/instance.json ja estarem la antes do servico subir
    for entry in STAGING_DIR.iterdir():
        if entry.is_dir():
            rebuilder.schedule(entry.name)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
