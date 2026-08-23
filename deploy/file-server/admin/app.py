#!/usr/bin/env python3
"""Umucraft Launcher - painel admin.

Mostra o estado dos servicos (watcher, timer de release do launcher,
nginx, samba, cloudflared), o manifest.json atual (mods.zip e extras.zip
de cada perfil) e o final do log do watcher, alem de um botao pra forcar
o rebuild de um perfil na hora (sem precisar tocar num arquivo so pra
disparar o debounce).

So faz sentido atras do nginx com auth_basic — este processo escuta
apenas em 127.0.0.1, nunca e exposto direto. Veja deploy/file-server/README.md.
"""
import datetime
import subprocess
import sys
import zipfile
from pathlib import Path

from flask import Flask, abort, jsonify, render_template_string
from markupsafe import escape

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import watcher  # reusa load_manifest/rebuild_profile do watcher.py

app = Flask(__name__)

MONITORED_SERVICES = [
    "umucraft-watcher",
    "umucraft-launcher-pull.timer",
    "nginx",
    "smbd",
    "cloudflared",
]


def service_status(name):
    try:
        out = subprocess.run(
            ["systemctl", "is-active", name],
            capture_output=True, text=True, timeout=5,
        )
        return out.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def tail_journal(unit, n=40):
    """Newest-first (`-r`) so the log console can show the latest entry at
    the top without the caller needing to reverse anything."""
    try:
        out = subprocess.run(
            ["journalctl", "-u", unit, "-n", str(n), "--no-pager", "-o", "short-iso", "-r"],
            capture_output=True, text=True, timeout=5,
        )
        return out.stdout or "(sem entradas)"
    except Exception as e:
        return f"(erro lendo log: {e})"


def human_size(n):
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f}{unit}" if unit == "B" else f"{size:.1f}{unit}"
        size /= 1024


def human_time(ts):
    return datetime.datetime.fromtimestamp(ts).strftime("%d/%m %H:%M")


def build_profile_tree(profile_name):
    """Nested dict tree of what a player actually receives for this profile:
    mods.zip's jars under a synthetic "mods/" root, merged with extras.zip's
    real folder structure (config/, shaderpacks/, options.txt, ...) — i.e.
    the union of both zips as they'll land in the instance dir. Leaf values
    are byte sizes; dirs are nested dicts. zipfile only reads the central
    directory here, not the compressed data, so this is cheap even for a
    few hundred mods."""
    tree = {}
    profile_www = watcher.WWW_DIR / "profiles" / profile_name

    mods_zip = profile_www / "mods.zip"
    if mods_zip.exists():
        mods_node = tree.setdefault("mods", {})
        with zipfile.ZipFile(mods_zip) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                mods_node[info.filename] = info.file_size

    extras_zip = profile_www / "extras.zip"
    if extras_zip.exists():
        with zipfile.ZipFile(extras_zip) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                parts = [p for p in info.filename.split("/") if p]
                node = tree
                for part in parts[:-1]:
                    node = node.setdefault(part, {})
                node[parts[-1]] = info.file_size

    return tree


def render_tree(node, depth=0):
    """Nested dict -> <ul>/<details> HTML. Folders (dicts) get a native
    <details> dropdown so they start collapsed at any depth except the
    profile root, which the caller renders open; files are leaves with
    their size. No JS needed — <details> is native collapse/expand."""
    dirs = sorted(k for k, v in node.items() if isinstance(v, dict))
    files = sorted(k for k, v in node.items() if not isinstance(v, dict))

    parts = []
    if dirs or files:
        parts.append("<ul class='tree'>")
        for d in dirs:
            child_count = len(node[d])
            parts.append(
                f"<li><details><summary>📁 {escape(d)} "
                f"<span class='fcount'>({child_count})</span></summary>"
                f"{render_tree(node[d], depth + 1)}</details></li>"
            )
        for f in files:
            size = node[f]
            parts.append(
                f"<li class='file'>📄 {escape(f)} "
                f"<span class='fsize'>{human_size(size)}</span></li>"
            )
        parts.append("</ul>")
    else:
        parts.append("<div class='tree-empty'>(vazio)</div>")
    return "".join(parts)


