package mcp

import (
	"context"
	"errors"
	"strings"
	"time"

	"owiki/internal/repository"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type recentChangesIn struct {
	Vault  string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Limit  int    `json:"limit,omitempty" jsonschema:"max entries (default 20, max 100)"`
	Before int64  `json:"before,omitempty" jsonschema:"cursor: return entries older than this id"`
}
type recentChangesOut struct {
	HasMore bool            `json:"hasMore"`
	Logs    []changeLogItem `json:"logs"`
}
type changeLogItem struct {
	ID         int64  `json:"id"`
	Action     string `json:"action"`
	Path       string `json:"path"`
	Detail     string `json:"detail"`
	Source     string `json:"source"`
	DeviceName string `json:"deviceName"`
	CreatedAt  string `json:"createdAt"`
}

type listDevicesIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
}
type listDevicesOut struct {
	Devices []deviceInfo `json:"devices"`
}
type deviceInfo struct {
	DeviceID      string `json:"deviceId"`
	DeviceName    string `json:"deviceName"`
	ClientVersion string `json:"clientVersion"`
	Online        bool   `json:"online"`
	LastSeenAt    string `json:"lastSeenAt"`
}

type serverInfoIn struct{}
type serverInfoOut struct {
	Version        string `json:"version"`
	OnlineClients  int    `json:"onlineClients"`
	MCP            bool   `json:"mcp" jsonschema:"always true; this endpoint is the MCP server"`
}

type getShareIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Path  string `json:"path" jsonschema:"note path"`
}
type getShareOut struct {
	Enabled bool   `json:"enabled"`
	Token   string `json:"token,omitempty"`
	URL     string `json:"url,omitempty" jsonschema:"relative share URL, e.g. /share/<token>"`
}

type setShareIn struct {
	Vault   string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Path    string `json:"path" jsonschema:"note path"`
	Enabled bool   `json:"enabled" jsonschema:"true to enable public sharing, false to disable"`
}
type setShareOut struct {
	Enabled bool   `json:"enabled"`
	Token   string `json:"token,omitempty"`
	URL     string `json:"url,omitempty"`
}

type readAttachmentIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Path  string `json:"path" jsonschema:"attachment path inside the vault"`
}

func (s *Server) registerSystemReadTools(srv *mcp.Server) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "get_recent_changes",
		Description: "List recent sync activity (creates, updates, deletes, merges, conflicts) for a vault.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.getRecentChanges)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_devices",
		Description: "List devices that have connected to a vault, with online status.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.listDevices)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "get_server_info",
		Description: "Server version and number of currently connected Obsidian clients.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.getServerInfo)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "get_share",
		Description: "Get the public-share status of a note (token + /share/<token> URL if enabled).",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.getShare)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "read_attachment",
		Description: "Read an image/PDF attachment as binary content (returned as an image/blob content block for multimodal clients).",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.readAttachment)
}

func (s *Server) registerSystemWriteTools(srv *mcp.Server) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "set_share",
		Description: "Enable or disable public sharing for a note. Token is stable across toggles.",
	}, s.setShare)
}

