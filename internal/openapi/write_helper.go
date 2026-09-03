package openapi

import (
	"context"
	"encoding/json"
	"errors"

	"owiki/internal/hub"
	"owiki/internal/repository"
	"owiki/internal/service"
)

// WriteNote openapi 与 mcp 共享的写路径：Save + sync_log 留痕 + WS 广播。
// source 传 "openapi" 或 "mcp"（sync_log 来源），actor 传展示名（如 "API Key"/"MCP Client"）。
func WriteNote(ctx context.Context, repo *repository.NoteRepo, syncLog *repository.SyncLogRepo, h *hub.Hub,
	vid int64, path, content, baseHash string, force bool, source, actor string) (*service.SaveResult, error) {
	res, err := service.Save(ctx, repo, service.SaveInput{
		VaultID: vid, Path: path, Content: content, BaseHash: baseHash, Force: force,
	})
	if err != nil {
		return nil, err
	}
	if syncLog != nil {
		action := repository.ActionFileUpdate
		switch {
		case res.Merged:
			action = repository.ActionFileMerge
		case res.Created:
			action = repository.ActionFileCreate
		}
		syncLog.Record(ctx, vid, action, path, actor, source, "", actor, int64(len(res.Note.Content)))
	}
	broadcastNote(h, vid, "changed", path, res.Note.ContentHash)
	return res, nil
}

// RenameNote 共享的重命名路径：Rename + 附件联动 + 留痕 + 广播。
func RenameNote(ctx context.Context, repo *repository.NoteRepo, attach *repository.AttachStore, syncLog *repository.SyncLogRepo, h *hub.Hub,
	vid int64, from, to, source, actor string) error {
	if err := repo.Rename(ctx, vid, from, to); err != nil {
		return err
	}
	if repository.IsAttachment(to) {
		_ = attach.Rename(vid, from, to)
	}
	if syncLog != nil {
		syncLog.Record(ctx, vid, repository.ActionFileRename, from+" → "+to, actor, source, "", actor, 0)
	}
	broadcastNote(h, vid, "renamed", from, "")
	return nil
}

// DeleteNote 共享的删除路径：连带清分享记录与附件 + 留痕 + 广播。
// noteID 非 0 时删除该笔记的分享记录。
func DeleteNote(ctx context.Context, repo *repository.NoteRepo, attach *repository.AttachStore, share *repository.ShareRepo, syncLog *repository.SyncLogRepo, h *hub.Hub,
	vid int64, path string, noteID int64, source, actor string) error {
	note, _ := repo.GetByPath(ctx, vid, path)
	if err := repo.DeleteByPath(ctx, vid, path); err != nil && !errors.Is(err, repository.ErrNotFound) {
		return err
	}
	if note != nil && share != nil {
		_ = share.DeleteByNoteID(ctx, note.ID)
	}
	if repository.IsAttachment(path) {
		_ = attach.Delete(vid, path)
	}
	if syncLog != nil {
		syncLog.Record(ctx, vid, repository.ActionFileDelete, path, actor, source, "", actor, 0)
	}
	broadcastNote(h, vid, "deleted", path, "")
	return nil
}

// broadcastNote 向 vault 内所有 WS 客户端广播变更通知（与 ws handler 一致的消息格式）。
func broadcastNote(h *hub.Hub, vid int64, typ, path, hash string) {
	if h == nil {
		return
	}
	msg, _ := json.Marshal(map[string]string{"type": typ, "path": path, "hash": hash})
	h.BroadcastVault(vid, msg, nil)
}
