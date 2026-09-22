"""Minimal app used only by the opt-in Docker updater integration check."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import os
from pathlib import Path

if os.environ.get('FAIL_START') == '1':
    Path('/app/data/config.enc').write_bytes(b'changed-by-broken-build')
    raise SystemExit(1)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"version":"fixture"}')


HTTPServer(('0.0.0.0', 4277), Handler).serve_forever()
