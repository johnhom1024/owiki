package model

import "time"

// AISettings 内置 AI 对话的供应商配置。存 settings 表（key-value），
// 不用独立列——三项本来就一行 JSON 的事。
//
// 密钥语义（与 owk_ 开放密钥相反）：服务端 agent loop 每次请求都要用
// 供应商 key，必须能取回明文；GET 回给前端只报 apiKeySet，永不回明文。
// 再保存时空 key = 保留原值。
type AISettings struct {
	Enabled bool   `json:"enabled"`
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
	// LastTestOK 上次「测试连接」是否成功（ready 判断用）。
	LastTestOK bool      `json:"lastTestOk"`
	LastTestAt time.Time `json:"lastTestAt"`
	// LastTestErr 测试失败时的供应商报错（前端展示）。
	LastTestErr string `json:"lastTestErr"`
}

// Ready 入口显隐条件：开关开 + 三项齐全 + 上次测试成功。
// 没配、配了没测过、测失败，三种情况右侧对话入口都不出现。
func (a *AISettings) Ready() bool {
	return a != nil && a.Enabled && a.BaseURL != "" && a.APIKey != "" && a.Model != "" && a.LastTestOK
}
