package repository

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"

	"owiki/internal/model"

	"gorm.io/gorm"
)

// ShareRepo 笔记对外分享管理（Web 端分享按钮 + /share/* 公开页）。
type ShareRepo struct {
	db *gorm.DB
}

var ErrShareNotFound = errors.New("share not found")

// shareAlphabet 无歧义字符集（去掉 0/O、1/l/I），
// 8 位组合空间 32^8 ≈ 1.1e12，猜中概率可忽略。
const shareAlphabet = "23456789abcdefghjkmnpqrstuvwxyz"

func NewShareRepo(db *gorm.DB) (*ShareRepo, error) {
	if err := db.AutoMigrate(&model.Share{}); err != nil {
		return nil, err
	}
	return &ShareRepo{db: db}, nil
}

func newShareToken() string {
	buf := make([]byte, 8)
	for i := range buf {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(shareAlphabet))))
		buf[i] = shareAlphabet[n.Int64()]
	}
	return string(buf)
}

// GetOrCreateByNoteID 拉取笔记当前的分享记录；没有则建一条（enabled=false）。
// token 只在首次创建时生成，之后开关切换不变 URL。
func (r *ShareRepo) GetOrCreateByNoteID(ctx context.Context, vaultID, noteID int64) (*model.Share, error) {
	var s model.Share
	err := r.db.WithContext(ctx).Where("note_id = ?", noteID).First(&s).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		s = model.Share{VaultID: vaultID, NoteID: noteID, Token: newShareToken(), Enabled: false}
		// 并发兜底：撞了唯一索引就改读已有记录
		if err := r.db.WithContext(ctx).Create(&s).Error; err != nil {
			return r.GetByNoteID(ctx, noteID)
		}
		return &s, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *ShareRepo) GetByNoteID(ctx context.Context, noteID int64) (*model.Share, error) {
	var s model.Share
	err := r.db.WithContext(ctx).Where("note_id = ?", noteID).First(&s).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrShareNotFound
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// GetByToken 公开页查询：只有 enabled 的记录能命中（关闭即 404）。
func (r *ShareRepo) GetByToken(ctx context.Context, token string) (*model.Share, error) {
	var s model.Share
	err := r.db.WithContext(ctx).Where("token = ? AND enabled = ?", token, true).First(&s).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrShareNotFound
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// SetEnabled 开/关分享。记录不存在时静默失败（先 GetOrCreate 再开关）。
func (r *ShareRepo) SetEnabled(ctx context.Context, noteID int64, enabled bool) (*model.Share, error) {
	s, err := r.GetByNoteID(ctx, noteID)
	if err != nil {
		return nil, err
	}
	s.Enabled = enabled
	if err := r.db.WithContext(ctx).Save(s).Error; err != nil {
		return nil, err
	}
	return s, nil
}

// DeleteByNoteID 笔记删除时连带清理
func (r *ShareRepo) DeleteByNoteID(ctx context.Context, noteID int64) error {
	return r.db.WithContext(ctx).Where("note_id = ?", noteID).Delete(&model.Share{}).Error
}

// DeleteByVault vault 删除时连带清理
func (r *ShareRepo) DeleteByVault(ctx context.Context, vaultID int64) error {
	return r.db.WithContext(ctx).Where("vault_id = ?", vaultID).Delete(&model.Share{}).Error
}
