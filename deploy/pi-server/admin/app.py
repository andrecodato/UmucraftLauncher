#!/usr/bin/env python3
"""Umucraft Launcher - painel admin.

Mostra o estado dos servicos (watcher, timer de release do launcher,
nginx, samba, cloudflared), o manifest.json atual e o final do log do
watcher, alem de um botao pra forcar o rebuild de um perfil na hora
(sem precisar tocar num .jar so pra disparar o debounce).

So faz sentido atras do nginx com auth_basic — este processo escuta
apenas em 127.0.0.1, nunca e exposto direto. Veja deploy/pi-server/README.md.
"""
import datetime
import subprocess
import sys
from pathlib import Path

from flask import Flask, abort, jsonify, render_template_string

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
    try:
        out = subprocess.run(
            ["journalctl", "-u", unit, "-n", str(n), "--no-pager", "-o", "short-iso"],
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


def build_profile_rows(manifest):
    rows = []
    for name, prof in (manifest.get("profiles") or {}).items():
        mods_zip = watcher.WWW_DIR / "profiles" / name / "mods.zip"
        exists = mods_zip.exists()
        rows.append({
            "name": name,
            "minecraftVersion": prof.get("minecraftVersion", "-"),
            "loader": prof.get("loader", "-"),
            "loaderVersion": prof.get("loaderVersion") or "-",
            "modsVersion": (prof.get("modsVersion") or "-")[:12],
            "modsZipSize": human_size(mods_zip.stat().st_size) if exists else "-",
            "modsZipMtime": human_time(mods_zip.stat().st_mtime) if exists else "-",
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
    <tr><th>Nome</th><th>MC</th><th>Loader</th><th>Mods v.</th><th>mods.zip</th><th>Atualizado</th><th></th></tr>
    {% for p in profiles %}
    <tr>
      <td>{{ p.name }}</td>
      <td>{{ p.minecraftVersion }}</td>
      <td>{{ p.loader }}{% if p.loaderVersion != '-' %} {{ p.loaderVersion }}{% endif %}</td>
      <td>{{ p.modsVersion }}</td>
      <td>{{ p.modsZipSize }}</td>
      <td>{{ p.modsZipMtime }}</td>
      <td>
        <button onclick="rebuild('{{ p.name }}', this)">Forçar rebuild</button>
        <span class="rebuild-msg" id="msg-{{ p.name }}"></span>
      </td>
    </tr>
    {% endfor %}
    {% if not profiles %}
    <tr><td colspan="7">Nenhum perfil no manifest.json ainda.</td></tr>
    {% endif %}
  </table>

  <h2>Log — umucraft-watcher</h2>
  <pre>{{ watcher_log }}</pre>

  <h2>Log — umucraft-launcher-pull</h2>
  <pre>{{ pull_log }}</pre>

<script>
async function rebuild(name, btn) {
  btn.disabled = true;
  const msg = document.getElementById('msg-' + name);
  msg.textContent = 'Reconstruindo...';
  try {
    const res = await fetch('/rebuild/' + encodeURIComponent(name), { method: 'POST' });
    const data = await res.json();
    msg.textContent = data.ok ? 'Feito! Recarregando...' : 'Erro.';
    if (data.ok) setTimeout(() => location.reload(), 800);
  } catch (e) {
    msg.textContent = 'Erro: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}
</script>
</body>
</html>
"""

if __name__ == "__main__":
    from waitress import serve
    serve(app, host="127.0.0.1", port=8787)
