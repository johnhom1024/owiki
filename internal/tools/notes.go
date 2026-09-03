package tools

import (
	"context"
	"errors"
	"strings"

	"owiki/internal/model"
	"owiki/internal/openapi"
	"owiki/internal/repository"
	"owiki/internal/service"
)

func (h *Host) listVaults(ctx context.Context, s *Session, _ listVaultsIn) (listVaultsOut, error) {
	if s == nil || s.Key == nil {
		return listVaultsOut{}, ErrNoAPIKey
	}
	vaults, err := h.Vaults.List(ctx)
	if err != nil {
		return listVaultsOut{}, err
	}
	out := listVaultsOut{Vaults: make([]vaultInfo, 0, len(vaults))}
	for _, v := range vaults {
		if s.Key.VaultScope != 0 && s.Key.VaultScope != v.ID {
			continue
		}
		out.Vaults = append(out.Vaults, vaultInfo{ID: v.ID, Name: v.Name, Note: v.Note})
	}
	return out, nil
}

func (h *Host) listNotes(ctx context.Context, s *Session, in listNotesIn) (listNotesOut, error) {
	vid, err := h.RequireVault(ctx, s, in.Vault)
	if err != nil {
		return listNotesOut{}, err
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	var notes []model.Note
	if in.Full {
		notes, err = h.Repo.ListWithContent(ctx, vid)
	} else {
		notes, err = h.Repo.ListAll(ctx, vid, false)
	}
	if err != nil {
		return listNotesOut{}, err
	}
	out := listNotesOut{Notes: make([]noteMeta, 0, len(notes))}
	for _, n := range notes {
		if in.Folder != "" && !strings.HasPrefix(n.Path, in.Folder+"/") && n.Path != in.Folder {
			continue
		}
		if len(out.Notes) >= limit {
			break
		}
		m := noteMeta{Path: n.Path, Mtime: n.Mtime, Size: n.Size}
		if in.Full {
			m.Content = n.Content
		}
		out.Notes = append(out.Notes, m)
	}
	out.Total = len(out.Notes)
	return out, nil
}

func (h *Host) readNote(ctx context.Context, s *Session, in readNoteIn) (readNoteOut, error) {
	vid, err := h.RequireVault(ctx, s, in.Vault)
	if err != nil {
		return readNoteOut{}, err
	}
	if in.Path == "" {
		return readNoteOut{}, ErrPathRequired
	}
	note, err := h.Repo.GetByPath(ctx, vid, in.Path)
	if errors.Is(err, repository.ErrNotFound) {
		return readNoteOut{}, &NotFoundError{Path: in.Path}
	}
	if err != nil {
		return readNoteOut{}, err
	}
	return readNoteOut{
		Path: note.Path, Content: note.Content, ContentHash: note.ContentHash,
		Mtime: note.Mtime, Size: note.Size,
	}, nil
}

func (h *Host) writeNote(ctx context.Context, s *Session, in writeNoteIn) (writeNoteOut, error) {
	vid, err := h.RequireVault(ctx, s, in.Vault)
	if err != nil {
		return writeNoteOut{}, err
	}
	if in.Path == "" {
		return writeNoteOut{}, ErrPathRequired
	}
	res, err := openapi.WriteNote(ctx, h.Repo, h.SyncLog, h.Hub, vid, in.Path, in.Content, in.BaseHash, in.Force, s.Source, s.Actor)
	if err != nil {
		var ce *service.ConflictError
		if errors.As(err, &ce) {
			return writeNoteOut{}, &ConflictError{ServerHash: ce.Server.ContentHash, Hint: ce.Hint}
		}
		return writeNoteOut{}, err
	}
	return writeNoteOut{
		Path: res.Note.Path, ContentHash: res.Note.ContentHash, Created: res.Created, Merged: res.Merged,
	}, nil
}

func (h *Host) appendNote(ctx context.Context, s *Session, in appendNoteIn) (appendNoteOut, error) {
	vid, err := h.RequireVault(ctx, s, in.Vault)
	if err != nil {
		return appendNoteOut{}, err
	}
	if in.Path == "" {
		return appendNoteOut{}, ErrPathRequired
	}
	note, err := h.Repo.GetByPath(ctx, vid, in.Path)
	if errors.Is(err, repository.ErrNotFound) {
		if !in.Create {
			return appendNoteOut{}, &NotFoundError{Path: in.Path}
		}
		res, err := openapi.WriteNote(ctx, h.Repo, h.SyncLog, h.Hub, vid, in.Path, in.Content, "", false, s.Source, s.Actor)
		if err != nil {
			return appendNoteOut{}, err
		}
		return appendNoteOut{Path: res.Note.Path, ContentHash: res.Note.ContentHash, Appended: true}, nil
	}
	if err != nil {
		return appendNoteOut{}, err
	}
	content := note.Content
	if content != "" && !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	content += in.Content
	res, err := openapi.WriteNote(ctx, h.Repo, h.SyncLog, h.Hub, vid, in.Path, content, note.ContentHash, false, s.Source, s.Actor)
	if err != nil {
		var ce *service.ConflictError
		if errors.As(err, &ce) {
			return appendNoteOut{}, &ConflictError{ServerHash: ce.Server.ContentHash, Hint: ce.Hint}
		}
		return appendNoteOut{}, err
	}
	return appendNoteOut{Path: res.Note.Path, ContentHash: res.Note.ContentHash, Appended: true}, nil
}

func (h *Host) renameNote(ctx context.Context, s *Session, in renameNoteIn) (renameNoteOut, error) {
	vid, err := h.RequireVault(ctx, s, in.Vault)
	if err != nil {
		return renameNoteOut{}, err
	}
	if in.From == "" || in.To == "" {
		return renameNoteOut{}, errors.New("from and to required")
	}
	if err := openapi.RenameNote(ctx, h.Repo, h.Attach, h.SyncLog, h.Hub, vid, in.From, in.To, s.Source, s.Actor); err != nil {
		return renameNoteOut{}, err
	}
	return renameNoteOut{From: in.From, To: in.To}, nil
}

func (h *Host) deleteNote(ctx context.Context, s *Session, in deleteNoteIn) (deleteNoteOut, error) {
	vid, err := h.RequireVault(ctx, s, in.Vault)
	if err != nil {
		return deleteNoteOut{}, err
	}
	if in.Path == "" {
		return deleteNoteOut{}, ErrPathRequired
	}
	if in.Confirm != in.Path {
		return deleteNoteOut{}, errors.New("confirm must equal path (type the full path to confirm deletion)")
	}
	if err := openapi.DeleteNote(ctx, h.Repo, h.Attach, h.Share, h.SyncLog, h.Hub, vid, in.Path, 0, s.Source, s.Actor); err != nil {
		return deleteNoteOut{}, err
	}
	return deleteNoteOut{Deleted: true}, nil
}

func (h *Host) searchNotes(ctx context.Context, s *Session, in searchNotesIn) (searchNotesOut, error) {
	vid, err := h.RequireVault(ctx, s, in.Vault)
	if err != nil {
		return searchNotesOut{}, err
	}
	q := strings.TrimSpace(in.Query)
	if q == "" {
		return searchNotesOut{}, ErrQueryRequired
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	notes, err := h.Repo.ListWithContent(ctx, vid)
	if err != nil {
		return searchNotesOut{}, err
	}
	out := searchNotesOut{Query: q, Hits: make([]searchHit, 0)}
	lq := strings.ToLower(q)
	for _, n := range notes {
		if strings.Contains(strings.ToLower(n.Path), lq) || strings.Contains(strings.ToLower(n.Content), lq) {
			snippet := n.Content
			idx := strings.Index(strings.ToLower(snippet), lq)
			if idx > 40 {
				snippet = "…" + snippet[idx-40:]
			}
			if len(snippet) > 200 {
				snippet = snippet[:200] + "…"
			}
			out.Hits = append(out.Hits, searchHit{Path: n.Path, Snippet: snippet})
			if len(out.Hits) >= limit {
				break
			}
		}
	}
	out.Total = len(out.Hits)
	return out, nil
}
