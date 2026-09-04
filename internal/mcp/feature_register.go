package mcp

import "owiki/internal/feature"

// L2 内置插件注册：MCP 服务。原 OWIKI_MCP=off env 开关收编进 feature 体系
// （env 仅作首次启动默认值；用户在 Web 设置页动过后 DB 值优先）。
func init() {
	feature.Register(feature.Desc{
		ID:     "mcp",
		Name:   "MCP 服务",
		Desc:   "内嵌 Model Context Protocol 端点，AI 助手直连管理笔记",
		Default: true, CanToggle: true,
		EnvKey: "OWIKI_MCP",
	})
}
