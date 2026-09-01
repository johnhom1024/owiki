package repository

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// AttachStore 附件（图片等二进制）的文件系统存储。
// 布局：<root>/<vaultID>/<sanitized-path>，元数据仍走 notes 表（Content 存空串）。
// root 一般是 DB 同目录下的 attachments/。
type AttachStore struct {
	root string
}

var (
	ErrInvalidPath = errors.New("invalid attachment path")
)

var base64Std = base64.StdEncoding

func NewAttachStore(root string) (*AttachStore, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	return &AttachStore{root: root}, nil
}

// isAttachmentExt 判断扩展名是否按附件（二进制）处理
func isAttachmentExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif", ".pdf":
		return true
	}
	return false
}

// IsAttachment 判断笔记路径是否是附件
func IsAttachment(path string) bool {
	return isAttachmentExt(filepath.Ext(path))
}

// relDisk 把 vault 内相对路径转成 root 下的安全相对路径（防穿越）。
// vault 路径统一是斜杠分隔；清理后必须仍落在 vault 内。
func relDisk(vaultID int64, vaultPath string) (string, error) {
	p := path.Clean("/" + strings.ReplaceAll(vaultPath, "\\", "/"))
	p = strings.TrimPrefix(p, "/")
	if p == "" || p == "." || strings.Contains(p, "\x00") {
		return "", ErrInvalidPath
	}
	// path.Clean("/"+x) 已消除 ".." 逃逸（../ 会被归一到根），再兜底检查一次
	if strings.HasPrefix(p, "../") || p == ".." {
		return "", ErrInvalidPath
	}
	return filepath.Join(fmt.Sprint(vaultID), filepath.FromSlash(p)), nil
}

func (s *AttachStore) fullPath(vaultID int64, vaultPath string) (string, error) {
	rel, err := relDisk(vaultID, vaultPath)
	if err != nil {
		return "", err
	}
	return filepath.Join(s.root, rel), nil
}

// Save 写入 base64 编码的附件，返回字节数
func (s *AttachStore) Save(vaultID int64, vaultPath, contentB64 string) (int, error) {
	data, err := base64Std.DecodeString(contentB64)
	if err != nil {
		return 0, err
	}
	full, err := s.fullPath(vaultID, vaultPath)
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return 0, err
	}
	if err := os.WriteFile(full, data, 0o644); err != nil {
		return 0, err
	}
	return len(data), nil
}

// Load 读取附件（返回 base64 + 字节数；Web WS 下载用）
func (s *AttachStore) Load(vaultID int64, vaultPath string) (string, int, error) {
	full, err := s.fullPath(vaultID, vaultPath)
	if err != nil {
		return "", 0, err
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return "", 0, err
	}
	return base64Std.EncodeToString(data), len(data), nil
}

// LoadBytes 读取原始字节（HTTP 响应用）
func (s *AttachStore) LoadBytes(vaultID int64, vaultPath string) ([]byte, error) {
	full, err := s.fullPath(vaultID, vaultPath)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(full)
}

// Delete 删除附件文件（不存在视为成功）
func (s *AttachStore) Delete(vaultID int64, vaultPath string) error {
	full, err := s.fullPath(vaultID, vaultPath)
	if err != nil {
		return err
	}
	if err := os.Remove(full); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// Rename 移动附件文件（源不存在视为无需移动）
func (s *AttachStore) Rename(vaultID int64, from, to string) error {
	src, err := s.fullPath(vaultID, from)
	if err != nil {
		return err
	}
	dst, err := s.fullPath(vaultID, to)
	if err != nil {
		return err
	}
	if _, err := os.Stat(src); os.IsNotExist(err) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.Rename(src, dst)
}

// Hash 计算附件的 SHA-256
func (s *AttachStore) Hash(vaultID int64, vaultPath string) (string, error) {
	data, err := s.LoadBytes(vaultID, vaultPath)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

// ContentType 按扩展名给 MIME（Web 端 <img> 需要）
func ContentType(vaultPath string) string {
	switch strings.ToLower(path.Ext(vaultPath)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".bmp":
		return "image/bmp"
	case ".ico":
		return "image/x-icon"
	case ".avif":
		return "image/avif"
	case ".pdf":
		return "application/pdf"
	}
	return "application/octet-stream"
}
