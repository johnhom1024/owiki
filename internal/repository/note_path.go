package repository

import (
	"path"
	"strings"
	"unicode"
)

const maxNotePathLen = 1024

// NormalizeNotePath 把用户输入整理成 vault 内相对路径。
// 统一用 / 分隔、去掉 . 与 ..、空扩展名补 .md；附件扩展名与非法字符拒绝。
func NormalizeNotePath(raw string) (string, error) {
	p := strings.TrimSpace(raw)
	p = strings.ReplaceAll(p, "\\", "/")
	if p == "" || strings.ContainsRune(p, 0) {
		return "", ErrInvalidPath
	}
	if strings.ContainsAny(p, `<>:"|?*`) {
		return "", ErrInvalidPath
	}
	for _, r := range p {
		if unicode.IsControl(r) {
			return "", ErrInvalidPath
		}
	}

	cleaned := path.Clean("/" + p)
	cleaned = strings.TrimPrefix(cleaned, "/")
	if cleaned == "" || cleaned == "." || cleaned == ".." {
		return "", ErrInvalidPath
	}
	if strings.HasPrefix(cleaned, "../") {
		return "", ErrInvalidPath
	}
	for _, seg := range strings.Split(cleaned, "/") {
		if seg == "" || strings.TrimSpace(seg) == "" || strings.Trim(seg, ".") == "" {
			return "", ErrInvalidPath
		}
	}
	if IsAttachment(cleaned) {
		return "", ErrInvalidPath
	}
	if path.Ext(cleaned) == "" {
		cleaned += ".md"
	}
	base := path.Base(cleaned)
	stem := strings.TrimSuffix(base, path.Ext(base))
	if strings.Trim(stem, ".") == "" {
		return "", ErrInvalidPath
	}
	if len(cleaned) > maxNotePathLen {
		return "", ErrInvalidPath
	}
	return cleaned, nil
}

// NoteTitleFromPath 从路径取出不含扩展名的文件名，用作新建笔记的默认标题。
func NoteTitleFromPath(p string) string {
	base := path.Base(p)
	ext := path.Ext(base)
	title := strings.TrimSuffix(base, ext)
	if title == "" || title == "." {
		return "Untitled"
	}
	return title
}
