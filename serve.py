"""Локальный сервер редактора для разработки: python3 serve.py [порт] → http://127.0.0.1:8765

Как python -m http.server, но запрещает кэширование: после правок браузер всегда берёт свежие файлы.
"""

import functools
import http.server
import sys
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

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    web = Path(__file__).resolve().parent / "web"
    handler = functools.partial(NoCache, directory=str(web))
    print(f"редактор: http://127.0.0.1:{port}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
