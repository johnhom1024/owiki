package tools

import (
	"context"
	"errors"
	"strings"
	"time"

	"owiki/internal/repository"
)

func (h *Host) getRecentChanges(ctx context.Context, s *Session, in recentChangesIn) (recentChangesOut, error) {
	vid, err := h.RequireVault(ctx, s, in.Vault)
	if err != nil {
		return recentChangesOut{}, err
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	logs, hasMore, err := h.SyncLog.ListPage(ctx, vid, in.Before, limit, nil)
	if err != nil {
		return recentChangesOut{}, err
	}
	out := recentChangesOut{HasMore: hasMore, Logs: make([]changeLogItem, 0, len(logs))}
	for _, l := range logs {
		out.Logs = append(out.Logs, changeLogItem{
			ID: l.ID, Action: l.Action, Path: l.Path, Detail: l.Detail,
			Source: l.Source, DeviceName: l.DeviceName, CreatedAt: l.CreatedAt.Format(time.RFC3339),
		})
	}
	return out, nil
}

func (h *Host) listDevices(ctx context.Context, s *Session, in listDevicesIn) (listDevicesOut, error) {
	vid, err := h.RequireVault(ctx, s, in.Vault)
	if err != nil {
		return listDevicesOut{}, err
	}
	ds, err := h.Devices.List(ctx, vid)
	if err != nil {
		return listDevicesOut{}, err
	}
	online := map[string]bool{}
	if h.Hub != nil {
		for _, d := range ds {
			online[d.DeviceID] = h.Hub.CountByDevice(vid, d.DeviceID, nil) > 0
		}
	}
	out := listDevicesOut{Devices: make([]deviceInfo, 0, len(ds))}
	for _, d := range ds {
		out.Devices = append(out.Devices, deviceInfo{
			DeviceID: d.DeviceID, DeviceName: d.DeviceName, ClientVersion: d.ClientVersion,
			Online: online[d.DeviceID], LastSeenAt: d.LastSeenAt.Format(time.RFC3339),
		})
	}
	return out, nil
}

func (h *Host) getServerInfo(_ context.Context, _ *Session, _ serverInfoIn) (serverInfoOut, error) {
	n := 0
	if h.Hub != nil {
		n = h.Hub.Count()
	}
	return serverInfoOut{Version: h.Version, OnlineClients: n, MCP: true}, nil
}

func (h *Host) getShare(ctx context.Context, s *Session, in getShareIn) (getShareOut, error) {
	if in.Path == "" {
		return getShareOut{}, ErrPathRequired
	}
	vid, err := h.RequireVault(ctx, s, in.Vault)
	if err != nil {
		return getShareOut{}, err
	}
	note, err := h.Repo.GetByPath(ctx, vid, in.Path)
	if err != nil {
		return getShareOut{}, err
	}
	sh, err := h.Share.GetByNoteID(ctx, note.ID)
	if errors.Is(err, repository.ErrShareNotFound) {
		return getShareOut{Enabled: false}, nil
	}
	if err != nil {
		return getShareOut{}, err
	}
	out := getShareOut{Enabled: sh.Enabled, Token: sh.Token}
	if sh.Enabled {
		out.URL = "/share/" + sh.Token
	}
	return out, nil
}

func (h *Host) setShare(ctx context.Context, s *Session, in setShareIn) (setShareOut, error) {
	if in.Path == "" {
		return setShareOut{}, ErrPathRequired
	}
	vid, err := h.RequireVault(ctx, s, in.Vault)
	if err != nil {
		return setShareOut{}, err
	}
	note, err := h.Repo.GetByPath(ctx, vid, in.Path)
	if err != nil {
		return setShareOut{}, err
	}
	if _, err := h.Share.GetOrCreateByNoteID(ctx, vid, note.ID); err != nil {
		return setShareOut{}, err
	}
	sh, err := h.Share.SetEnabled(ctx, note.ID, in.Enabled)
	if err != nil {
		return setShareOut{}, err
	}
	out := setShareOut{Enabled: sh.Enabled, Token: sh.Token}
	if sh.Enabled {
		out.URL = "/share/" + sh.Token
	}
	return out, nil
}

func (h *Host) readAttachment(ctx context.Context, s *Session, in readAttachmentIn) (*AttachmentResult, error) {
	if in.Path == "" {
		return nil, ErrPathRequired
	}
	if !repository.IsAttachment(in.Path) {
		return nil, errors.New("path is not an attachment")
	}
	vid, err := h.RequireVault(ctx, s, in.Vault)
	if err != nil {
		return nil, err
	}
	data, err := h.Attach.LoadBytes(vid, in.Path)
	if err != nil {
		return nil, err
	}
	mime := repository.ContentType(in.Path)
	return &AttachmentResult{
		Path: in.Path, MIME: mime, Data: data,
		IsImage: strings.HasPrefix(mime, "image/"),
	}, nil
}
