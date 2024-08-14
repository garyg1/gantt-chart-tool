from http.server import SimpleHTTPRequestHandler, HTTPServer
from sys import argv

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        SimpleHTTPRequestHandler.end_headers(self)


port = int(argv[1])
httpd = HTTPServer(("", port), Handler)
httpd.serve_forever()
