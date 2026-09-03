<div align="center">

<img src="https://raw.githubusercontent.com/johnhom1024/owiki/main/docs/logo.svg" width="96" height="96" alt="OWiki">

# OWiki

Self-hosted sync & wiki service for Obsidian notes

Sync notes across devices · Reach your vault from any browser · Let an AI assistant run your vault · Your data stays on your own machine

[Website](https://johnhom1024.github.io/owiki/) · [GitHub](https://github.com/johnhom1024/owiki) · [Obsidian plugin](https://github.com/johnhom1024/owiki-sync) · [AI API docs](https://github.com/johnhom1024/owiki/blob/main/docs/openapi-skill.md)

<img src="https://raw.githubusercontent.com/johnhom1024/owiki/main/docs/screenshots/home-en.jpg" alt="OWiki web console" width="820">

</div>

---

> **Experimental software** — OWiki is in an early experimental stage. Back up your vault before connecting. See the [README](https://github.com/johnhom1024/owiki#readme) for details.

## Why OWiki

- **Realtime multi-device sync** — edits reach every device within 2 seconds; offline changes are never lost
- **Your vault on the web** — read and edit all your notes in any browser, no Obsidian required
- **Conflicts never lose content** — mergeable edits merge automatically; the rest are saved as conflict copies
- **Open AI API** — hand your AI assistant an API key and it can write, organize and search your notes for you
- **Single-file data** — everything lives in one SQLite file; copy it and you have a backup

## Quick start

```bash
docker run -d --name owiki \
  -p 8787:8787 \
  -e OWIKI_ADMIN_PASSWORD=<strong-password> \
  -v ./owiki-data:/data \
  johnhom1024/owiki:latest
```

Then open `http://localhost:8787` to create a vault, and install the [Obsidian plugin](https://github.com/johnhom1024/owiki-sync) with the sync token.

Full guide (docker-compose, binaries, plugin setup): [README on GitHub](https://github.com/johnhom1024/owiki#readme)

## Links

- [GitHub repository](https://github.com/johnhom1024/owiki) — source, issues and releases
- [Website](https://johnhom1024.github.io/owiki/) — feature overview and how sync works
- [Obsidian plugin](https://github.com/johnhom1024/owiki-sync) — the client that syncs your vault
- [AI API docs](https://github.com/johnhom1024/owiki/blob/main/docs/openapi-skill.md) — OpenAPI endpoints and the agent-skill guide
- [Versioning](https://github.com/johnhom1024/owiki/blob/main/docs/versioning.md) — image tags and the release process

## License

[MIT](https://github.com/johnhom1024/owiki/blob/main/LICENSE) © 2026 johnhom
