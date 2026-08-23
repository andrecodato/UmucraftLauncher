#!/usr/bin/env python3
"""Umucraft Launcher - watcher de auto-update de mods.

Observa staging/profiles/<Perfil>/ inteira. A cada mudanca (com debounce):

1. Se houver um *.zip na raiz do perfil (pratica rapida via Samba/VPN —
   um arquivo so sobe bem mais rapido que milhares de .jar), extrai
   mods/, instance.json e extras pra pasta do perfil; o zip fonte fica
   la e e ignorado no extras.zip.
2. Gera mods.zip + MD5 a partir de mods/*.jar.
3. Se houver instance.json (export ATLauncher), importa MC/loader/Java e
   publica version.json + mods-list.json.
4. Empacota o resto (config/, shaderpacks/, options.txt, etc) em extras.zip.

So os campos de mods/versao/loader/extras sao tocados no manifest.json;
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
from typing import Optional

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

# "extras" = tudo que o pack owner solta na pasta do perfil alem de mods/
# (que ja tem seu proprio zip + lista) e instance.json (que e importado, nao
# reenviado como esta): config/, shaderpacks/, resourcepacks/, options.txt,
# servers.dat, etc. Sem lista fixa de nomes suportados — qualquer coisa nova
# solta ali junto flui sozinha pro player no proximo sync.
# *.zip na raiz do perfil e o pack fonte (upload rapido) — nunca vai pro extras.
EXTRAS_EXCLUDE_TOP = {"mods", "instance.json", "saves", "logs", "crash-reports", "screenshots"}
EXTRAS_EXCLUDE_NAMES = {".DS_Store", "Thumbs.db"}
PACK_ZIP_SKIP_TOP = {"saves", "logs", "crash-reports", "screenshots"}

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("umucraft-watcher")


def is_real_profile_name(name: str) -> bool:
    """Ignora lixo do SMB/Windows (ex: .::TMPNAME:...) e arquivos ocultos."""
    if not name or name.startswith("."):
        return False
    if "TMPNAME" in name or "::" in name:
        return False
    return True


def find_pack_zip(profile_dir: Path) -> Optional[Path]:
    """Maior *.zip na raiz do perfil (upload unico do pack). Ignora vazios."""
    zips = [
        p for p in profile_dir.glob("*.zip")
        if p.is_file() and p.stat().st_size > 0
    ]
    if not zips:
        return None
    # Preferencia: nome tipico; senao o mais recente por mtime.
    preferred = [p for p in zips if p.name.lower() in ("modpack.zip", "pack.zip", "instance.zip")]
    pool = preferred or zips
    return max(pool, key=lambda p: p.stat().st_mtime)


def zip_upload_stable(path: Path, checks: int = 3, interval: float = 2.0) -> bool:
    """True se o tamanho do arquivo nao mudou entre checks (upload Samba acabou)."""
    try:
        sizes = []
        for i in range(checks):
            sizes.append(path.stat().st_size)
            if i + 1 < checks:
                time.sleep(interval)
        return len(set(sizes)) == 1 and sizes[0] > 0
    except OSError:
        return False


def detect_zip_root_prefix(names: list[str]) -> str:
    """Se o zip tem uma pasta wrapper unica (ATLauncher/export comum), devolve
    'Pasta/' pra strip; senao string vazia (membros ja na raiz)."""
    tops = set()
    has_interesting_under = False
    for raw in names:
        name = raw.replace("\\", "/")
        if not name or name.endswith("/"):
            continue
        parts = name.split("/")
        if len(parts) == 1 and parts[0] == "instance.json":
            return ""
        if len(parts) == 2 and parts[0] == "mods":
            return ""
        if len(parts) >= 2 and parts[1] in ("mods", "instance.json", "config", "shaderpacks", "resourcepacks"):
            has_interesting_under = True
        tops.add(parts[0])
    if len(tops) == 1 and has_interesting_under:
        return next(iter(tops)) + "/"
    return ""


def unpack_pack_zip(profile_name: str, profile_dir: Path, rebuilder: Optional["DebouncedRebuilder"] = None) -> bool:
    """Extrai o zip fonte do pack pra pasta do perfil. Retorna True se extraiu."""
    pack_zip = find_pack_zip(profile_dir)
    if pack_zip is None:
        return False

    if not zip_upload_stable(pack_zip):
        log.info("[%s] %s ainda esta sendo escrito (tamanho mudando), reagendando",
                 profile_name, pack_zip.name)
        if rebuilder is not None:
            rebuilder.schedule(profile_name)
        return False

    if not zipfile.is_zipfile(pack_zip):
        log.warning("[%s] %s nao e um zip valido ainda (upload incompleto?), reagendando",
                    profile_name, pack_zip.name)
        if rebuilder is not None:
            rebuilder.schedule(profile_name)
        return False

    marker = profile_dir / f".pack-zip-{pack_zip.name}.stamp"
    st = pack_zip.stat()
    stamp = f"{st.st_size}:{int(st.st_mtime_ns)}\n"
    if marker.is_file() and marker.read_text(encoding="utf-8") == stamp:
        log.info("[%s] pack zip %s ja extraido (size/mtime iguais), pulando unpack",
                 profile_name, pack_zip.name)
        return False

    log.info("[%s] extraindo pack zip %s (%.1f MB)...",
             profile_name, pack_zip.name, st.st_size / (1024 * 1024))

    extracted = 0
    try:
        with zipfile.ZipFile(pack_zip, "r") as zf:
            names = zf.namelist()
            prefix = detect_zip_root_prefix(names)
            for info in zf.infolist():
                if info.is_dir():
                    continue
                raw = info.filename.replace("\\", "/")
                if prefix and raw.startswith(prefix):
                    rel = raw[len(prefix):]
                else:
                    rel = raw
                if not rel or rel.endswith("/"):
                    continue
                parts = Path(rel).parts
                if not parts:
                    continue
                if parts[0] in PACK_ZIP_SKIP_TOP:
                    continue
                if parts[0].startswith("."):
                    continue
                if Path(rel).name in EXTRAS_EXCLUDE_NAMES:
                    continue
                # Nunca extrair o proprio zip nem paths absolutos/traversal
                if ".." in parts or Path(rel).is_absolute():
                    continue

                dest = profile_dir / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info, "r") as src, open(dest, "wb") as out:
                    while True:
                        chunk = src.read(1024 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
                extracted += 1
    except zipfile.BadZipFile:
        log.warning("[%s] %s corrompido/incompleto, reagendando", profile_name, pack_zip.name)
        if rebuilder is not None:
            rebuilder.schedule(profile_name)
        return False

    marker.write_text(stamp, encoding="utf-8")
    log.info("[%s] pack zip extraido: %d arquivo(s) -> %s", profile_name, extracted, profile_dir)
    return extracted > 0


def zip_profile_mods(mods_dir: Path, dest_zip: Path) -> str:
    dest_zip.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(suffix=".zip", dir=str(dest_zip.parent))
    os.close(fd)
    tmp_path = Path(tmp_name)
    with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for jar in sorted(mods_dir.glob("*.jar")):
            zf.write(jar, arcname=jar.name)

    # read_bytes() would load the whole zip into memory at once — fine for a
    # small pack, but a few hundred MB of mods.zip on a host with ~2GB RAM
    # (typical Proxmox LXC) trips the OOM killer (seen in production with a
    # 300-mod/~650MB pack). Hash incrementally instead so peak memory stays
    # at one chunk.
    hasher = hashlib.md5()
    with open(tmp_path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            hasher.update(chunk)
    md5 = hasher.hexdigest()

    # mkstemp() creates the file 0600 (owner-only); nginx (www-data) needs to
    # read it, so open it up before the rename replaces the public mods.zip.
    os.chmod(tmp_path, 0o644)
    tmp_path.replace(dest_zip)
    return md5


def zip_profile_extras(profile_dir: Path, dest_zip: Path) -> Optional[str]:
    """Zips everything in the profile staging folder except mods/ (own zip +
    list) and instance.json (imported, not shipped raw) — config/,
    shaderpacks/, resourcepacks/, options.txt, servers.dat, whatever the pack
    owner drops there. Returns None (and writes nothing) if there's nothing
    to ship, so a profile with no extras doesn't get a stray empty zip."""
    entries = []
    for path in profile_dir.rglob("*"):
        if path.is_dir():
            continue
        rel = path.relative_to(profile_dir)
        if rel.parts[0] in EXTRAS_EXCLUDE_TOP:
            continue
        if path.name in EXTRAS_EXCLUDE_NAMES:
            continue
        # Pack fonte (upload unico) e marcadores internos — nao vao pro player.
        if len(rel.parts) == 1 and path.suffix.lower() == ".zip":
            continue
        if len(rel.parts) == 1 and path.name.startswith(".pack-zip-"):
            continue
        entries.append((path, rel))

    if not entries:
        return None

    dest_zip.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(suffix=".zip", dir=str(dest_zip.parent))
    os.close(fd)
    tmp_path = Path(tmp_name)
    with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, rel in sorted(entries, key=lambda e: e[1].as_posix()):
            zf.write(path, arcname=str(rel))

    hasher = hashlib.md5()
    with open(tmp_path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            hasher.update(chunk)
    md5 = hasher.hexdigest()

    # Same nginx-403-from-0600-tempfile gotcha as zip_profile_mods.
    os.chmod(tmp_path, 0o644)
    tmp_path.replace(dest_zip)
    return md5


def rebuild_extras_zip(profile_name: str, profile_dir: Path, profile: dict) -> bool:
    dest_zip = WWW_DIR / "profiles" / profile_name / "extras.zip"
    md5 = zip_profile_extras(profile_dir, dest_zip)
    if md5 is None:
        return False

    if profile.get("extrasZipMd5") == md5:
        log.info("[%s] extras identicos ao ultimo build (md5 %s), pulando", profile_name, md5)
        return False

    profile["extrasVersion"] = md5
    profile["extrasZipMd5"] = md5
    # ?v=<md5> cache-busts Cloudflare's edge cache: nginx sends no
    # Cache-Control for static extensions like .zip, so CF's default
    # per-extension caching serves whatever it last fetched for this exact
    # URL — stale bytes for several hours after a rebuild, even though
    # extras.zip on disk and manifest.json are already the new version.
    # Query string is part of CF's cache key, so a new hash always means a
    # fresh URL and a guaranteed cache miss against the old content.
    profile["extrasZipUrl"] = (
        f"{PUBLIC_BASE_URL}/profiles/{urllib.parse.quote(profile_name)}/extras.zip?v={md5}"
    )

    log.info("[%s] extras (config/shaders/etc) atualizados -> versao %s", profile_name, md5)
    return True


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
    # See the matching comment in rebuild_extras_zip: ?v=<md5> cache-busts
    # Cloudflare's edge cache against the same URL serving stale bytes.
    profile["modsZipUrl"] = (
        f"{PUBLIC_BASE_URL}/profiles/{urllib.parse.quote(profile_name)}/mods.zip?v={md5}"
    )

    log.info("[%s] mods atualizados -> versao %s (%d mods)", profile_name, md5, len(jars))
    return True


def build_mods_list(mods: list) -> list:
    """Lean, display-ready mod list from ATLauncher's launcher.mods — name,
    version, description, author(s) and a CurseForge/Modrinth icon when the
    mod has one. Skips mods the pack owner disabled in ATLauncher."""
    result = []
    for mod in mods:
        if mod.get("disabled"):
            continue
        cf = mod.get("curseForgeProject") or {}
        modrinth = mod.get("modrinthProject") or {}
        icon_url = (cf.get("logo") or {}).get("thumbnailUrl") or modrinth.get("icon_url") or ""
        authors = [a.get("name") for a in cf.get("authors", []) if a.get("name")]
        result.append({
            "name": mod.get("name") or mod.get("file") or "?",
            "version": mod.get("version") or "",
            "file": mod.get("file") or "",
            "description": mod.get("description") or cf.get("summary") or "",
            "iconUrl": icon_url,
            "authors": authors,
        })
    result.sort(key=lambda m: m["name"].lower())
    return result


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

    # ATLauncher's "vanillaInstance" flag nao e confiavel como sinal de "sem
    # loader" — instancias criadas manualmente (nao a partir de um modpack
    # publicado) podem vir com vanillaInstance=True mesmo tendo um loader
    # real em loaderVersion. loaderVersion.type e o dado que importa.
    loader_info = launcher.get("loaderVersion") or {}
    loader_type = loader_info.get("type")
    loader = loader_type.lower() if loader_type else "vanilla"
    loader_version = loader_info.get("version") if loader != "vanilla" else None
    java_major = (data.get("javaVersion") or {}).get("majorVersion")

    lean = {k: data[k] for k in ATLAUNCHER_VERSION_FIELDS if k in data}
    lean_bytes = json.dumps(lean, indent=2, ensure_ascii=False).encode("utf-8")
    version_md5 = hashlib.md5(lean_bytes).hexdigest()

    mods_list = build_mods_list(launcher.get("mods") or [])
    mods_list_bytes = json.dumps(mods_list, indent=2, ensure_ascii=False).encode("utf-8")
    mods_list_md5 = hashlib.md5(mods_list_bytes).hexdigest()

    changed = (
        profile.get("minecraftVersion") != mc_version
        or profile.get("loader") != loader
        or profile.get("loaderVersion") != loader_version
        or profile.get("javaMajor") != java_major
        or profile.get("versionJsonMd5") != version_md5
        or profile.get("modsListMd5") != mods_list_md5
    )
    if not changed:
        log.info("[%s] instance.json identico ao ultimo import, pulando", profile_name)
        return False

    version_json_path = WWW_DIR / "profiles" / profile_name / "version.json"
    version_json_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = version_json_path.with_suffix(".json.tmp")
    tmp_path.write_bytes(lean_bytes)
    tmp_path.replace(version_json_path)

    mods_list_path = WWW_DIR / "profiles" / profile_name / "mods-list.json"
    tmp_path = mods_list_path.with_suffix(".json.tmp")
    tmp_path.write_bytes(mods_list_bytes)
    tmp_path.replace(mods_list_path)

    profile["minecraftVersion"] = mc_version
    profile["loader"] = loader
    profile["loaderVersion"] = loader_version
    if java_major:
        profile["javaMajor"] = java_major
    profile["versionJsonUrl"] = f"{PUBLIC_BASE_URL}/profiles/{urllib.parse.quote(profile_name)}/version.json"
    profile["versionJsonMd5"] = version_md5
    profile["modsListUrl"] = f"{PUBLIC_BASE_URL}/profiles/{urllib.parse.quote(profile_name)}/mods-list.json"
    profile["modsListMd5"] = mods_list_md5

    log.info("[%s] instance.json importado -> mc %s, loader %s %s",
              profile_name, mc_version, loader, loader_version or "")
    return True


def rebuild_profile(profile_name: str, rebuilder: Optional["DebouncedRebuilder"] = None) -> None:
    profile_dir = STAGING_DIR / profile_name
    if not profile_dir.is_dir():
        return

    # Upload rapido: zip unico na raiz -> extrai mods/instance/extras pra pasta.
    unpack_pack_zip(profile_name, profile_dir, rebuilder=rebuilder)

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

    changed = rebuild_extras_zip(profile_name, profile_dir, profile) or changed

    if changed:
        save_manifest(manifest)


class DebouncedRebuilder:
    """Debounces rebuilds via a single polling thread instead of one
    threading.Timer per event. Under a big burst (um modpack com centenas de
    mods gera uma enxurrada de eventos duplicados via Samba + watch
    recursivo), cancelar/recriar um Timer a cada evento pode nunca convergir:
    se eventos chegam mais rápido do que um Timer novo consegue ser
    agendado pelo SO antes de ser cancelado de novo, o rebuild trava pra
    sempre (livelock), mesmo com um teto de espera. Um poller simples que só
    olha "quanto tempo desde o ultimo evento" e "quanto tempo desde o
    primeiro" não tem essa classe de bug e usa muito menos CPU sob carga."""

    def __init__(self, delay: float, max_delay: float = 90.0, poll_interval: float = 2.0):
        self.delay = delay
        self.max_delay = max_delay
        self.poll_interval = poll_interval
        self._last_event = {}
        self._first_event = {}
        self._event_count = {}
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def schedule(self, profile_name: str) -> None:
        with self._lock:
            now = time.monotonic()
            self._last_event[profile_name] = now
            self._first_event.setdefault(profile_name, now)
            self._event_count[profile_name] = self._event_count.get(profile_name, 0) + 1
        self._wake.set()

    def _loop(self) -> None:
        while True:
            self._wake.wait(self.poll_interval)
            self._wake.clear()
            now = time.monotonic()
            to_fire = []
            with self._lock:
                for name, last in list(self._last_event.items()):
                    first = self._first_event[name]
                    if now - last >= self.delay or now - first >= self.max_delay:
                        count = self._event_count.pop(name, 0)
                        to_fire.append((name, count))
                        self._last_event.pop(name, None)
                        self._first_event.pop(name, None)
            for name, count in to_fire:
                # Um evento so aqui ja e o caso comum (1 arquivo solto na
                # pasta); um numero bem maior costuma ser uma copia grande
                # via Samba (ou o watchdog reemitindo tudo apos um overflow
                # de fila do inotify) — o resumo evita logar 1 linha por
                # arquivo em qualquer um dos dois casos.
                log.info("[%s] %d evento(s) de mudanca detectados, reconstruindo...", name, count)
                try:
                    rebuild_profile(name, rebuilder=self)
                except Exception:
                    log.exception("[%s] falha ao reconstruir", name)


class ModsHandler(FileSystemEventHandler):
    def __init__(self, rebuilder: DebouncedRebuilder):
        self.rebuilder = rebuilder

    def on_any_event(self, event):
        path = Path(event.src_path)
        try:
            rel = path.relative_to(STAGING_DIR)
        except ValueError:
            return
        parts = rel.parts
        if not parts:
            return
        profile_name = parts[0]
        if not is_real_profile_name(profile_name):
            return

        if event.is_directory:
            # Novo perfil (ou a pasta mods/ dele) apareceu. Agenda um build
            # mesmo sem saber ainda o que tem dentro: o Samba pode criar a
            # pasta e despejar os arquivos rapido demais pro inotify registrar
            # o watch da subpasta nova a tempo de ver os arquivos (race
            # classica de watch recursivo). rebuild_profile sempre relê o
            # diretorio do zero, entao um trigger aqui basta.
            if len(parts) <= 2:
                log.info("[%s] pasta nova detectada, agendando build", profile_name)
                self.rebuilder.schedule(profile_name)
            return

        # Qualquer arquivo dentro da pasta do perfil agenda um rebuild — nao
        # so mods/*.jar e instance.json. config/, shaderpacks/, options.txt
        # etc tambem precisam disparar o zip de extras (rebuild_extras_zip),
        # e cada helper de rebuild_profile ja checa md5 antes de reescrever
        # entao um evento "de mais" aqui e barato (so relê e compara hash).
        # Log por evento aqui vira uma enxurrada de milhares de linhas numa
        # copia grande via Samba (ou um overflow de fila do inotify fazendo
        # o watchdog reemitir tudo) — o resumo agregado sai em _loop().
        self.rebuilder.schedule(profile_name)


def cleanup_orphaned_tmp_files() -> None:
    """Remove *.zip.tmp/tmp*.zip/*.json.tmp left behind by a run that got
    killed mid-write (OOM, crash, manual kill) before it could rename the
    file into place. Safe to run on startup: nothing is mid-write yet."""
    if not WWW_DIR.is_dir():
        return
    removed = 0
    for pattern in ("profiles/*/tmp*.zip", "profiles/*/*.json.tmp"):
        for path in WWW_DIR.glob(pattern):
            try:
                path.unlink()
                removed += 1
            except OSError:
                pass
    if removed:
        log.info("Removidos %d arquivo(s) temporario(s) orfao(s) de uma execucao anterior.", removed)


def main():
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    WWW_DIR.mkdir(parents=True, exist_ok=True)
    (WWW_DIR / "maps").mkdir(parents=True, exist_ok=True)
    cleanup_orphaned_tmp_files()

    rebuilder = DebouncedRebuilder(DEBOUNCE_SECONDS)
    handler = ModsHandler(rebuilder)
    observer = Observer()
    observer.schedule(handler, str(STAGING_DIR), recursive=True)
    observer.start()
    log.info("Observando %s (debounce %.0fs) -> publicando em %s", STAGING_DIR, DEBOUNCE_SECONDS, PUBLIC_BASE_URL)

    # Builda uma vez no start, cobre o caso de mods/instance.json ja estarem la antes do servico subir
    for entry in STAGING_DIR.iterdir():
        if entry.is_dir() and is_real_profile_name(entry.name):
            rebuilder.schedule(entry.name)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
