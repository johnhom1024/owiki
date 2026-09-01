package merge

import (
	"strings"
)

// Result 三方合并结果
type Result struct {
	Content string
	Clean   bool // true = 无重叠，可直接采用
}

type hunk struct {
	aStart int      // ancestor 起始行（0-based）
	aCount int      // 覆盖的祖先行数
	bLines []string // 替换后的行（不含末尾空元素约定，见 splitLines）
}

// ThreeWay 以 ancestor 为共同祖先，按行合并 mine 与 theirs。
// 改了不同行 → 自动合成；同一行两边都改 → Clean=false。
func ThreeWay(ancestor, mine, theirs string) Result {
	if mine == theirs {
		return Result{Content: mine, Clean: true}
	}
	if mine == ancestor {
		return Result{Content: theirs, Clean: true}
	}
	if theirs == ancestor {
		return Result{Content: mine, Clean: true}
	}

	a := splitLines(ancestor)
	m := splitLines(mine)
	t := splitLines(theirs)
	mh := lineHunks(a, m)
	th := lineHunks(a, t)

	out, ok := mergeHunks(a, mh, th)
	if !ok {
		return Result{Content: Markers(mine, theirs), Clean: false}
	}
	return Result{Content: joinLines(out), Clean: true}
}

func lineHunks(a, b []string) []hunk {
	n, m := len(a), len(b)
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, m+1)
	}
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			if a[i] == b[j] {
				dp[i][j] = dp[i+1][j+1] + 1
			} else if dp[i+1][j] >= dp[i][j+1] {
				dp[i][j] = dp[i+1][j]
			} else {
				dp[i][j] = dp[i][j+1]
			}
		}
	}

	var hunks []hunk
	var cur *hunk
	flush := func() {
		if cur != nil {
			hunks = append(hunks, *cur)
			cur = nil
		}
	}
	i, j := 0, 0
	for i < n && j < m {
		if a[i] == b[j] {
			flush()
			i++
			j++
			continue
		}
		if cur == nil {
			cur = &hunk{aStart: i}
		}
		if dp[i+1][j] >= dp[i][j+1] {
			cur.aCount++
			i++
		} else {
			cur.bLines = append(cur.bLines, b[j])
			j++
		}
	}
	if i < n || j < m {
		if cur == nil {
			cur = &hunk{aStart: i}
		}
		cur.aCount += n - i
		cur.bLines = append(cur.bLines, b[j:]...)
	}
	flush()
	return hunks
}

func mergeHunks(a []string, mine, theirs []hunk) ([]string, bool) {
	var out []string
	i := 0
	mi, ti := 0, 0
	for i < len(a) || mi < len(mine) || ti < len(theirs) {
		var mh, th *hunk
		if mi < len(mine) {
			mh = &mine[mi]
		}
		if ti < len(theirs) {
			th = &theirs[ti]
		}
		// 两侧都没有剩余 hunk：抄完祖先
		if mh == nil && th == nil {
			out = append(out, a[i:]...)
			break
		}
		next := len(a)
		if mh != nil && mh.aStart < next {
			next = mh.aStart
		}
		if th != nil && th.aStart < next {
			next = th.aStart
		}
		if i < next {
			out = append(out, a[i:next]...)
			i = next
			continue
		}
		if mh != nil && th != nil && overlap(*mh, *th) {
			return nil, false
		}
		if mh != nil && (th == nil || mh.aStart <= th.aStart) {
			out = append(out, mh.bLines...)
			i = mh.aStart + mh.aCount
			mi++
			continue
		}
		out = append(out, th.bLines...)
		i = th.aStart + th.aCount
		ti++
	}
	return out, true
}

func overlap(x, y hunk) bool {
	xEnd := x.aStart + x.aCount
	yEnd := y.aStart + y.aCount
	// 纯插入（aCount=0）发生在同一点也视为冲突，避免次序不定
	if x.aCount == 0 && y.aCount == 0 {
		return x.aStart == y.aStart
	}
	return x.aStart < yEnd && y.aStart < xEnd
}

func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	return strings.SplitAfter(s, "\n")
}

func joinLines(lines []string) string {
	return strings.Join(lines, "")
}

// Markers 生成 Git 风格冲突标记，供客户端手工解决
func Markers(mine, theirs string) string {
	var b strings.Builder
	b.WriteString("<<<<<<< mine\n")
	b.WriteString(mine)
	if !strings.HasSuffix(mine, "\n") {
		b.WriteString("\n")
	}
	b.WriteString("=======\n")
	b.WriteString(theirs)
	if !strings.HasSuffix(theirs, "\n") {
		b.WriteString("\n")
	}
	b.WriteString(">>>>>>> theirs\n")
	return b.String()
}
