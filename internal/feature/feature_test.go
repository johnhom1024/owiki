package feature

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// 独立 Registry 实例测核心语义（不碰全局注册中心，避免与其他包 init 冲突）。
func TestRegistryPriorityAndToggle(t *testing.T) {
	r := NewRegistry()
	// 手工注入（绕过全局 Register，测试用）；LoadSettings(空) 让默认值生效
	r.features["share"] = Desc{ID: "share", Default: true, CanToggle: true, EnvKey: "OWIKI_SHARE"}
	r.features["core"] = Desc{ID: "core", Default: true, CanToggle: false}
	r.features["off"] = Desc{ID: "off", Default: false, CanToggle: true, EnvKey: "OWIKI_OFF"}
	r.LoadSettings(map[string]string{}, func(string) string { return "" })

	// 1) 代码默认：Default 即初始状态
	if !r.Enabled("share") || !r.Enabled("core") || r.Enabled("off") {
		t.Fatal("default states wrong")
	}

	// 2) env 覆盖默认（无 DB 值时）：OWIKI_SHARE=off → false
	r.LoadSettings(map[string]string{}, func(k string) string {
		if k == "OWIKI_SHARE" {
			return "off"
		}
		return ""
	})
	if r.Enabled("share") {
		t.Fatal("env off should disable share")
	}
	if r.Enabled("off") {
		t.Fatal("env unset should keep default false")
	}

	// 3) DB 值权威：用户动过 share=true，env=off 不再生效
	r.LoadSettings(map[string]string{
		SettingKey("share"): "true",
	}, func(k string) string {
		if k == "OWIKI_SHARE" {
			return "off"
		}
		return ""
	})
	if !r.Enabled("share") {
		t.Fatal("db value should override env")
	}

	// 4) SetEnabled：可关功能 OK；核心功能拒绝
	if !r.SetEnabled("share", false) {
		t.Fatal("toggleable feature should toggle")
	}
	if r.Enabled("share") {
		t.Fatal("share should be off now")
	}
	if r.SetEnabled("core", false) {
		t.Fatal("core feature must not be toggleable")
	}
}

// 全局 Require 中间件：关掉的 feature 请求直接 404。
// 用一个只在测试里注册的临时 feature 验证（全局注册中心隔离测试环境）。
func TestRequireMiddleware404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	Register(Desc{ID: "test-mw", Default: true, CanToggle: true})
	Use().SetEnabled("test-mw", false)

	r := gin.New()
	r.GET("/x", Require("test-mw"), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/x", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("disabled feature should 404, got %d", w.Code)
	}

	Use().SetEnabled("test-mw", true)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/x", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("enabled feature should pass, got %d", w.Code)
	}
}

// List 输出排序稳定（前端设置页展示）。
func TestListSorted(t *testing.T) {
	r := NewRegistry()
	r.features["b"] = Desc{ID: "b", CanToggle: true}
	r.features["a"] = Desc{ID: "a", CanToggle: true}
	list := r.List()
	if len(list) != 2 || list[0].ID != "a" || list[1].ID != "b" {
		t.Fatalf("list not sorted: %+v", list)
	}
}
