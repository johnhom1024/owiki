#!/usr/bin/env python3
"""
owiki 单设备同步（观察态）E2E 验证脚本。

场景：vault「测试」开启单设备同步，pin 到设备 A。
- 设备 B（非 pin）：hello 应成功（welcome.ok=true, syncEnabled=false）
- 设备 B 的 upload 被服务端拒绝（error 消息）
- 设备 A 的 upload 成功，B 收不到广播（完全静默）
- Web 端把 pin 切到 B → B 收到 sync_state(enabled=true) 并补对账成功
- A 变为静默，A 的 upload 被拒
- 关闭单设备 → A 收到 sync_state(enabled=true) 恢复

用法：
  cd owiki-monorepo/owiki
  mkdir -p /tmp/owiki-e2e/data
  go build -o /tmp/owiki-e2e/owiki-server .
  OWIKI_DB=/tmp/owiki-e2e/data/e2e.db OWIKI_ADDR=:8788 OWIKI_TOKEN=e2e-token \\
    OWIKI_ADMIN_USER=admin OWIKI_ADMIN_PASSWORD=e2e-admin GIN_MODE=release \\
    /tmp/owiki-e2e/owiki-server &   # 等待 /api/health 就绪后：
  python3 scripts/e2e_single_device.py   # 依赖：pip install websocket-client
"""
import json
import hashlib
import sys
import time
import urllib.request

import websocket  # pip install websocket-client

ADDR = "ws://127.0.0.1:8788/ws"
BASE = "http://127.0.0.1:8788"

# 测试服务由 run-e2e.sh 用 OWIKI_TOKEN=e2e-token 起的默认 vault
TOKEN = "e2e-token"


def sha256(s):
    return hashlib.sha256(s.encode()).hexdigest()

passed = 0
failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✓ {name}")
    else:
        failed += 1
        print(f"  ✗ {name} {extra}")


class Dev:
    def __init__(self, name, device_id):
        self.name = name
        self.device_id = device_id
        self.ws = websocket.create_connection(ADDR, timeout=5)
        self.extra = []  # 旁路消息（广播等）

    def hello(self):
        self.send({"type": "hello", "token": TOKEN, "deviceId": self.device_id,
                   "deviceName": self.name, "clientVersion": "e2e"})
        return self.recv("welcome")

    def send(self, obj):
        self.ws.send(json.dumps(obj))

    def recv(self, want_type=None, timeout=3):
        """收一条消息；ping 旁路。返回 (type, msg) 或超时 None。"""
        self.ws.settimeout(timeout)
        try:
            while True:
                data = self.ws.recv()
                m = json.loads(data)
                t = m.get("type")
                if t == "ping":
                    continue
                if want_type is None or t == want_type:
                    return m
                self.extra.append(m)
        except websocket.WebSocketTimeoutException:
            return None

    def drain(self, secs=1.0):
        """静默窗口：收掉所有消息（检测有没有不期而至的广播）。"""
        self.ws.settimeout(secs)
        got = []
        try:
            while True:
                data = self.ws.recv()
                m = json.loads(data)
                if m.get("type") != "pin" and m.get("type") != "ping":
                    got.append(m)
        except websocket.WebSocketTimeoutException:
            pass
        return got

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def api(path, method="GET", body=None):
    req = urllib.request.Request(
        BASE + path,
        method=method,
        headers={"Content-Type": "application/json"},
        data=json.dumps(body).encode() if body else None,
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())


def vault_id():
    # 测试服务没设管理员密码时 /api 组也无登录态——e2e 服务用 .env 白名单方式
    # 直接查库太重，这里通过默认 vault 的 token 反查：用 WS hello 拿 vault 名，
    # 再用列表接口（需要登录）——测试服务起时设置了 OWIKI_ADMIN_PASSWORD=e2e-admin,
    # 用 cookie 登录
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
    login_body = json.dumps({"username": "admin", "password": "e2e-admin"}).encode()
    req = urllib.request.Request(BASE + "/api/auth/login", data=login_body,
                                 headers={"Content-Type": "application/json"})
    opener.open(req, timeout=5)
    r = opener.open(BASE + "/api/vaults", timeout=5)
    data = json.loads(r.read())
    vid = data["data"][0]["id"]
    return opener, vid


def set_single_device(opener, vid, on, device_id=""):
    body = json.dumps({"singleDevice": on, "pinnedDeviceId": device_id}).encode()
    req = urllib.request.Request(
        BASE + f"/api/vaults/{vid}/single-device", data=body, method="PUT",
        headers={"Content-Type": "application/json"})
    opener.open(req, timeout=5)
    return json.loads(urllib.request.urlopen(req, timeout=5).read()) if False else None


def set_single_device2(opener, vid, on, device_id=""):
    body = json.dumps({"singleDevice": on, "pinnedDeviceId": device_id}).encode()
    req = urllib.request.Request(
        BASE + f"/api/vaults/{vid}/single-device", data=body, method="PUT",
        headers={"Content-Type": "application/json"})
    with opener.open(req, timeout=5) as r:
        return json.loads(r.read())


