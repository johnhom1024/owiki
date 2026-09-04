package repository

import (
	"context"

	"owiki/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SettingRepo 通用 key-value 配置存取（feature 开关持久化用）。
type SettingRepo struct {
	db *gorm.DB
}

func NewSettingRepo(db *gorm.DB) (*SettingRepo, error) {
	if err := db.AutoMigrate(&model.Setting{}); err != nil {
		return nil, err
	}
	return &SettingRepo{db: db}, nil
}

// Get 按 key 取值；不存在时 ok=false（不算错误）。
func (r *SettingRepo) Get(ctx context.Context, key string) (value string, ok bool, err error) {
	var s model.Setting
	err = r.db.WithContext(ctx).Where("key = ?", key).First(&s).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return "", false, nil
		}
		return "", false, err
	}
	return s.Value, true, nil
}

// Set upsert 一条配置。
func (r *SettingRepo) Set(ctx context.Context, key, value string) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
	}).Create(&model.Setting{Key: key, Value: value}).Error
}

// GetAll 取全部配置（启动时 feature registry 批量加载用；配置量级很小）。
func (r *SettingRepo) GetAll(ctx context.Context) (map[string]string, error) {
	var rows []model.Setting
	if err := r.db.WithContext(ctx).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]string, len(rows))
	for _, row := range rows {
		out[row.Key] = row.Value
	}
	return out, nil
}
