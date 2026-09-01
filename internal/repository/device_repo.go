package repository

import (
	"context"
	"errors"
	"time"

	"owiki/internal/model"

	"gorm.io/gorm"
)

// DeviceRepo vault 设备存储
type DeviceRepo struct {
	db *gorm.DB
}

func NewDeviceRepo(db *gorm.DB) (*DeviceRepo, error) {
	if err := db.AutoMigrate(&model.VaultDevice{}); err != nil {
		return nil, err
	}
	return &DeviceRepo{db: db}, nil
}

// AuthResult 认证时设备校验的结果
type AuthResult struct {
	Device *model.VaultDevice
	// NewDevice 本次认证自动登记了新设备
	NewDevice bool
}

// Authenticate token 认证通过后的设备登记：
// 设备首次出现 → 自动登记；已存在 → 更新在线时间、设备名与客户端版本。
func (r *DeviceRepo) Authenticate(ctx context.Context, vaultID int64, deviceID, deviceName, clientVersion string) (*AuthResult, error) {
	if deviceID == "" {
		return nil, errors.New("empty deviceId")
	}
	var d model.VaultDevice
	err := r.db.WithContext(ctx).
		Where("vault_id = ? AND device_id = ?", vaultID, deviceID).First(&d).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// 首次出现：自动登记
		d = model.VaultDevice{
			VaultID: vaultID, DeviceID: deviceID,
			DeviceName: deviceName, ClientVersion: clientVersion,
		}
		if err := r.db.WithContext(ctx).Create(&d).Error; err != nil {
			return nil, err
		}
		return &AuthResult{Device: &d, NewDevice: true}, nil
	}
	if err != nil {
		return nil, err
	}
	// 更新在线时间、设备名与客户端版本（用户可能改过 vault 名、升级了插件）
	d.DeviceName = deviceName
	d.ClientVersion = clientVersion
	d.LastSeenAt = time.Now()
	if err := r.db.WithContext(ctx).Save(&d).Error; err != nil {
		return nil, err
	}
	return &AuthResult{Device: &d}, nil
}

// List 某 vault 的全部设备记录（前端设备列表展示）
func (r *DeviceRepo) List(ctx context.Context, vaultID int64) ([]model.VaultDevice, error) {
	var ds []model.VaultDevice
	err := r.db.WithContext(ctx).Where("vault_id = ?", vaultID).
		Order("last_seen_at DESC").Find(&ds).Error
	return ds, err
}

// Unbind 客户端主动断开（bye）：删除设备绑定记录。
// 解绑后同一设备携有效 token 重连会重新登记。
func (r *DeviceRepo) Unbind(ctx context.Context, vaultID int64, deviceID string) error {
	if deviceID == "" {
		return nil
	}
	return r.db.WithContext(ctx).
		Where("vault_id = ? AND device_id = ?", vaultID, deviceID).
		Delete(&model.VaultDevice{}).Error
}

// HasActive 某 vault 是否还有设备记录（authorized 判定用）
func (r *DeviceRepo) HasActive(ctx context.Context, vaultID int64) (bool, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&model.VaultDevice{}).
		Where("vault_id = ?", vaultID).
		Count(&n).Error
	return n > 0, err
}

// DeleteByVault vault 删除时连带清理
func (r *DeviceRepo) DeleteByVault(ctx context.Context, vaultID int64) error {
	return r.db.WithContext(ctx).Where("vault_id = ?", vaultID).
		Delete(&model.VaultDevice{}).Error
}