def build_profile_rows(manifest):
    rows = []
    for name, prof in (manifest.get("profiles") or {}).items():
        mods_zip = watcher.WWW_DIR / "profiles" / name / "mods.zip"
        mods_exists = mods_zip.exists()
        extras_zip = watcher.WWW_DIR / "profiles" / name / "extras.zip"
        extras_exists = extras_zip.exists()
        rows.append({
            "name": name,
            "minecraftVersion": prof.get("minecraftVersion", "-"),
            "loader": prof.get("loader", "-"),
            "loaderVersion": prof.get("loaderVersion") or "-",
            "modsVersion": (prof.get("modsVersion") or "-")[:12],
            "modsZipSize": human_size(mods_zip.stat().st_size) if mods_exists else "-",
            "modsZipMtime": human_time(mods_zip.stat().st_mtime) if mods_exists else "-",
            "extrasZipSize": human_size(extras_zip.stat().st_size) if extras_exists else "-",
            "extrasZipMtime": human_time(extras_zip.stat().st_mtime) if extras_exists else "-",
            "treeHtml": render_tree(build_profile_tree(name)),
        })
    return rows


@app.route("/")
def dashboard():
    manifest = watcher.load_manifest()
    context = {
        "profiles": build_profile_rows(manifest),
        "services": [{"name": s, "status": service_status(s)} for s in MONITORED_SERVICES],
        "watcher_log": tail_journal("umucraft-watcher", 40),
        "pull_log": tail_journal("umucraft-launcher-pull", 15),
    }
    return render_template_string(TEMPLATE, **context)


@app.route("/logs/watcher")
def logs_watcher():
    return jsonify({"log": tail_journal("umucraft-watcher", 40)})


@app.route("/logs/pull")
def logs_pull():
    return jsonify({"log": tail_journal("umucraft-launcher-pull", 15)})


@app.route("/rebuild/<profile_name>", methods=["POST"])
def rebuild(profile_name):
    manifest = watcher.load_manifest()
    if profile_name not in (manifest.get("profiles") or {}):
        abort(404)
    watcher.rebuild_profile(profile_name)
    return jsonify({"ok": True})


