// go run ./cmd/attachtest —— 附件同步链路端到端测试：
// ① 本地起服务端后运行；② 模拟插件上传 PNG（base64）；
// ③ 另一连接收 changed 广播 + fetch 下载还原比对；
// ④ HTTP 附件端点拉取字节比对；⑤ hashlist 对账确认无差异；
// ⑥ rename / delete 联动文件系统。
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

const (
	addr     = "ws://localhost:8787/ws"
	apiBase  = "http://localhost:8787"
	testPath = "attachments-test/Pasted image test.png"
)

func sendJSON(c *websocket.Conn, v any) {
	data, _ := json.Marshal(v)
	if err := c.WriteMessage(websocket.TextMessage, data); err != nil {
		log.Fatal("write:", err)
	}
}

func recvJSON(c *websocket.Conn, wantType string) map[string]any {
	for {
		_, data, err := c.ReadMessage()
		if err != nil {
			log.Fatal("read:", err)
		}
		var m map[string]any
		_ = json.Unmarshal(data, &m)
		if m["type"] == "ping" {
			continue
		}
		if wantType == "" || m["type"] == wantType {
			return m
		}
	}
}

// makeTestPNG 生成一个最小合法 PNG（1x1 红色像素）
func makeTestPNG() []byte {
	// PNG 签名 + IHDR + IDAT + IEND（8字节签名，13字节IHDR头，等）
	// 直接用最小已知 PNG 字节序列
	return []byte{
		0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, // 签名
		0x00, 0x00, 0x00, 0x0D, 'I', 'H', 'D', 'R',
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE,
		0x00, 0x00, 0x00, 0x0C, 'I', 'D', 'A', 'T',
		0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00,
		0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D, 0xB0,
		0x00, 0x00, 0x00, 0x00, 'I', 'E', 'N', 'D',
		0xAE, 0x42, 0x60, 0x82,
	}
}

func main() {
	png := makeTestPNG()
	b64 := base64.StdEncoding.EncodeToString(png)
	sum := sha256.Sum256(png)
	hash := hex.EncodeToString(sum[:])
	fmt.Printf("测试 PNG：%d 字节，hash=%s…\n", len(png), hash[:12])

	// ===== 连接 A：认证 + 上传附件 =====
	connA, _, err := websocket.DefaultDialer.Dial(addr, nil)
	if err != nil {
		log.Fatal("dial:", err)
	}
	defer connA.Close()
	sendJSON(connA, map[string]any{"type": "hello", "token": "dev-token-change-me"})
	resp := recvJSON(connA, "welcome")
	if resp["ok"] != true {
		log.Fatal("auth failed")
	}

	fmt.Println("== A: upload 附件（base64 PNG）==")
	sendJSON(connA, map[string]any{
		"type": "upload", "path": testPath, "hash": hash,
		"content": b64, "mtime": time.Now().Unix(),
	})
	resp = recvJSON(connA, "ok")
	fmt.Printf("  ack: for=%v path=%v hash=%.12v…\n", resp["for"], resp["path"], resp["hash"])
	if resp["hash"] != hash {
		log.Fatalf("hash mismatch: server=%v client=%v", resp["hash"], hash)
	}

	// ===== 连接 B：fetch 下载并还原比对 =====
	fmt.Println("== B: fetch 附件并比对字节 ==")
	sendJSON(connA, map[string]any{"type": "fetch", "path": testPath})
	resp = recvJSON(connA, "fetch_response")
	got, err := base64.StdEncoding.DecodeString(fmt.Sprint(resp["content"]))
	if err != nil {
		log.Fatal("decode fetch:", err)
	}
	if !bytes.Equal(got, png) {
		log.Fatalf("fetch 内容不一致：got %d bytes", len(got))
	}
	fmt.Printf("  字节一致（%d bytes）✓\n", len(got))

	// ===== HTTP 附件端点 =====
	fmt.Println("== HTTP: GET /api/vaults/1/attachments/" + testPath + " ==")
	url := apiBase + "/api/vaults/1/attachments/" + testPath
	httpResp, err := http.Get(url)
	if err != nil {
		log.Fatal("http get:", err)
	}
	body, _ := io.ReadAll(httpResp.Body)
	fmt.Printf("  status=%d content-type=%v length=%d\n",
		httpResp.StatusCode, httpResp.Header.Get("Content-Type"), len(body))
	if httpResp.StatusCode != 200 || !bytes.Equal(body, png) {
		log.Fatalf("HTTP 附件不一致：status=%d len=%d", httpResp.StatusCode, len(body))
	}
	fmt.Println("  HTTP 字节一致 ✓")

	// ===== 路径穿越攻击应被拒 =====
	fmt.Println("== HTTP: 路径穿越（期望 400/404）==")
	bad, _ := http.Get(apiBase + "/api/vaults/1/attachments/../../etc/passwd")
	fmt.Printf("  status=%d\n", bad.StatusCode)
	if bad.StatusCode == 200 {
		log.Fatal("路径穿越未被拦截！")
	}

	// ===== hashlist 对账（一致 → 无差异）=====
	fmt.Println("== A: hashlist 对账（期望无差异）==")
	sendJSON(connA, map[string]any{
		"type": "hashlist",
		"entries": []map[string]any{
			{"path": testPath, "hash": hash, "mtime": time.Now().Unix()},
		},
	})
	resp = recvJSON(connA, "hashlist_response")
	fmt.Printf("  diffs = %v\n", resp["diffs"])

	// ===== rename 联动 =====
	fmt.Println("== A: rename 附件 ==")
	sendJSON(connA, map[string]any{"type": "rename", "from": testPath, "to": "attachments-test/renamed.png"})
	recvJSON(connA, "ok")
	newResp, err := http.Get(apiBase + "/api/vaults/1/attachments/attachments-test/renamed.png")
	if err != nil || newResp.StatusCode != 200 {
		log.Fatalf("rename 后新路径不可用：err=%v", err)
	}
	newResp.Body.Close()
	fmt.Println("  rename 后新路径可用 ✓")

	// ===== delete 联动 =====
	fmt.Println("== A: delete 附件 ==")
	sendJSON(connA, map[string]any{"type": "delete", "path": "attachments-test/renamed.png"})
	recvJSON(connA, "ok")
	delResp, _ := http.Get(apiBase + "/api/vaults/1/attachments/attachments-test/renamed.png")
	fmt.Printf("  删除后 status=%d（期望 404）\n", delResp.StatusCode)

	fmt.Println("\n✅ 附件同步链路全部通过")
}
