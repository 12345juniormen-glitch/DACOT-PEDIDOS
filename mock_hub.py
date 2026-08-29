from http.server import BaseHTTPRequestHandler, HTTPServer
import json, re
MODULE_KEY = "test-module-key-abc"
PATTERN = re.compile(r"^/api/public/tenants/([^/]+)/modules/([^/]+)/status$")
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        m = PATTERN.match(self.path.split("?")[0])
        if not m: self.send_response(404); self.end_headers(); return
        tenant_id = m.group(1)
        if self.headers.get("X-Module-Key") != MODULE_KEY:
            self.send_response(401); self.end_headers(); return
        if tenant_id.startswith("unknown-"):
            self.send_response(404); self.end_headers(); return
        active = not tenant_id.startswith("inactive-")
        body = json.dumps({"tenant_id": tenant_id, "active": active}).encode()
        self.send_response(200); self.send_header("Content-Type","application/json"); self.end_headers()
        self.wfile.write(body)
    def log_message(self,*a,**kw): pass
if __name__=="__main__":
    HTTPServer(("127.0.0.1", 8899), Handler).serve_forever()