def main():
    print("== 0. 准备：登录 Web 管理端，找到默认 vault ==")
    opener, vid = vault_id()
    print(f"  vault id={vid}")

    print("== 1. 设备 A（pin 设备）连接 ==")
    a = Dev("device-A", "e2e-aaaa-0001")
    w = a.hello()
    check("A hello ok", w and w.get("ok") is True)
    check("A syncEnabled=true", w.get("syncEnabled") is True, f"got {w}")

    print("== 2. 先关闭单设备（确保初始态干净） ==")
    set_single_device2(opener, vid, False)
    time.sleep(0.3)
    # A 可能收到 sync_state，排掉
    a.drain(0.5)

    print("== 3. 开启单设备同步，pin 到 A ==")
    set_single_device2(opener, vid, True, "e2e-aaaa-0001")
    m = a.recv("sync_state", timeout=2)
    check("A 收到 sync_state(enabled=true)", m and m.get("syncEnabled") is True, f"got {m}")
    a.drain(0.3)

    print("== 4. 设备 B（非 pin）连接：应成功但观察态 ==")
    b = Dev("device-B", "e2e-bbbb-0002")
    w = b.hello()
    check("B hello ok", w and w.get("ok") is True, f"got {w}")
    check("B syncEnabled=false", w.get("syncEnabled") is False, f"got {w}")

    print("==  上传测试：B 的写入被拒 ==")
    b.send({"type": "upload", "path": "from-b.md", "hash": sha256("from B"), "content": "from B", "mtime": int(time.time())})
    m = b.recv("error", timeout=3)
    check("B upload 被拒", m is not None and "单设备同步" in (m or {}).get("message", ""), f"got {m}")
    with opener.open(BASE + f"/api/vaults/{vid}/files", timeout=5) as r:
        files = json.loads(r.read())["data"]
    paths = {f["path"] for f in files}
    check("from-b.md 未入库", "from-b.md" not in paths, f"paths={paths}")

    print("== 5. A 上传成功，B 完全静默（收不到广播） ==")
    a.send({"type": "upload", "path": "from-a.md", "hash": sha256("from A"), "content": "from A", "mtime": int(time.time())})
    m = a.recv("ok", timeout=3)
    check("A upload 成功", m is not None and m.get("for") == "upload", f"got {m}")
    leaked = b.drain(1.2)
    check("B 收不到任何广播", len(leaked) == 0, f"leaked: {leaked}")

    print("== 6. pin 切到 B：B 升级，A 降级（都在线切换，不断线） ==")
    set_single_device2(opener, vid, True, "e2e-bbbb-0002")
    m = b.recv("sync_state", timeout=2)
    check("B 收到 sync_state(enabled=true)", m and m.get("syncEnabled") is True, f"got {m}")
    m = a.recv("sync_state", timeout=2)
    check("A 收到 sync_state(enabled=false)", m and m.get("syncEnabled") is False, f"got {m}")

    print("== 7. 切换后：B 可上传，A 被拒 ==")
    b.send({"type": "upload", "path": "from-b2.md", "hash": sha256("from B after switch"), "content": "from B after switch", "mtime": int(time.time())})
    m = b.recv("ok", timeout=3)
    check("B upload 成功", m is not None and m.get("for") == "upload", f"got {m}")
    a.send({"type": "upload", "path": "from-a2.md", "hash": sha256("from A after switch"), "content": "from A after switch", "mtime": int(time.time())})
    m = a.recv("error", timeout=3)
    check("A upload 被拒", m is not None and "单设备同步" in (m or {}).get("message", ""), f"got {m}")

    print("== 8. B 补对账（hashlist 不再被拒） ==")
    b.send({"type": "hashlist", "entries": []})
    m = b.recv("hashlist_response", timeout=3)
    check("B hashlist 放行", m is not None, f"got {m}")

    print("== 9. 关闭单设备：A 恢复 ==")
    set_single_device2(opener, vid, False)
    m = a.recv("sync_state", timeout=2)
    check("A 收到 sync_state(enabled=true)", m and m.get("syncEnabled") is True, f"got {m}")
    m = b.recv("sync_state", timeout=2)
    check("B 收到 sync_state(enabled=true)", m and m.get("syncEnabled") is True, f"got {m}")

    print("== 10. 设备列表与日志核验 ==")
    with opener.open(BASE + f"/api/vaults/{vid}/devices", timeout=5) as r:
        devs = json.loads(r.read())["data"]
    names = {d["deviceId"]: d["deviceName"] for d in devs}
    check("A、B 均已登记", "e2e-aaaa-0001" in names and "e2e-bbbb-0002" in names, f"got {names}")
    with opener.open(BASE + f"/api/vaults/{vid}/logs?limit=50", timeout=5) as r:
        logs = json.loads(r.read())["data"]
    connect_logs = [l for l in logs if l["action"] == "device.connect"]
    check("hello 日志带 syncEnabled 字样", any("syncEnabled" in (l.get("detail") or "") for l in connect_logs),
          f"details: {[l.get('detail') for l in connect_logs]}")

    a.close()
    b.close()
    print(f"\n结果：{passed} 通过 / {failed} 失败")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
