package tools

import (
	"errors"
	"strconv"
)

// 认证 / vault 解析错误（文案与重构前 MCP 层一致，外部 agent 依赖这些字符串）。
var (
	ErrScope         = errors.New("vault not in key scope")
	ErrVaultNotFound = errors.New("vault not found")
	ErrVaultRequired = errors.New("vault required: pass vault id or name (multiple vaults exist)")
	ErrNoAPIKey      = errors.New("no api key on request")
	ErrInvalidAPIKey = errors.New("invalid api key")
	ErrPathRequired  = errors.New("path required")
	ErrTagRequired   = errors.New("tag required")
	ErrQueryRequired = errors.New("query required")
)

// NotFoundError 笔记不存在（模型可读）。
type NotFoundError struct{ Path string }

func (e *NotFoundError) Error() string { return "note not found: " + e.Path }

// ConflictError 写冲突 409：附带服务端当前 hash，模型可重新读取合并。
type ConflictError struct {
	ServerHash string
	Hint       string
}

func (e *ConflictError) Error() string {
	return "conflict: note modified concurrently (serverHash=" + e.ServerHash + "); re-read, merge, and retry, or force=true to overwrite"
}

func parseVaultID(s string) (int64, bool) {
	id, err := strconv.ParseInt(s, 10, 64)
	return id, err == nil
}
