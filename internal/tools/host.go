package tools

import (
	"context"

	"owiki/internal/hub"
	"owiki/internal/model"
	"owiki/internal/repository"
)

// Host 工具层依赖：repo / hub / 版本号。MCP 与未来的 agent loop 共用同一份。
type Host struct {
	Repo    *repository.NoteRepo
	Vaults  *repository.VaultRepo
	Keys    *repository.ApiKeyRepo
	Attach  *repository.AttachStore
	Devices *repository.DeviceRepo
	Hub     *hub.Hub
	SyncLog *repository.SyncLogRepo
	Share   *repository.ShareRepo
	Version string

	reg *Registry
}

// Registry 懒构建并缓存工具注册表。schema 生成失败视为程序员错误，直接 panic。
func (h *Host) Registry() *Registry {
	if h.reg != nil {
		return h.reg
	}
	r, err := h.build()
	if err != nil {
		panic("tools registry: " + err.Error())
	}
	h.reg = r
	return r
}

// RequireVault 解析 vault 参数并校验 key 作用域，返回 vault id。
func (h *Host) RequireVault(ctx context.Context, s *Session, vault string) (int64, error) {
	if s == nil || s.Key == nil {
		return 0, ErrNoAPIKey
	}
	vid, _, err := h.ResolveVault(ctx, s.Key, vault)
	return vid, err
}

// ResolveVault 把 vault 参数（id 或 name）解析成 vault id，并校验 key 作用域。
// vault 为空时：key 限定了 vault → 用该 vault；否则若服务器只有一个 vault 则默认它；
// 多个 vault 时强制要求指定。
func (h *Host) ResolveVault(ctx context.Context, k *model.ApiKey, vault string) (int64, *model.Vault, error) {
	if k.VaultScope != 0 && vault == "" {
		v, err := h.Vaults.GetByID(ctx, k.VaultScope)
		if err != nil {
			return 0, nil, err
		}
		return v.ID, v, nil
	}
	if vault == "" {
		vaults, err := h.Vaults.List(ctx)
		if err != nil {
			return 0, nil, err
		}
		var allowed []model.Vault
		for _, v := range vaults {
			if k.VaultScope == 0 || k.VaultScope == v.ID {
				allowed = append(allowed, v)
			}
		}
		if len(allowed) == 1 {
			return allowed[0].ID, &allowed[0], nil
		}
		if len(allowed) == 0 {
			return 0, nil, ErrVaultNotFound
		}
		return 0, nil, ErrVaultRequired
	}
	if id, ok := parseVaultID(vault); ok {
		v, err := h.Vaults.GetByID(ctx, id)
		if err == nil {
			if k.VaultScope != 0 && k.VaultScope != v.ID {
				return 0, nil, ErrScope
			}
			return v.ID, v, nil
		}
	}
	vaults, err := h.Vaults.List(ctx)
	if err != nil {
		return 0, nil, err
	}
	for _, v := range vaults {
		if v.Name == vault {
			if k.VaultScope != 0 && k.VaultScope != v.ID {
				return 0, nil, ErrScope
			}
			return v.ID, &v, nil
		}
	}
	return 0, nil, ErrVaultNotFound
}

func (h *Host) markdownNotes(ctx context.Context, s *Session, vault string) ([]model.Note, error) {
	vid, err := h.RequireVault(ctx, s, vault)
	if err != nil {
		return nil, err
	}
	notes, err := h.Repo.ListWithContent(ctx, vid)
	if err != nil {
		return nil, err
	}
	out := make([]model.Note, 0, len(notes))
	for _, n := range notes {
		if repository.IsAttachment(n.Path) {
			continue
		}
		out = append(out, n)
	}
	return out, nil
}