TEMPLATE = """
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>UmuCraft — Admin</title>
<style>
  :root {
    --bg-deep: #080c10; --bg-dark: #0d1117; --bg-card: #161b22;
    --border: #30363d; --accent: #4ade80; --accent-dim: #4ade8044;
    --text: #e6edf3; --text-dim: #8b949e; --text-muted: #484f58;
    --danger: #f85149; --warn: #e3b341;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg-deep); color: var(--text);
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px; padding: 24px;
  }
  h1 { font-size: 20px; letter-spacing: 0.04em; margin: 0 0 4px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em;
       color: var(--text-dim); margin: 28px 0 10px; }
  .sub { color: var(--text-dim); font-size: 12px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; background: var(--bg-card);
          border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 12px; font-size: 13px; border-bottom: 1px solid var(--border); }
  th { color: var(--text-dim); font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-flex; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; }
  .badge.active { background: var(--accent-dim); color: var(--accent); }
  .badge.inactive, .badge.failed { background: #f8514922; color: var(--danger); }
  .badge.unknown { background: #30363d; color: var(--text-dim); }
  pre { background: var(--bg-dark); border: 1px solid var(--border); border-radius: 8px;
        padding: 12px; font-size: 11px; line-height: 1.6; color: var(--text-dim);
        max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
  button { background: var(--accent); color: #000; border: none; border-radius: 6px;
           padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
  button:hover { background: #6ef799; }
  button:disabled { background: var(--text-muted); cursor: not-allowed; }
  .rebuild-msg { font-size: 12px; margin-left: 8px; color: var(--accent); }

  details.profile-tree { background: var(--bg-card); border: 1px solid var(--border);
        border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; }
  details.profile-tree > summary { cursor: pointer; font-weight: 600; font-size: 13px; }
  details.profile-tree > summary::marker { color: var(--accent); }
  ul.tree { list-style: none; margin: 6px 0 0; padding-left: 18px; font-size: 12px;
        font-family: Consolas, 'Courier New', monospace; }
  ul.tree li { padding: 2px 0; }
  ul.tree details { display: inline-block; width: 100%; }
  ul.tree summary { cursor: pointer; }
  ul.tree summary::marker { color: var(--text-dim); }
  ul.tree .fcount, ul.tree .fsize { color: var(--text-dim); font-size: 11px; margin-left: 4px; }
  ul.tree li.file { color: var(--text); }
  .tree-empty { color: var(--text-muted); font-size: 12px; padding-left: 4px; }

  .live-dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    background: var(--accent); margin-left: 6px; vertical-align: middle;
    box-shadow: 0 0 6px var(--accent); animation: live-pulse 1.6s ease-in-out infinite;
  }
  @keyframes live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }

  .logs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .log-col h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em;
        color: var(--text-dim); margin: 0 0 8px; }
  .log-col pre { max-height: 420px; }
  @media (max-width: 720px) {
    .logs-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
  <h1>UmuCraft — Painel Admin</h1>
  <div class="sub">Estado do watcher, releases e perfis publicados.</div>

  <h2>Serviços</h2>
  <table>
    <tr><th>Serviço</th><th>Status</th></tr>
    {% for s in services %}
    <tr><td>{{ s.name }}</td><td><span class="badge {{ s.status }}">{{ s.status }}</span></td></tr>
    {% endfor %}
  </table>

  <h2>Perfis</h2>
  <table>
    <tr><th>Nome</th><th>MC</th><th>Loader</th><th>Mods v.</th><th>mods.zip</th><th>Mods atualizado</th><th>extras.zip</th><th>Extras atualizado</th><th></th></tr>
    {% for p in profiles %}
    <tr>
      <td>{{ p.name }}</td>
      <td>{{ p.minecraftVersion }}</td>
      <td>{{ p.loader }}{% if p.loaderVersion != '-' %} {{ p.loaderVersion }}{% endif %}</td>
      <td>{{ p.modsVersion }}</td>
      <td>{{ p.modsZipSize }}</td>
      <td>{{ p.modsZipMtime }}</td>
      <td>{{ p.extrasZipSize }}</td>
      <td>{{ p.extrasZipMtime }}</td>
      <td>
        <button onclick="rebuild('{{ p.name }}', this)">Forçar rebuild</button>
        <span class="rebuild-msg" id="msg-{{ p.name }}"></span>
      </td>
    </tr>
    {% endfor %}
    {% if not profiles %}
    <tr><td colspan="9">Nenhum perfil no manifest.json ainda.</td></tr>
    {% endif %}
  </table>

  <h2>Árvore de arquivos (build atual)</h2>
  {% for p in profiles %}
  <details class="profile-tree">
    <summary>{{ p.name }}</summary>
    {{ p.treeHtml | safe }}
  </details>
  {% endfor %}
  {% if not profiles %}
  <div class="sub">Nenhum perfil publicado ainda.</div>
  {% endif %}

  <h2>Logs</h2>
  <div class="logs-grid">
    <div class="log-col">
      <h3>umucraft-watcher <span class="live-dot" title="Atualiza sozinho a cada 4s"></span></h3>
      <pre id="watcher-log">{{ watcher_log }}</pre>
    </div>
    <div class="log-col">
      <h3>umucraft-launcher-pull <span class="live-dot" title="Atualiza sozinho a cada 4s"></span></h3>
      <pre id="pull-log">{{ pull_log }}</pre>
    </div>
  </div>

<script>
async function rebuild(name, btn) {
  btn.disabled = true;
  const msg = document.getElementById('msg-' + name);
  msg.textContent = 'Reconstruindo...';
  try {
    const res = await fetch('/admin/rebuild/' + encodeURIComponent(name), { method: 'POST' });
    const data = await res.json();
    msg.textContent = data.ok ? 'Feito! Recarregando...' : 'Erro.';
    if (data.ok) setTimeout(() => location.reload(), 800);
  } catch (e) {
    msg.textContent = 'Erro: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

// Log consoles poll on their own and re-render newest-first (server already
// sorts each fetch that way via `journalctl -r`), so the latest line is
// always the one in view — no scrolling needed to see what just happened.
async function refreshLogs() {
  try {
    const [w, p] = await Promise.all([
      fetch('logs/watcher').then(r => r.json()),
      fetch('logs/pull').then(r => r.json()),
    ]);
    document.getElementById('watcher-log').textContent = w.log;
    document.getElementById('pull-log').textContent = p.log;
  } catch (e) {
    // Transient network hiccup — next tick tries again, nothing to show the user.
  }
}
setInterval(refreshLogs, 4000);
</script>
</body>
</html>
"""

if __name__ == "__main__":
    from waitress import serve
    serve(app, host="127.0.0.1", port=8787)
