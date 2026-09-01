# OWiki

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker Pulls](https://img.shields.io/docker/pulls/johnhom1024/owiki.svg)](https://hub.docker.com/r/johnhom1024/owiki)
[![Release](https://img.shields.io/github/v/release/johnhom1024/owiki?sort=semver)](https://github.com/johnhom1024/owiki/releases)

Self-hosted sync server for Obsidian notes. Single Go binary + SQLite, real-time sync over WebSocket.

> **What's in this repo**: the server (Go), the web console (`web/`), and the marketing site (`site/`).
> The Obsidian plugin lives in a separate repo: [johnhom1024/owiki-sync](https://github.com/johnhom1024/owiki-sync).

[简体中文](README.md) | English

## Quick Start (Docker)

```bash
docker run -d --name owiki \
  -p 8787:8787 \
  -e OWIKI_TOKEN=<sync-token> \
  -e OWIKI_ADMIN_PASSWORD=<strong-password> \
  -v ./owiki-data:/data \
  johnhom1024/owiki:latest
```

Open `http://localhost:8787` in your browser: create a vault, generate a sync token, then install the [Obsidian plugin](https://github.com/johnhom1024/owiki-sync) and you're done.

**Pinning versions**: prefer a versioned tag (e.g. `johnhom1024/owiki:0.0.1`) over `latest` in production — instant rollback whenever you need it. See [docs/versioning.md](docs/versioning.md).

## How it works

```
Obsidian plugin (TS) ←──WebSocket (JSON frames)──→  OWiki (Go)
                                                    ├── /ws        sync endpoint (hash reconciliation + transfer + broadcast)
                                                    ├── /api/*     web API (list/read/save/stats/SSE)
                                                    ├── /openapi/* open API for AI agents (X-API-Key auth)
                                                    └── /          embedded web console (SPA)
```

- Per-file SHA-256 content hashing with **manifest reconciliation** (`hashlist`) — only differences travel
- Writes carry `baseHash` (optimistic locking); line-level three-way merge when possible, explicit `conflict` otherwise
- Web console conflict UI: overwrite remote / keep remote / insert `<<<<<<<` markers
- Plugin-side conflicts: local file untouched, remote saved as `xxx.conflict.md`
- `rename` / `delete` are first-class messages; server rewrites paths and broadcasts
- 30s heartbeat + read/write timeouts clean up dead connections

## Open API for AI agents

`/openapi/*` is a REST API for AI agents and external scripts: create, read, update, delete and search notes — writes land in Obsidian seconds later via live broadcast. Auth with API keys (SHA-256 at rest, plaintext shown once).

```bash
KEY=owk_xxx   # generated in the web console
curl -s -H "X-API-Key: $KEY" http://localhost:8787/openapi/vaults
curl -s -X POST "http://localhost:8787/openapi/vaults/1/notes/AI/new-note.md" \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"content": "# Written by an AI\n\n..."}'
```

Full docs: [docs/openapi-skill.md](docs/openapi-skill.md)

## Build from source

```bash
git clone https://github.com/johnhom1024/owiki
cd owiki
make run          # :8787, default token: dev-token-change-me
make test-client  # in another terminal: full protocol walkthrough
```

## Contributing

Issues and PRs are welcome. Run `go test ./... && go vet ./...` before committing; for web changes run `pnpm build` inside `web/`. Release process: [docs/versioning.md](docs/versioning.md).

## Security

- Always change `OWIKI_TOKEN` and the admin password in production
- The server does not terminate TLS itself — put it behind a reverse proxy (caddy / nginx)
- Please do not open public issues for vulnerabilities: see [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE) © 2026 johnhom
