package tools

// ---------- notes ----------

type listVaultsIn struct{}
type listVaultsOut struct {
	Vaults []vaultInfo `json:"vaults" jsonschema:"vaults accessible to this key"`
}
type vaultInfo struct {
	ID   int64  `json:"id" jsonschema:"vault id"`
	Name string `json:"name" jsonschema:"vault name"`
	Note string `json:"note" jsonschema:"vault note"`
}

type listNotesIn struct {
	Vault  string `json:"vault,omitempty" jsonschema:"vault id or name; required for multi-vault servers"`
	Folder string `json:"folder,omitempty" jsonschema:"only notes under this folder (prefix match), e.g. \"日记\""`
	Limit  int    `json:"limit,omitempty" jsonschema:"max notes to return (default 100, max 500)"`
	Full   bool   `json:"full,omitempty" jsonschema:"include note content (heavier; default false)"`
}
type listNotesOut struct {
	Total int        `json:"total" jsonschema:"number of notes returned"`
	Notes []noteMeta `json:"notes" jsonschema:"note list"`
}
type noteMeta struct {
	Path    string `json:"path"`
	Mtime   int64  `json:"mtime"`
	Size    int64  `json:"size"`
	Content string `json:"content,omitempty"`
}

type readNoteIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Path  string `json:"path" jsonschema:"note path inside the vault, e.g. \"日记/2026-08.md\""`
}
type readNoteOut struct {
	Path        string `json:"path"`
	Content     string `json:"content"`
	ContentHash string `json:"contentHash" jsonschema:"pass this as baseHash when updating this note"`
	Mtime       int64  `json:"mtime"`
	Size        int64  `json:"size"`
}

type writeNoteIn struct {
	Vault    string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Path     string `json:"path" jsonschema:"note path inside the vault"`
	Content  string `json:"content" jsonschema:"full note content (markdown)"`
	BaseHash string `json:"baseHash,omitempty" jsonschema:"contentHash from your last read; prevents overwriting concurrent edits (409 on mismatch)"`
	Force    bool   `json:"force,omitempty" jsonschema:"overwrite even if baseHash mismatches (dangerous)"`
}
type writeNoteOut struct {
	Path        string `json:"path"`
	ContentHash string `json:"contentHash"`
	Created     bool   `json:"created"`
	Merged      bool   `json:"merged" jsonschema:"true if a three-way merge was applied"`
}

type appendNoteIn struct {
	Vault   string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Path    string `json:"path" jsonschema:"note path inside the vault"`
	Content string `json:"content" jsonschema:"text to append to the end of the note"`
	Create  bool   `json:"create,omitempty" jsonschema:"create the note if it does not exist (default false)"`
}
type appendNoteOut struct {
	Path        string `json:"path"`
	ContentHash string `json:"contentHash"`
	Appended    bool   `json:"appended"`
}

type renameNoteIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
	From  string `json:"from" jsonschema:"current note path"`
	To    string `json:"to" jsonschema:"new note path"`
}
type renameNoteOut struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type deleteNoteIn struct {
	Vault   string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Path    string `json:"path" jsonschema:"note path to delete"`
	Confirm string `json:"confirm" jsonschema:"must equal the note path; guards against accidental deletion"`
}
type deleteNoteOut struct {
	Deleted bool `json:"deleted"`
}

type searchNotesIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Query string `json:"query" jsonschema:"keyword matched against path and content (case-insensitive substring)"`
	Limit int    `json:"limit,omitempty" jsonschema:"max hits (default 20, max 50)"`
}
type searchNotesOut struct {
	Query string      `json:"query"`
	Total int         `json:"total"`
	Hits  []searchHit `json:"hits"`
}
type searchHit struct {
	Path    string `json:"path"`
	Snippet string `json:"snippet"`
}

// ---------- graph ----------

type listTagsIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
}
type listTagsOut struct {
	Tags []tagCount `json:"tags"`
}
type tagCount struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

type findByTagIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Tag   string `json:"tag" jsonschema:"tag to search for (without the leading #)"`
}
type findByTagOut struct {
	Tag   string   `json:"tag"`
	Paths []string `json:"paths"`
}

type linksIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Path  string `json:"path" jsonschema:"note path whose links to inspect"`
}
type linksOut struct {
	Path  string   `json:"path"`
	Links []string `json:"links"`
}

type findBrokenIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
}
type findBrokenOut struct {
	Broken []brokenLink `json:"broken"`
}
type brokenLink struct {
	From string `json:"from" jsonschema:"note that contains the broken link"`
	To   string `json:"to" jsonschema:"target that does not exist"`
}

type findOrphansIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
}
type findOrphansOut struct {
	Orphans []string `json:"orphans" jsonschema:"notes with no incoming wikilinks"`
}

type vaultStatsIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
}
type vaultStatsOut struct {
	TotalNotes int           `json:"totalNotes"`
	TotalSize  int64         `json:"totalSize"`
	Folders    []folderCount `json:"folders"`
	Recent     []recentNote  `json:"recent"`
}
type folderCount struct {
	Folder string `json:"folder"`
	Count  int    `json:"count"`
}
type recentNote struct {
	Path  string `json:"path"`
	Mtime int64  `json:"mtime"`
}

// ---------- system ----------

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
	Version       string `json:"version"`
	OnlineClients int    `json:"onlineClients"`
	MCP           bool   `json:"mcp" jsonschema:"always true; this endpoint is the MCP server"`
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

// AttachmentResult 二进制附件：协议适配层映射成 MCP image/blob 内容块。
// 不声明 OutputSchema（与重构前一致）。
type AttachmentResult struct {
	Path    string
	MIME    string
	Data    []byte
	IsImage bool
}
