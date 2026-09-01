package repository

import (
	"context"

	"owiki/internal/model"
)

// ListAll 文件列表（按更新时间倒序）——Web 端用。
// vaultID=0 且 anyVault=true 时跨 vault 列出全部（旧 /api/files 兼容）。
func (r *NoteRepo) ListAll(ctx context.Context, vaultID int64, anyVault bool) ([]model.Note, error) {
	q := r.db.WithContext(ctx).
		Select("id", "vault_id", "path", "content_hash", "mtime", "size", "updated_at")
	if !anyVault {
		q = q.Where("vault_id = ?", vaultID)
	}
	var notes []model.Note
	err := q.Order("updated_at DESC").Find(&notes).Error
	return notes, err
}

// ListWithContent 全量笔记（含正文），限单 vault——openapi 搜索用。
func (r *NoteRepo) ListWithContent(ctx context.Context, vaultID int64) ([]model.Note, error) {
	var notes []model.Note
	err := r.db.WithContext(ctx).
		Where("vault_id = ?", vaultID).
		Find(&notes).Error
	return notes, err
}

// GetByID Web 端按 id 取单个文件（含正文）；anyVault=true 时不限 vault
func (r *NoteRepo) GetByID(ctx context.Context, vaultID int64, id int64, anyVault bool) (*model.Note, error) {
	var n model.Note
	q := r.db.WithContext(ctx)
	if !anyVault {
		q = q.Where("vault_id = ? AND id = ?", vaultID, id)
	} else {
		q = q.Where("id = ?", id)
	}
	err := q.First(&n).Error
	if err != nil {
		return nil, ErrNotFound
	}
	return &n, nil
}

// Stats 库统计（按 vault）
type Stats struct {
	TotalFiles int64 `json:"totalFiles"`
	TotalSize  int64 `json:"totalSize"`
}

func (r *NoteRepo) Stats(ctx context.Context, vaultID int64) (*Stats, error) {
	var s Stats
	err := r.db.WithContext(ctx).
		Model(&model.Note{}).
		Where("vault_id = ?", vaultID).
		Select("COUNT(*) as total_files, COALESCE(SUM(size),0) as total_size").
		Scan(&s).Error
	return &s, err
}
