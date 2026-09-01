package merge

import (
	"strings"
	"testing"
)

func TestThreeWayCleanDifferentLines(t *testing.T) {
	base := "line1\nline2\nline3\n"
	mine := "line1-mine\nline2\nline3\n"
	theirs := "line1\nline2\nline3-theirs\n"
	got := ThreeWay(base, mine, theirs)
	if !got.Clean {
		t.Fatalf("expected clean merge, got conflict:\n%s", got.Content)
	}
	want := "line1-mine\nline2\nline3-theirs\n"
	if got.Content != want {
		t.Fatalf("merged = %q, want %q", got.Content, want)
	}
}

func TestThreeWayConflictSameLine(t *testing.T) {
	base := "same line\n"
	mine := "mine line\n"
	theirs := "theirs line\n"
	got := ThreeWay(base, mine, theirs)
	if got.Clean {
		t.Fatalf("expected conflict, got clean %q", got.Content)
	}
	for _, p := range []string{"<<<<<<< mine", "=======", ">>>>>>> theirs"} {
		if !strings.Contains(got.Content, p) {
			t.Fatalf("missing %q:\n%s", p, got.Content)
		}
	}
}

func TestThreeWayIdenticalSides(t *testing.T) {
	got := ThreeWay("a", "b", "b")
	if !got.Clean || got.Content != "b" {
		t.Fatalf("%+v", got)
	}
}

func TestThreeWayOneSideUnchanged(t *testing.T) {
	got := ThreeWay("base", "base", "theirs")
	if !got.Clean || got.Content != "theirs" {
		t.Fatalf("%+v", got)
	}
}
