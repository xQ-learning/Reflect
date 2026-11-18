"""极简 WebDriver 客户端：用 urllib 驱动 geckodriver，验证 Reflect 前端渲染与 JS 报错。"""
import base64
import json
import os
import socket
import subprocess
import time
import urllib.request


def _free_port():
    """随机取一个空闲端口，避免与残留的 geckodriver 冲突。"""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class WebDriver:
    def __init__(self, port=None, headless=True):
        self.port = port or _free_port()
        self.base = "http://127.0.0.1:%d" % self.port
        self.proc = None
        self.sid = None
        self.headless = headless

    def start(self, timeout=60):
        cmd = ["geckodriver", "--port", str(self.port), "--host", "127.0.0.1"]
        if self.headless:
            cmd.append("--websocket-port=0")
        self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                self._req("GET", "/status")
                return self
            except Exception:
                time.sleep(0.4)
        raise RuntimeError("geckodriver 启动超时")

    def stop(self):
        try:
            if self.sid:
                self._req("DELETE", "/session/" + self.sid)
        except Exception:
            pass
        self.sid = None
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except Exception:
                self.proc.kill()
            self.proc = None

    def _req(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if os.environ.get("WD_DEBUG"):
            print("REQ", method, path, repr(body)[:400])
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read().decode()
        except urllib.error.HTTPError as e:
            # geckodriver 的报错正文在 body 里，直接抛出来省得瞎猜
            raise RuntimeError("%s %s -> HTTP %s: %s" % (
                method, path, e.code, e.read().decode()[:500]))
        return json.loads(raw) if raw.strip() else {}

    def new_session(self, width=430, height=900, retries=3):
        """建会话。geckodriver 在并发/残留进程下偶发 500，这里重试几次。"""
        args = ["-headless"] if self.headless else []
        prefs = {
            "browser.download.folderList": 2,
            "devtools.console.stdout.content": True,
        }
        caps = {
            "capabilities": {
                "alwaysMatch": {
                    "browserName": "firefox",
                    "moz:firefoxOptions": {"args": args, "prefs": prefs},
                    "moz:webdriverClick": True,
                }
            }
        }
        last = None
        for attempt in range(retries):
            try:
                r = self._req("POST", "/session", caps)
                self.sid = r["value"]["sessionId"]
                self.set_window(width, height)
                return self
            except Exception as e:
                last = e
                time.sleep(2 + attempt * 2)
        raise RuntimeError("创建浏览器会话失败（已重试 %d 次）: %s" % (retries, last))

    def set_window(self, width, height):
        self._req("POST", "/session/%s/window/rect" % self.sid, {"width": width, "height": height})

    def navigate(self, url):
        self._req("POST", "/session/%s/url" % self.sid, {"url": url})
        time.sleep(1.2)

    def execute(self, script, args=None):
        r = self._req("POST", "/session/%s/execute/sync" % self.sid,
                      {"script": script, "args": args or []})
        return r.get("value")

    def execute_async(self, script, args=None):
        r = self._req("POST", "/session/%s/execute/async" % self.sid,
                      {"script": script, "args": args or []})
        return r.get("value")

    def screenshot(self, path):
        r = self._req("GET", "/session/%s/screenshot" % self.sid)
        data = base64.b64decode(r["value"])
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        return path

    def logs(self, kind="browser"):
        try:
            r = self._req("POST", "/session/%s/log" % self.sid, {"type": kind})
            return r.get("value", [])
        except Exception:
            return []

    def quit(self):
        try:
            self._req("DELETE", "/session/" + self.sid)
        except Exception:
            pass
        self.sid = None
