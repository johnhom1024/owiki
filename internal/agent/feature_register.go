package agent

import "owiki/internal/feature"

// L2 内置插件注册：AI 对话。
// 总开关管「功能存不存在」（端点挂 feature.Require("chat") 门禁）；
// 入口显隐另叠 ready 判断（三项配置齐全且测试通过）——两级门禁串联。
func init() {
	feature.Register(feature.Desc{
		ID:     "chat",
		Name:   "AI 对话",
		Desc:   "内置 AI 助手：右侧对话面板，直接读写整理笔记库",
		Default: false, CanToggle: true,
		EnvKey: "OWIKI_CHAT",
	})
}
