package repository

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"

	"owiki/internal/model"

	"gorm.io/gorm"
)

// ApiKeyRepo 开放接口的 API Key 管理。
// 明文只在创建时返回一次，库里只存 SHA-256（泄露库文件不等于泄露 key）。
type ApiKeyRepo struct {
	db *gorm.DB
}

func NewApiKeyRepo(db *gorm.DB) (*ApiKeyRepo, error) {
	if err := db.AutoMigrate(&model.ApiKey{}); err != nil {
		return nil, err
	}
	return &ApiKeyRepo{db: db}, nil
}

var ErrApiKeyNotFound = errors.New("api key not found")

// Generate 生成新 key：明文形如 owk_<32 字节 base64url>（去掉填充）
func GenerateApiKey() (plaintext, hash, prefix string) {
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	plaintext = "owk_" + base64.RawURLEncoding.EncodeToString(buf)
	return plaintext, HashApiKey(plaintext), plaintext[:12]
}

// HashApiKey 明文 → 存储哈希
func HashApiKey(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}

// Create 落库（name 备注用途，vaultScope 限定可用 vault，0=全部；readOnly=true 则只能调只读工具）
func (r *ApiKeyRepo) Create(ctx context.Context, name, hash, prefix string, vaultScope int64, readOnly bool) (*model.ApiKey, error) {
	k := &model.ApiKey{Name: name, KeyHash: hash, KeyPrefix: prefix, VaultScope: vaultScope, ReadOnly: readOnly}
	if err := r.db.WithContext(ctx).Create(k).Error; err != nil {
		return nil, err
	}
	return k, nil
}

// List 全部 key（不含哈希本身之外的敏感信息本来就只有哈希）
func (r *ApiKeyRepo) List(ctx context.Context) ([]model.ApiKey, error) {
	var keys []model.ApiKey
	if err := r.db.WithContext(ctx).Order("id DESC").Find(&keys).Error; err != nil {
		return nil, err
	}
	return keys, nil
}

// Delete 按 id 删除
func (r *ApiKeyRepo) Delete(ctx context.Context, id int64) error {
	res := r.db.WithContext(ctx).Delete(&model.ApiKey{}, id)
	if res.RowsAffected == 0 {
		return ErrApiKeyNotFound
	}
	return nil
}

// Verify 明文 → (apiKey, vaultScope, ok)。O(1) 哈希查找。
func (r *ApiKeyRepo) Verify(ctx context.Context, plaintext string) (*model.ApiKey, bool) {
	var k model.ApiKey
	err := r.db.WithContext(ctx).Where("key_hash = ?", HashApiKey(plaintext)).First(&k).Error
	if err != nil {
		return nil, false
	}
	return &k, true
}

// TouchKey 最近使用时间（失败不影响主流程）
func (r *ApiKeyRepo) TouchKey(ctx context.Context, id int64) {
	_ = r.db.WithContext(ctx).Model(&model.ApiKey{}).Where("id = ?", id).
		Update("last_used_at", time.Now()).Error
}
