package gitbackup

import "owiki/internal/feature"

// L2 内置插件注册：Git 远程备份。
// 两级开关：feature 总开关（settings 表）+ vault 级开关（vault_git_backups.enabled），
// 两者同时开着才会真正跑备份。默认关闭（新装不自动起备份任务）。
func init() {
	feature.Register(feature.Desc{
		ID:     FeatureID,
		Name:   "Git 备份",
		Desc:   "把 vault 内容物化后以 git commit 推送到远程仓库（GitHub/CNB 等），作为异地备份",
		Default: false, CanToggle: true,
		EnvKey: "OWIKI_GITBACKUP",
	})
}
