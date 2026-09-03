package tools

import (
	"context"
	"encoding/json"
	"fmt"
)

// Typed 把强类型 handler 包成注册表 Handler（JSON 进出）。
func Typed[In, Out any](fn func(ctx context.Context, s *Session, in In) (Out, error)) Handler {
	return func(ctx context.Context, s *Session, raw json.RawMessage) (any, error) {
		var in In
		if len(raw) > 0 && string(raw) != "null" {
			if err := json.Unmarshal(raw, &in); err != nil {
				return nil, fmt.Errorf("invalid arguments: %w", err)
			}
		}
		return fn(ctx, s, in)
	}
}
