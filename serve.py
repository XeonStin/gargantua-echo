#!/usr/bin/env python3
"""GARGANTUA 静态服务器 — python serve.py [端口](默认 5300)
默认监听 0.0.0.0(局域网可访问);只允许本机时用 python serve.py 5300 --local
"""
import http.server
import os
import socket
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5300
LOCAL_ONLY = '--local' in sys.argv
os.chdir(os.path.dirname(os.path.abspath(__file__)))


def lan_ips():
    """枚举本机非回环 IPv4(不需要联网)。"""
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    try:  # 兜底:UDP connect 拿默认出口地址(不会真的发包)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith('127.'))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.wav': 'audio/wav',
        '.json': 'application/json',
        '.glsl': 'text/plain; charset=utf-8',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 安静模式


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    bind = '127.0.0.1' if LOCAL_ONLY else '0.0.0.0'
    with Server((bind, PORT), Handler) as httpd:
        print('GARGANTUA — Schwarzschild Black Hole Raytracer')
        print(f'本机:   http://127.0.0.1:{PORT}/')
        if not LOCAL_ONLY:
            for ip in lan_ips():
                print(f'局域网: http://{ip}:{PORT}/')
        print('(Ctrl+C 停止)')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n已停止')
