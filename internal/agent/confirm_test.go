package agent

import (
	"context"
	"testing"
	"time"
)

func TestConfirmBrokerResolve(t *testing.T) {
	b := NewConfirmBroker()
	go func() {
		time.Sleep(20 * time.Millisecond)
		if !b.Resolve("run-1", true) {
			t.Error("resolve should succeed while pending")
		}
	}()
	ok, err := b.Request(context.Background(), "run-1", "delete_note", `{"path":"x.md"}`)
	if err != nil || !ok {
		t.Fatalf("expected approved, got ok=%v err=%v", ok, err)
	}
	// 已决后再次 Resolve 应失败
	if b.Resolve("run-1", true) {
		t.Error("double resolve should fail")
	}
}

func TestConfirmBrokerDeny(t *testing.T) {
	b := NewConfirmBroker()
	old := ConfirmTimeout
	ConfirmTimeout = 3 * time.Second
	defer func() { ConfirmTimeout = old }()
	// 等 pending 真正挂起后再 Resolve（避免注册前 resolve 丢失）
	go func() {
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			if len(b.PendingIDs()) > 0 {
				b.Resolve("run-2", false)
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
	ok, err := b.Request(context.Background(), "run-2", "delete_note", "{}")
	if err != nil || ok {
		t.Fatalf("expected denied, got ok=%v err=%v", ok, err)
	}
}

func TestConfirmBrokerTimeout(t *testing.T) {
	b := NewConfirmBroker()
	old := ConfirmTimeout
	ConfirmTimeout = 50 * time.Millisecond
	defer func() { ConfirmTimeout = old }()
	start := time.Now()
	ok, err := b.Request(context.Background(), "run-3", "delete_note", "{}")
	if ok || err != nil {
		t.Fatalf("expected timeout deny, got ok=%v err=%v", ok, err)
	}
	if time.Since(start) < 50*time.Millisecond {
		t.Error("returned before timeout")
	}
}

func TestConfirmBrokerCtxCancel(t *testing.T) {
	b := NewConfirmBroker()
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()
	ok, err := b.Request(ctx, "run-4", "delete_note", "{}")
	if ok || err == nil {
		t.Fatalf("expected ctx cancel, got ok=%v err=%v", ok, err)
	}
}

func TestConfirmBrokerSinglePending(t *testing.T) {
	b := NewConfirmBroker()
	go b.Request(context.Background(), "run-5", "delete_note", "{}")
	time.Sleep(20 * time.Millisecond)
	if b.Pending("run-5") == nil {
		t.Fatal("pending should be visible")
	}
	// 同 runID 第二个请求应被直接拒绝（不挂起）
	ok, err := b.Request(context.Background(), "run-5", "delete_note", "{}")
	if ok || err != nil {
		t.Fatalf("expected concurrent deny, got ok=%v err=%v", ok, err)
	}
	b.Resolve("run-5", false)
}
