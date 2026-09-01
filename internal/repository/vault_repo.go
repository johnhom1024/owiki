package repository

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"owiki/internal/model"

	"gorm.io/gorm"
)

var ErrVaultNotFound = errors.New("vault not found")

// VaultRepo vault 存储（SQLite）
type VaultRepo struct {
	db *gorm.DB
}

func NewVaultRepo(db *gorm.DB) (*VaultRepo, error) {
	if err := db.AutoMigrate(&model.Vault{}); err != nil {
		return nil, err
	}
	return &VaultRepo{db: db}, nil
}

// NewToken 生成随机同步令牌（32 hex 字符）
func NewToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand 失败基本等于系统已坏
	}
	return "owk_" + hex.EncodeToString(b)
}

func (r *VaultRepo) List(ctx context.Context) ([]model.Vault, error) {
	var vs []model.Vault
	if err := r.db.WithContext(ctx).Order("id ASC").Find(&vs).Error; err != nil {
		return nil, err
	}
	return vs, nil
}

func (r *VaultRepo) GetByID(ctx context.Context, id int64) (*model.Vault, error) {
	var v model.Vault
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&v).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrVaultNotFound
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (r *VaultRepo) GetByToken(ctx context.Context, token string) (*model.Vault, error) {
	if token == "" {
		return nil, ErrVaultNotFound
	}
	var v model.Vault
	err := r.db.WithContext(ctx).Where("token = ?", token).First(&v).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrVaultNotFound
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (r *VaultRepo) Create(ctx context.Context, name, note string) (*model.Vault, error) {
	v := &model.Vault{Name: name, Note: note, Token: NewToken()}
	if err := r.db.WithContext(ctx).Create(v).Error; err != nil {
		return nil, err
	}
	return v, nil
}

func (r *VaultRepo) Update(ctx context.Context, id int64, name, note string) (*model.Vault, error) {
	v, err := r.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if name != "" {
		v.Name = name
	}
	v.Note = note
	if err := r.db.WithContext(ctx).Save(v).Error; err != nil {
		return nil, err
	}
	return v, nil
}

// Save 全量保存 vault 记录（单设备同步等字段更新用）
func (r *VaultRepo) Save(ctx context.Context, v *model.Vault) error {
	return r.db.WithContext(ctx).Save(v).Error
}

// SetSingleDevice 更新单设备同步开关与 pin 设备。
// enabled=false 时一并清空 pin（取消授权/解绑场景防残留卡死）。
func (r *VaultRepo) SetSingleDevice(ctx context.Context, id int64, enabled bool, deviceID string) error {
	if !enabled {
		deviceID = ""
	}
	return r.db.WithContext(ctx).Model(&model.Vault{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"single_device":    enabled,
			"pinned_device_id": deviceID,
		}).Error
}

// RotateToken 重置同步令牌（旧连接的 token 立即失效）
func (r *VaultRepo) RotateToken(ctx context.Context, id int64) (string, error) {
	v, err := r.GetByID(ctx, id)
	if err != nil {
		return "", err
	}
	v.Token = NewToken()
	if err := r.db.WithContext(ctx).Save(v).Error; err != nil {
		return "", err
	}
	return v.Token, nil
}

// Delete 删除 vault（note 记录由上层决定是否连带清理）
func (r *VaultRepo) Delete(ctx context.Context, id int64) error {
	res := r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Vault{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrVaultNotFound
	}
	return nil
}

// SetLastSeen 记录 vault 最近一次客户端认证成功（授权状态判定用）
func (r *VaultRepo) SetLastSeen(ctx context.Context, id int64, t time.Time) error {
	return r.db.WithContext(ctx).Model(&model.Vault{}).
		Where("id = ?", id).Update("last_seen_at", t).Error
}

// ClearAuth 清除授权状态：last_seen_at 置空（配合 RotateToken 一起用）
func (r *VaultRepo) ClearAuth(ctx context.Context, id int64) error {
	return r.db.WithContext(ctx).Model(&model.Vault{}).
		Where("id = ?", id).Update("last_seen_at", nil).Error
}

// EnsureDefault 确保存在默认 vault：没有则用 fallbackToken 创建，
// 并把所有 vault_id 为 0 的旧笔记归入。返回默认 vault。
func (r *VaultRepo) EnsureDefault(ctx context.Context, fallbackToken string, noteRepo *NoteRepo) (*model.Vault, error) {
	var vs []model.Vault
	if err := r.db.WithContext(ctx).Order("id ASC").Find(&vs).Error; err != nil {
		return nil, err
	}
	if len(vs) > 0 {
		return &vs[0], nil
	}
	token := fallbackToken
	if token == "" {
		token = NewToken()
	}
	v := &model.Vault{Name: "default", Note: "默认 vault（由旧版数据迁移而来）", Token: token}
	if err := r.db.WithContext(ctx).Create(v).Error; err != nil {
		return nil, err
	}
	// 旧笔记归入默认 vault
	if err := r.db.WithContext(ctx).Model(&model.Note{}).
		Where("vault_id = 0").Update("vault_id", v.ID).Error; err != nil {
		return nil, err
	}
	_ = noteRepo // 保持签名稳定
	return v, nil
}
