"""Локальный сервер редактора для разработки: python3 serve.py [порт] → http://127.0.0.1:8765

Как python -m http.server, но запрещает кэширование: после правок браузер всегда берёт свежие файлы.
"""

import functools
import http.server
import sys
import urllib.request
from pathlib import Path


class NoCache(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # как на сайте: /ru/… — та же страница (язык она берёт из адреса); чего нет в web/ — из собранных Docs
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean == "/ru" or clean.startswith("/ru/"):
            rest = clean[3:] or "/"
            if not rest.startswith("/docs"):
                path = rest
        p = Path(super().translate_path(path))
        if not p.exists() and Path(str(p) + ".html").exists():
            return str(p) + ".html"                       # /studio → studio.html, как на Cloudflare
        if not p.exists():
            d = Path(__file__).resolve().parent / "docsite" / "dist" / clean.lstrip("/")
            if d.is_dir() and (d / "index.html").exists():
                return str(d / "index.html")
            if d.exists():
                return str(d)
        return str(p)

    # Счётчики лендинга живут на Cloudflare (worker/index.js). Локально: чтение /api/stats — с живого сайта, чтобы
    # блок счётчиков был виден как там; всё остальное под /api/ (в том числе «+1» после истории) глушим, чтобы
    # локальные прогоны не попадали в настоящие счётчики.
    def api(self):
        if not self.path.split("?", 1)[0].startswith("/api/"):
            return False
        body, code = b"{}", 204
        if self.command == "GET" and self.path.split("?", 1)[0] == "/api/stats":
            try:
                req = urllib.request.Request("https://tensorlupa.com/api/stats", headers={"User-Agent": "tensorlupa-dev-server"})
                with urllib.request.urlopen(req, timeout=5) as r:   # без User-Agent Cloudflare отвечает 403
                    body, code = r.read(), 200
            except OSError:
                body, code = b'{"runs":0,"users":0}', 200
        self.send_response(code)
        if code == 200:
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if code == 200:
            self.wfile.write(body)
        return True

    def do_GET(self):
        if not self.api():
            super().do_GET()

    def do_POST(self):
        if not self.api():
            self.send_error(405)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    web = Path(__file__).resolve().parent / "web"
    handler = functools.partial(NoCache, directory=str(web))
    # второй аргумент — адрес: по умолчанию только этот компьютер; 0.0.0.0 открывает сервер устройствам той же
    # сети (посмотреть студию с телефона по Wi-Fi): python3 serve.py 8766 0.0.0.0
    host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    print(f"редактор: http://{host}:{port}")
    http.server.ThreadingHTTPServer((host, port), handler).serve_forever()
