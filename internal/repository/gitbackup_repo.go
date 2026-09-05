package repository

import (
	"context"
	"errors"
	"time"

	"owiki/internal/model"

	"gorm.io/gorm"
)

var ErrGitBackupNotFound = errors.New("git backup config not found")

// GitBackupRepo vault 级 git 备份配置存储（vault_git_backups 表）。
// feature 总开关（feature.gitbackup.enabled）在 SettingRepo，与本表正交。
type GitBackupRepo struct {
	db *gorm.DB
}

func NewGitBackupRepo(db *gorm.DB) (*GitBackupRepo, error) {
	if err := db.AutoMigrate(&model.VaultGitBackup{}); err != nil {
		return nil, err
	}
	return &GitBackupRepo{db: db}, nil
}

// GetByVault 取配置；无记录时返回 ErrGitBackupNotFound。
func (r *GitBackupRepo) GetByVault(ctx context.Context, vaultID int64) (*model.VaultGitBackup, error) {
	var b model.VaultGitBackup
	err := r.db.WithContext(ctx).Where("vault_id = ?", vaultID).First(&b).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrGitBackupNotFound
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// GetOrCreate 无记录时建一条空配置（enabled=false），有则原样返回。
func (r *GitBackupRepo) GetOrCreate(ctx context.Context, vaultID int64) (*model.VaultGitBackup, error) {
	b, err := r.GetByVault(ctx, vaultID)
	if err == nil {
		return b, nil
	}
	if !errors.Is(err, ErrGitBackupNotFound) {
		return nil, err
	}
	b = &model.VaultGitBackup{
		VaultID:     vaultID,
		Branch:      "main",
		DebounceSec: 15,
		Enabled:     false,
		Status:      "idle",
	}
	if err := r.db.WithContext(ctx).Create(b).Error; err != nil {
		// 并发兜底：撞唯一索引就改读已有记录
		return r.GetByVault(ctx, vaultID)
	}
	return b, nil
}

// Save 整行保存（PUT 配置接口与 worker 状态回写共用）。
func (r *GitBackupRepo) Save(ctx context.Context, b *model.VaultGitBackup) error {
	return r.db.WithContext(ctx).Save(b).Error
}

// ListEnabled 全部 enabled 的配置（Manager 启动扫表起 worker 用）。
// feature 总开关的过滤不在 SQL 层做——由调用方查 feature.Use().Enabled("gitbackup")。
func (r *GitBackupRepo) ListEnabled(ctx context.Context) ([]model.VaultGitBackup, error) {
	var bs []model.VaultGitBackup
	err := r.db.WithContext(ctx).Where("enabled = ?", true).Find(&bs).Error
	return bs, err
}

// UpdateStatus worker 回写运行状态（status/last_run_at/last_error）。
func (r *GitBackupRepo) UpdateStatus(ctx context.Context, vaultID int64, status, lastError string, lastRunAt time.Time) error {
	return r.db.WithContext(ctx).Model(&model.VaultGitBackup{}).
		Where("vault_id = ?", vaultID).
		Updates(map[string]any{
			"status":     status,
			"last_error": lastError,
			"last_run_at": lastRunAt,
		}).Error
}

// UpdateSuccess 成功路径回写：commit SHA + push 时间 + 状态归零。
// pushOK=false 时只更新 commit SHA（本地已提交但推送失败的场景）。
func (r *GitBackupRepo) UpdateSuccess(ctx context.Context, vaultID int64, commitSHA string, pushed bool, at time.Time) error {
	updates := map[string]any{
		"last_commit_sha": commitSHA,
		"status":          "idle",
		"last_error":      "",
		"last_run_at":     at,
	}
	if pushed {
		updates["last_push_at"] = at
	}
	return r.db.WithContext(ctx).Model(&model.VaultGitBackup{}).
		Where("vault_id = ?", vaultID).
		Updates(updates).Error
}

// DeleteByVault vault 删除时连带清理配置记录（工作树目录由 Manager 清理）。
func (r *GitBackupRepo) DeleteByVault(ctx context.Context, vaultID int64) error {
	return r.db.WithContext(ctx).Where("vault_id = ?", vaultID).Delete(&model.VaultGitBackup{}).Error
}
