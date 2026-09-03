package mcp

import (
	"context"
	"encoding/json"
	"strings"

	"owiki/internal/model"
	"owiki/internal/repository"
	"owiki/internal/tools"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const actorName = "MCP Client"

func (s *Server) mountTools(srv *mcp.Server, list []*tools.Tool) {
	for _, t := range list {
		s.addTool(srv, t)
	}
}

func (s *Server) addTool(srv *mcp.Server, t *tools.Tool) {
	mt := &mcp.Tool{
		Name:        t.Name,
		Description: t.Description,
		InputSchema: t.InputSchema(),
		Annotations: flagsToAnnotations(t.Flags),
	}
	if t.OutputSchema() != nil {
		mt.OutputSchema = t.OutputSchema()
	}
	srv.AddTool(mt, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		sess, err := s.sessionFromRequest(req)
		if err != nil {
			var errRes mcp.CallToolResult
			errRes.SetError(err)
			return &errRes, nil
		}
		var args json.RawMessage
		if req.Params != nil {
			args = req.Params.Arguments
		}
		out, err := t.Handler(ctx, sess, args)
		if err != nil {
			var errRes mcp.CallToolResult
			errRes.SetError(err)
			return &errRes, nil
		}
		if att, ok := out.(*tools.AttachmentResult); ok && att != nil {
			return attachmentResult(att), nil
		}
		return structuredResult(out)
	})
}

func flagsToAnnotations(f tools.Flag) *mcp.ToolAnnotations {
	if f == 0 {
		return nil
	}
	ann := &mcp.ToolAnnotations{}
	if f&tools.FlagReadOnly != 0 {
		ann.ReadOnlyHint = true
		ann.IdempotentHint = true
	}
	if f&tools.FlagDestructive != 0 {
		ann.DestructiveHint = boolPtr(true)
	}
	if f&tools.FlagIdempotent != 0 {
		ann.IdempotentHint = true
	}
	return ann
}

func boolPtr(b bool) *bool { return &b }

func structuredResult(out any) (*mcp.CallToolResult, error) {
	if out == nil {
		return &mcp.CallToolResult{}, nil
	}
	b, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	return &mcp.CallToolResult{
		StructuredContent: json.RawMessage(b),
		Content:           []mcp.Content{&mcp.TextContent{Text: string(b)}},
	}, nil
}

func attachmentResult(att *tools.AttachmentResult) *mcp.CallToolResult {
	var content mcp.Content
	if att.IsImage {
		content = &mcp.ImageContent{Data: att.Data, MIMEType: att.MIME}
	} else {
		content = &mcp.EmbeddedResource{
			Resource: &mcp.ResourceContents{
				URI:      "owiki://attach/" + att.Path,
				MIMEType: att.MIME,
				Blob:     att.Data,
			},
		}
	}
	return &mcp.CallToolResult{Content: []mcp.Content{content}}
}

func (s *Server) sessionFromRequest(req *mcp.CallToolRequest) (*tools.Session, error) {
	k, err := s.keyFromRequest(req)
	if err != nil {
		return nil, err
	}
	return &tools.Session{Key: k, Actor: actorName, Source: repository.SourceMCP}, nil
}

func (s *Server) keyFromRequest(req *mcp.CallToolRequest) (*model.ApiKey, error) {
	key := ""
	if req.Extra != nil && req.Extra.Header != nil {
		key = req.Extra.Header.Get("X-API-Key")
		if key == "" {
			if auth := req.Extra.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
				key = strings.TrimPrefix(auth, "Bearer ")
			}
		}
	}
	if key == "" {
		return nil, tools.ErrNoAPIKey
	}
	k, ok := s.keys.Verify(context.Background(), key)
	if !ok {
		return nil, tools.ErrInvalidAPIKey
	}
	return k, nil
}
