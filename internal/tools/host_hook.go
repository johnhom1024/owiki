package tools

// SetRegistryForTest 测试钩子：直接注入预构建注册表（跳过 build 的
// 全量依赖装配）。仅测试代码使用，生产路径勿调。
func (h *Host) SetRegistryForTest(r *Registry) { h.reg = r }