func (s *Server) getRecentChanges(ctx context.Context, req *mcp.CallToolRequest, in recentChangesIn) (*mcp.CallToolResult, recentChangesOut, error) {
	vid, err := s.requireVault(req, in.Vault)
	if err != nil {
		return nil, recentChangesOut{}, err
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	logs, hasMore, err := s.syncLog.ListPage(ctx, vid, in.Before, limit, nil)
	if err != nil {
		return nil, recentChangesOut{}, err
	}
	out := recentChangesOut{HasMore: hasMore, Logs: make([]changeLogItem, 0, len(logs))}
	for _, l := range logs {
		out.Logs = append(out.Logs, changeLogItem{
			ID: l.ID, Action: l.Action, Path: l.Path, Detail: l.Detail,
			Source: l.Source, DeviceName: l.DeviceName, CreatedAt: l.CreatedAt.Format(time.RFC3339),
		})
	}
	return nil, out, nil
}

func (s *Server) listDevices(ctx context.Context, req *mcp.CallToolRequest, in listDevicesIn) (*mcp.CallToolResult, listDevicesOut, error) {
	vid, err := s.requireVault(req, in.Vault)
	if err != nil {
		return nil, listDevicesOut{}, err
	}
	ds, err := s.devices.List(ctx, vid)
	if err != nil {
		return nil, listDevicesOut{}, err
	}
	online := map[string]bool{}
	if s.hub != nil {
		// CountByDevice 返回该设备当前连接数；>0 即在线
		for _, d := range ds {
			online[d.DeviceID] = s.hub.CountByDevice(vid, d.DeviceID, nil) > 0
		}
	}
	out := listDevicesOut{Devices: make([]deviceInfo, 0, len(ds))}
	for _, d := range ds {
		out.Devices = append(out.Devices, deviceInfo{
			DeviceID: d.DeviceID, DeviceName: d.DeviceName, ClientVersion: d.ClientVersion,
			Online: online[d.DeviceID], LastSeenAt: d.LastSeenAt.Format(time.RFC3339),
		})
	}
	return nil, out, nil
}

func (s *Server) getServerInfo(ctx context.Context, req *mcp.CallToolRequest, in serverInfoIn) (*mcp.CallToolResult, serverInfoOut, error) {
	n := 0
	if s.hub != nil {
		n = s.hub.Count()
	}
	return nil, serverInfoOut{Version: s.version, OnlineClients: n, MCP: true}, nil
}

func (s *Server) getShare(ctx context.Context, req *mcp.CallToolRequest, in getShareIn) (*mcp.CallToolResult, getShareOut, error) {
	if in.Path == "" {
		return nil, getShareOut{}, errors.New("path required")
	}
	vid, err := s.requireVault(req, in.Vault)
	if err != nil {
		return nil, getShareOut{}, err
	}
	note, err := s.repo.GetByPath(ctx, vid, in.Path)
	if err != nil {
		return nil, getShareOut{}, err
	}
	sh, err := s.share.GetByNoteID(ctx, note.ID)
	if errors.Is(err, repository.ErrShareNotFound) {
		return nil, getShareOut{Enabled: false}, nil
	}
	if err != nil {
		return nil, getShareOut{}, err
	}
	out := getShareOut{Enabled: sh.Enabled, Token: sh.Token}
	if sh.Enabled {
		out.URL = "/share/" + sh.Token
	}
	return nil, out, nil
}

func (s *Server) setShare(ctx context.Context, req *mcp.CallToolRequest, in setShareIn) (*mcp.CallToolResult, setShareOut, error) {
	if in.Path == "" {
		return nil, setShareOut{}, errors.New("path required")
	}
	vid, err := s.requireVault(req, in.Vault)
	if err != nil {
		return nil, setShareOut{}, err
	}
	note, err := s.repo.GetByPath(ctx, vid, in.Path)
	if err != nil {
		return nil, setShareOut{}, err
	}
	sh, err := s.share.GetOrCreateByNoteID(ctx, vid, note.ID)
	if err != nil {
		return nil, setShareOut{}, err
	}
	sh, err = s.share.SetEnabled(ctx, note.ID, in.Enabled)
	if err != nil {
		return nil, setShareOut{}, err
	}
	out := setShareOut{Enabled: sh.Enabled, Token: sh.Token}
	if sh.Enabled {
		out.URL = "/share/" + sh.Token
	}
	return nil, out, nil
}

func (s *Server) readAttachment(ctx context.Context, req *mcp.CallToolRequest, in readAttachmentIn) (*mcp.CallToolResult, any, error) {
	if in.Path == "" {
		return nil, nil, errors.New("path required")
	}
	if !repository.IsAttachment(in.Path) {
		return nil, nil, errors.New("path is not an attachment")
	}
	vid, err := s.requireVault(req, in.Vault)
	if err != nil {
		return nil, nil, err
	}
	data, err := s.attach.LoadBytes(vid, in.Path)
	if err != nil {
		return nil, nil, err
	}
	mime := repository.ContentType(in.Path)
	var content mcp.Content
	switch {
	case strings.HasPrefix(mime, "image/"):
		content = &mcp.ImageContent{Data: data, MIMEType: mime}
	default:
		content = &mcp.EmbeddedResource{
			Resource: &mcp.ResourceContents{
				URI:      "owiki://attach/" + in.Path,
				MIMEType: mime,
				Blob:     data,
			},
		}
	}
	return &mcp.CallToolResult{Content: []mcp.Content{content}}, nil, nil
}
