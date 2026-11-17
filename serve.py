"""Локальный сервер редактора для разработки: python3 serve.py [порт] → http://127.0.0.1:8765

Как python -m http.server, но запрещает кэширование: после правок браузер всегда берёт свежие файлы.
"""

import functools
import http.server
import sys
from pathlib import Path


class NoCache(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # адреса без расширения (/studio) — как на Vercel с cleanUrls: отдаём studio.html
        p = super().translate_path(path)
        return p + ".html" if not Path(p).exists() and Path(p + ".html").exists() else p

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    web = Path(__file__).resolve().parent / "web"
    handler = functools.partial(NoCache, directory=str(web))
    print(f"редактор: http://127.0.0.1:{port}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
