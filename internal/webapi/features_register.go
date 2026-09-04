package webapi

import "owiki/internal/feature"

// L2 内置插件：三个样板功能的静态注册。
// 路由挂载不变，运行时门禁由 feature.Require 中间件按请求拦截。
// 开关状态：DB settings > env（首次启动默认）> 代码 Default。

func init() {
	feature.Register(feature.Desc{
		ID:     "share",
		Name:   "文章分享",
		Desc:   "把单篇笔记生成公开链接，免登录只读访问",
		Default: true, CanToggle: true,
		EnvKey: "OWIKI_SHARE",
	})
	feature.Register(feature.Desc{
		ID:     "synclog",
		Name:   "同步日志",
		Desc:   "记录笔记同步留痕，vault 设置页展示时间线",
		Default: true, CanToggle: true,
		EnvKey: "OWIKI_SYNCLOG",
	})
	feature.Register(feature.Desc{
		ID:     "apikeys",
		Name:   "API 密钥",
		Desc:   "给 AI 助手/脚本签发访问密钥的开放接口（/openapi）",
		Default: true, CanToggle: true,
		EnvKey: "OWIKI_APIKEYS",
	})
}
