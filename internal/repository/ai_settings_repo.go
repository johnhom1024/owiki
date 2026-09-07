package repository

import (
	"context"
	"encoding/json"
	"errors"

	"owiki/internal/model"

	"gorm.io/gorm"
)

// aiSettingsKey settings 表里 AI 配置的键。
const aiSettingsKey = "ai.settings"

// ErrAISettingsNotSaved 尚未保存过 AI 配置。
var ErrAISettingsNotSaved = errors.New("ai settings not saved")

// AISettingsRepo AI 供应商配置存取（settings 表 key-value，JSON 值）。
type AISettingsRepo struct {
	db *gorm.DB
}

func NewAISettingsRepo(db *gorm.DB) *AISettingsRepo {
	return &AISettingsRepo{db: db}
}

// Load 读配置；从未保存过返回 ErrAISettingsNotSaved。
func (r *AISettingsRepo) Load(ctx context.Context) (*model.AISettings, error) {
	var s model.Setting
	err := r.db.WithContext(ctx).Where("key = ?", aiSettingsKey).First(&s).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAISettingsNotSaved
		}
		return nil, err
	}
	var a model.AISettings
	if err := json.Unmarshal([]byte(s.Value), &a); err != nil {
		return nil, err
	}
	return &a, nil
}

// Save 全量写回。
func (r *AISettingsRepo) Save(ctx context.Context, a *model.AISettings) error {
	b, err := json.Marshal(a)
	if err != nil {
		return err
	}
	row := model.Setting{Key: aiSettingsKey, Value: string(b)}
	return r.db.WithContext(ctx).Clauses(onConflictUpdateValue()).Create(&row).Error
}

// Update 部分更新（apiKey 空串 = 保留原值语义在调用方处理）。
func (r *AISettingsRepo) Update(ctx context.Context, fn func(a *model.AISettings)) error {
	a, err := r.Load(ctx)
	if err != nil {
		if !errors.Is(err, ErrAISettingsNotSaved) {
			return err
		}
		a = &model.AISettings{}
	}
	fn(a)
	return r.Save(ctx, a)
}
