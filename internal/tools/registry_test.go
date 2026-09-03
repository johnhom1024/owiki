package tools

import (
	"context"
	"encoding/json"
	"testing"
)

func TestRegistryReadOnlyFilter(t *testing.T) {
	h := &Host{Version: "test"}
	r := h.Registry()
	if n := len(r.All()); n != 21 {
		t.Fatalf("All() = %d, want 21", n)
	}
	ro := r.ReadOnly()
	if n := len(ro); n != 16 {
		t.Fatalf("ReadOnly() = %d, want 16", n)
	}
	for _, tl := range ro {
		if !tl.ReadOnly() {
			t.Errorf("%s listed as read-only but FlagReadOnly not set", tl.Name)
		}
	}
	writes := map[string]bool{"write_note": true, "append_note": true, "rename_note": true, "delete_note": true, "set_share": true}
	for _, tl := range r.All() {
		if writes[tl.Name] && tl.ReadOnly() {
			t.Errorf("write tool %s unexpectedly read-only", tl.Name)
		}
	}
	del, ok := r.Find("delete_note")
	if !ok || !del.Destructive() {
		t.Fatal("delete_note should be destructive")
	}
}

func TestTypedHandlerJSONRoundTrip(t *testing.T) {
	h := Typed(func(_ context.Context, _ *Session, in readNoteIn) (readNoteOut, error) {
		return readNoteOut{Path: in.Path, Content: "ok"}, nil
	})
	out, err := h(context.Background(), &Session{}, json.RawMessage(`{"path":"a.md"}`))
	if err != nil {
		t.Fatal(err)
	}
	got := out.(readNoteOut)
	if got.Path != "a.md" || got.Content != "ok" {
		t.Fatalf("got %+v", got)
	}
}
