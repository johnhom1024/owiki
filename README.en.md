<div align="center">

<img src="docs/logo.svg" width="96" height="96" alt="OWiki">

# OWiki

Self-hosted sync & wiki service for Obsidian notes

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker Pulls](https://img.shields.io/docker/pulls/johnhom1024/owiki.svg)](https://hub.docker.com/r/johnhom1024/owiki)
[![Release](https://img.shields.io/github/v/release/johnhom1024/owiki?sort=semver)](https://github.com/johnhom1024/owiki/releases)

Sync notes across devices · Reach your vault from any browser · Let an AI assistant run your vault · Your data stays on your own machine

**[Website](https://johnhom1024.github.io/owiki/)** ·
**[AI API docs](docs/openapi-skill.md)** ·
**[Quick start](#-quick-start)** ·
**[Obsidian plugin](https://github.com/johnhom1024/owiki-sync)**

[简体中文](README.md) | English

</div>

---

> [!WARNING]
> **Experimental software**: OWiki is in an early experimental stage. The sync logic has not been validated at scale, and improper configuration or edge cases **may cause note data loss or corruption**. **Back up your Obsidian vault before connecting**, and consider trying it on a non-critical vault first. **We are not responsible for any data loss caused by using this software** (see the [MIT LICENSE](LICENSE)).

## ✨ Features

- **Realtime multi-device sync** — edits reach every device within 2 seconds; automatic reconnect with queued delivery, so offline changes are never lost
- **Incremental transfer** — only files that actually changed get transferred; untouched notes don't move a byte. Zero traffic when both sides match
- **Conflicts never lose content** — if two devices edit the same note, mergeable changes merge automatically; the rest are saved as conflict copies — your local file is never silently overwritten
- **Your vault on the web** — phone, work laptop, tablet: open a URL in any browser to read and edit all your notes, no Obsidian required
- **Note sharing** — generate a public link (with QR code) to share a single note with people who don't have Obsidian
- **Per-device authorization** — every device gets its own identity, joins via PIN, and can be unbound whenever you like
- **Attachment sync** — images and other binary attachments sync along with your notes
- **Open AI API** — hand your AI assistant a skill doc and an API key, and it can write, organize and search your notes for you — everything it writes lands in Obsidian instantly
- **Single-file data** — everything lives in one SQLite file; copy it and you have a backup. No proprietary formats

## 🚀 Quick start

Three steps: start the server → create a vault → install the plugin.

### 1. Start the server

```bash
docker run -d --name owiki \
  -p 8787:8787 \
  -e OWIKI_TOKEN=<sync-token> \
  -e OWIKI_ADMIN_PASSWORD=<strong-password> \
  -v ./owiki-data:/data \
  johnhom1024/owiki:latest
```

<details>
<summary>More options (docker-compose / binary / CN mirror)</summary>

```yaml
# docker-compose.yaml
services:
  owiki:
    image: johnhom1024/owiki:latest
    ports:
      - '8787:8787'
    environment:
      OWIKI_DB: /data/owiki.db
      OWIKI_ADDR: ':8787'
      OWIKI_TOKEN: ${OWIKI_TOKEN}
      OWIKI_ADMIN_USER: admin
      OWIKI_ADMIN_PASSWORD: ${OWIKI_ADMIN_PASSWORD}
    volumes:
      - ./data:/data
    restart: unless-stopped
```

```bash
# CN registry mirror (CNB, no login required)
docker run -d --name owiki -p 8787:8787 \
  -e OWIKI_TOKEN=... -e OWIKI_ADMIN_PASSWORD=... -v ./owiki-data:/data \
  docker.cnb.cool/johnhom1024/owiki:latest

# Build from source
git clone https://github.com/johnhom1024/owiki
cd owiki
make run   # :8787, default token: dev-token-change-me
```

</details>

> [!TIP]
> Prefer a versioned tag (e.g. `johnhom1024/owiki:0.0.1`) over `latest` in production — you can roll back to the previous version the moment something goes wrong. See [docs/versioning.md](docs/versioning.md).

### 2. Create a vault

Open `http://localhost:8787` in your browser, sign in, and create a vault in the web console to get a sync token and device PIN.

### 3. Install the Obsidian plugin

Download `main.js`, `manifest.json` and `styles.css` from [GitHub Releases](https://github.com/johnhom1024/owiki-sync/releases) into your vault's plugin folder, enable it, and enter your server address and sync token:

```
<your-vault>/.obsidian/plugins/owiki-sync/
```

<details>
<summary>BRAT install (before the community listing)</summary>

Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, add `johnhom1024/owiki-sync` as a beta plugin in its settings, and you'll get the plugin — plus automatic updates with every GitHub release — before the official listing goes live.

</details>

The first connection reconciles automatically: remote-only files come down, local-only files go up.

## ⚙️ Configuration

| Env var | Default | Description |
|---|---|---|
| `OWIKI_TOKEN` | `dev-token-change-me` | Sync token — change it in production |
| `OWIKI_ADMIN_USER` | `admin` | Web console login user (initialized on first boot) |
| `OWIKI_ADMIN_PASSWORD` | empty | Web console login password — change it in production |
| `OWIKI_ADDR` | `:8787` | Listen address |
| `OWIKI_DB` | `owiki.db` | SQLite database path |
| `OWIKI_ATTACH_DIR` | `<DB dir>/attachments` | Attachment storage directory |

## 🔌 Open AI API

`/openapi/*` is a REST API for AI assistants and external scripts: create, read, update, delete and search notes — writes broadcast live into Obsidian. Auth with API keys (generated in the web console, stored as SHA-256).

```bash
KEY=owk_xxx   # generated in the web console "API keys" page
curl -s -H "X-API-Key: $KEY" http://localhost:8787/openapi/vaults

curl -s -X POST "http://localhost:8787/openapi/vaults/1/notes/AI/new-note.md" \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"content": "# Written by AI\n\n..."}'
```

Full docs and the agent-skill guide: [docs/openapi-skill.md](docs/openapi-skill.md)

## 📖 Documentation

- [Website](https://johnhom1024.github.io/owiki/) — feature overview and how sync works
- [AI API docs](docs/openapi-skill.md) — OpenAPI endpoints and the agent skill
- [Versioning](docs/versioning.md) — image tags and the release process

## 🤝 Contributing

Issues and PRs are welcome. Run `go test ./... && go vet ./...` before committing; for web changes run `pnpm build` inside `web/`.

## 🔒 Security

- Always change `OWIKI_TOKEN` and the admin password in production
- The server does not terminate TLS itself — put it behind a reverse proxy (caddy / nginx)
- Please do not open public issues for vulnerabilities: see [SECURITY.md](SECURITY.md)

## 📄 License

[MIT](LICENSE) © 2026 johnhom
