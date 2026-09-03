package repository

import "testing"

func TestNormalizeNotePath(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"新笔记", "新笔记.md", false},
		{"日记/今日.md", "日记/今日.md", false},
		{"  日记\\草稿  ", "日记/草稿.md", false},
		{"a/./b", "a/b.md", false},
		{"../secret", "secret.md", false}, // path.Clean("/../secret") → "/secret"
		{"", "", true},
		{"...", "", true},
		{"foo.png", "", true},
		{"img/photo.jpg", "", true},
		{"bad<name>", "", true},
		{"a//b", "a/b.md", false},
	}
	for _, tc := range cases {
		got, err := NormalizeNotePath(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("NormalizeNotePath(%q) = %q, want error", tc.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("NormalizeNotePath(%q) unexpected error: %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("NormalizeNotePath(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestNoteTitleFromPath(t *testing.T) {
	if got := NoteTitleFromPath("日记/今日.md"); got != "今日" {
		t.Fatalf("got %q", got)
	}
	if got := NoteTitleFromPath("hello"); got != "hello" {
		t.Fatalf("got %q", got)
	}
}
