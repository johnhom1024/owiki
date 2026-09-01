package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"

	"owiki/internal/merge"
	"owiki/internal/model"
	"owiki/internal/repository"
)

var (
	ErrHashMismatch = errors.New("content hash mismatch")
	ErrConflict     = errors.New("conflict")
)

type ConflictError struct {
	Server *model.Note
	Hint   string
}

func (e *ConflictError) Error() string { return ErrConflict.Error() }

type SaveInput struct {
	VaultID  int64
	Path     string
	Content  string
	Hash     string
	Mtime    int64
	BaseHash string
	Force    bool
}

type SaveResult struct {
	Note   *model.Note
	Merged bool
	// Unchanged 表示服务端已有完全相同的内容（哈希一致）。
	// 典型场景：同一文件经两条通道（如 iCloud + 另一客户端）到达，
	// 第二次上传是纯回声，调用方应跳过广播以免触发客户端间循环复制。
	Unchanged bool
	// Created 表示本次写入新建了记录（之前服务端没有这个路径），
	// 同步日志据此区分「新增文档」与「更新文档」。
	Created bool
}

func Save(ctx context.Context, repo *repository.NoteRepo, in SaveInput) (*SaveResult, error) {
	sum := sha256.Sum256([]byte(in.Content))
	actual := hex.EncodeToString(sum[:])
	if in.Hash != "" && in.Hash != actual {
		return nil, ErrHashMismatch
	}
	hash := actual

	exist, err := repo.GetByPath(ctx, in.VaultID, in.Path)
	if err != nil && !errors.Is(err, repository.ErrNotFound) {
		return nil, err
	}

	content := in.Content
	merged := false
	unchanged := exist != nil && exist.ContentHash == hash
	snapshot := content
	snapshotHash := hash

	if exist != nil && !in.Force {
		switch {
		case exist.ContentHash == hash:
			content = in.Content
			snapshot = content
			snapshotHash = hash
		case in.BaseHash == "" || in.BaseHash == exist.ContentHash:
			// 门票有效（或旧客户端）：直接写，但 snapshot 留在写入前版本，
			// 给「同时基于同一版改不同行」的另一端当祖先。
			content = in.Content
			if exist.ContentHash != hash {
				snapshot = exist.Content
				snapshotHash = exist.ContentHash
			}
		case exist.SnapshotHash != "" && in.BaseHash == exist.SnapshotHash:
			got := merge.ThreeWay(exist.Snapshot, in.Content, exist.Content)
			if !got.Clean {
				return nil, &ConflictError{Server: exist, Hint: got.Content}
			}
			content = got.Content
			sum := sha256.Sum256([]byte(content))
			hash = hex.EncodeToString(sum[:])
			merged = true
			snapshot = content
			snapshotHash = hash
		default:
			return nil, &ConflictError{Server: exist, Hint: merge.Markers(in.Content, exist.Content)}
		}
	}

	note := &model.Note{
		VaultID:      in.VaultID,
		Path:         in.Path,
		Content:      content,
		ContentHash:  hash,
		Snapshot:     snapshot,
		SnapshotHash: snapshotHash,
		Mtime:        in.Mtime,
		Size:         int64(len(content)),
	}
	if err := repo.Upsert(ctx, note); err != nil {
		return nil, err
	}
	saved, err := repo.GetByPath(ctx, in.VaultID, in.Path)
	if err != nil {
		return nil, err
	}
	return &SaveResult{Note: saved, Merged: merged, Unchanged: unchanged, Created: exist == nil}, nil
}
