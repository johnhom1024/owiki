package agent

import (
	"testing"

	"github.com/gin-gonic/gin"
	"trpc.group/trpc-go/trpc-agent-go/event"
	trpcmodel "trpc.group/trpc-go/trpc-agent-go/model"
)

func TestMapEventsSurfacesResponseError(t *testing.T) {
	ev := &event.Event{
		Response: &trpcmodel.Response{
			Error: &trpcmodel.ResponseError{Type: "api_error", Message: "connection refused"},
			Choices: []trpcmodel.Choice{{
				Message: trpcmodel.Message{
					Role:    trpcmodel.RoleAssistant,
					Content: "An error occurred during execution. Please contact the service provider.",
				},
			}},
		},
	}
	out := mapEvents("r1", ev)
	if len(out) != 1 || out[0].name != "error" {
		t.Fatalf("want 1 error frame, got %#v", out)
	}
	if got := ginHError(out[0].data); got != "api_error: connection refused" {
		t.Fatalf("error payload = %q", got)
	}
}

func TestMapEventsSurfacesRunnerPlaceholderAsError(t *testing.T) {
	ev := &event.Event{
		Response: &trpcmodel.Response{
			Choices: []trpcmodel.Choice{{
				Message: trpcmodel.Message{
					Role:    trpcmodel.RoleAssistant,
					Content: "An error occurred during execution. Please contact the service provider.",
				},
			}},
		},
	}
	out := mapEvents("r1", ev)
	if len(out) != 1 || out[0].name != "error" {
		t.Fatalf("placeholder must not be a token, got %#v", out)
	}
}

func ginHError(data any) string {
	h, ok := data.(gin.H)
	if !ok {
		return ""
	}
	s, _ := h["error"].(string)
	return s
}
