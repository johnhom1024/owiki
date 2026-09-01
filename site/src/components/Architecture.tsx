import { useLang } from '../i18n/LangProvider'
import { SectionHeading } from './Features'
import { SpotlightCard } from './SpotlightCard'

const ARCH_SVG = `<svg class="owiki-arch-svg" viewBox="0 0 1200 460" role="img" data-preset="classic" data-quality-profile="showcase">
        
        
        <!-- Definitions -->
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-default" />
          </marker>
          <marker id="arrowhead-emphasis" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-emphasis" />
          </marker>
          <marker id="arrowhead-security" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-security" />
          </marker>
          <marker id="arrowhead-dashed" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-dashed" />
          </marker>
          <pattern id="arch-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" class="c-grid" stroke-width="0.5"/>
          </pattern>
        </defs>

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#arch-grid)" />

        <!-- Boundaries (behind everything) -->
        <rect data-graph-role="structural-frame" data-composition-frame-kind="region" data-composition-frame-id="arch-node-0" x="470" y="60" width="680" height="146" rx="12" class="c-region" stroke-width="1"/>
        <text x="478" y="78" class="t-cloud" font-size="9" font-weight="600">fnOS NAS · Docker Compose（:8787）</text>

        <!-- Connection paths (before components for correct z-order) -->
        <path data-edge-from="obsidian" data-edge-to="server" data-edge-label="WebSocket 笔记同步" data-edge-key="0" data-edge-id="plugin-sync" data-composition-points="240,136;500,136" d="M 240 136 L 500 136" class="a-emphasis" stroke-width="1.8" marker-end="url(#arrowhead-emphasis)"/>
        <path data-edge-from="server" data-edge-to="sqlite" data-edge-label="GORM" data-edge-key="1" data-edge-id="server-db" data-composition-points="700,138;940,138" d="M 700 138 L 940 138" class="a-default" stroke-width="1.5" marker-end="url(#arrowhead)"/>
        <path data-edge-from="web" data-edge-to="server" data-edge-label="REST API 读写" data-edge-key="2" data-edge-id="web-api" data-composition-points="600,310;600,186" d="M 600 310 L 600 186" class="a-default" stroke-width="1.5" marker-end="url(#arrowhead)"/>
        <path data-edge-from="server" data-edge-to="web" data-edge-label="SSE 事件推送" data-edge-key="3" data-edge-id="server-sse" data-composition-points="600,186;600,310" d="M 600 186 L 600 310" class="a-dashed" stroke-width="1.5" marker-end="url(#arrowhead-dashed)"/>
        <path data-edge-from="openapi" data-edge-to="server" data-edge-label="X-API-Key" data-edge-key="4" data-edge-id="openapi-write" data-composition-points="880,352;856,352;856,210;600,210;600,186" d="M 880 352 L 864 352 Q 856 352 856 344 L 856 218 Q 856 210 848 210 L 608 210 Q 600 210 600 202 L 600 186" class="a-dashed" stroke-width="1.5" marker-end="url(#arrowhead-dashed)"/>

        <!-- Components -->
        <g id="node-obsidian" data-node-id="obsidian" data-node-label="Obsidian 编辑器" tabindex="0" role="button" aria-label="Focus Obsidian 编辑器, owiki-sync 插件 · TypeScript, Architecture component" aria-pressed="false" data-node-kind="frontend" data-node-sublabel="owiki-sync 插件 · TypeScript" data-node-tag="多设备 deviceId" data-node-context="Architecture component">
          <title>Obsidian 编辑器 · owiki-sync 插件 · TypeScript · Architecture component · 多设备 deviceId</title>
          <rect x="60" y="100" width="180" height="72" rx="6" class="c-mask"/>
          <rect x="60" y="100" width="180" height="72" rx="6" class="c-frontend" stroke-width="1.5"/>
          <g aria-hidden="true" data-semantic-sigil="frontend" class="semantic-sigil s-frontend" transform="translate(66 106) scale(0.6875)">
            <rect x="2" y="3" width="12" height="10" rx="2"/>
            <path d="M2 6.5h12"/>
            <circle cx="4.1" cy="4.8" r=".7" class="sigil-fill"/>
            <circle cx="6.3" cy="4.8" r=".7" class="sigil-fill"/>
          </g>
          <text data-detail-anchor x="150" y="134" class="t-primary" font-size="11" font-weight="600" text-anchor="middle">Obsidian 编辑器</text>
        <text data-detail="context" x="150" y="150" class="t-muted" font-size="9" text-anchor="middle">owiki-sync 插件 · TypeScript</text>
        <text data-detail="fine" x="150" y="164" class="t-frontend" font-size="7" text-anchor="middle">多设备 deviceId</text>
        </g>

        <g id="node-server" data-node-id="server" data-node-label="OWiki 服务端" tabindex="0" role="button" aria-label="Focus OWiki 服务端, Go · WebSocket Hub, fnOS NAS · Docker Compose（:8787）" aria-pressed="false" data-node-kind="backend" data-node-sublabel="Go · WebSocket Hub" data-node-tag="ws / service / merge / repository" data-node-context="fnOS NAS · Docker Compose（:8787）">
          <title>OWiki 服务端 · Go · WebSocket Hub · fnOS NAS · Docker Compose（:8787） · ws / service / merge / repository</title>
          <rect x="500" y="90" width="200" height="96" rx="6" class="c-mask"/>
          <rect x="500" y="90" width="200" height="96" rx="6" class="c-backend" stroke-width="1.5"/>
          <g aria-hidden="true" data-semantic-sigil="backend" class="semantic-sigil s-backend" transform="translate(506 96) scale(0.6875)">
            <path d="M6 3 3 8l3 5M10 3l3 5-3 5"/>
          </g>
          <text data-detail-anchor x="600" y="136" class="t-primary" font-size="11" font-weight="600" text-anchor="middle">OWiki 服务端</text>
        <text data-detail="context" x="600" y="152" class="t-muted" font-size="9" text-anchor="middle">Go · WebSocket Hub</text>
        <text data-detail="fine" x="600" y="178" class="t-backend" font-size="7" text-anchor="middle">ws / service / merge / repository</text>
        </g>

        <g id="node-sqlite" data-node-id="sqlite" data-node-label="SQLite" tabindex="0" role="button" aria-label="Focus SQLite, GORM · vault_device · sync_logs, fnOS NAS · Docker Compose（:8787）" aria-pressed="false" data-node-kind="database" data-node-sublabel="GORM · vault_device · sync_logs" data-node-context="fnOS NAS · Docker Compose（:8787）">
          <title>SQLite · GORM · vault_device · sync_logs · fnOS NAS · Docker Compose（:8787）</title>
          <rect x="940" y="102" width="180" height="72" rx="6" class="c-mask"/>
          <rect x="940" y="102" width="180" height="72" rx="6" class="c-database" stroke-width="1.5"/>
          <g aria-hidden="true" data-semantic-sigil="database" class="semantic-sigil s-database" transform="translate(946 108) scale(0.6875)">
            <ellipse cx="8" cy="4" rx="5" ry="2"/>
            <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>
          </g>
          <text data-detail-anchor x="1030" y="136" class="t-primary" font-size="11" font-weight="600" text-anchor="middle">SQLite</text>
        <text data-detail="context" x="1030" y="152" class="t-muted" font-size="9" text-anchor="middle">GORM · vault_device · sync_logs</text>
        </g>

        <g id="node-web" data-node-id="web" data-node-label="Web 管理端" tabindex="0" role="button" aria-label="Focus Web 管理端, React · Vite, Architecture component" aria-pressed="false" data-node-kind="frontend" data-node-sublabel="React · Vite" data-node-context="Architecture component">
          <title>Web 管理端 · React · Vite · Architecture component</title>
          <rect x="510" y="310" width="180" height="64" rx="6" class="c-mask"/>
          <rect x="510" y="310" width="180" height="64" rx="6" class="c-frontend" stroke-width="1.5"/>
          <g aria-hidden="true" data-semantic-sigil="frontend" class="semantic-sigil s-frontend" transform="translate(516 316) scale(0.6875)">
            <rect x="2" y="3" width="12" height="10" rx="2"/>
            <path d="M2 6.5h12"/>
            <circle cx="4.1" cy="4.8" r=".7" class="sigil-fill"/>
            <circle cx="6.3" cy="4.8" r=".7" class="sigil-fill"/>
          </g>
          <text data-detail-anchor x="600" y="340" class="t-primary" font-size="11" font-weight="600" text-anchor="middle">Web 管理端</text>
        <text data-detail="context" x="600" y="356" class="t-muted" font-size="9" text-anchor="middle">React · Vite</text>
        </g>

        <g id="node-openapi" data-node-id="openapi" data-node-label="OpenAPI 调用方" tabindex="0" role="button" aria-label="Focus OpenAPI 调用方, AI 助手 / 脚本, Architecture component" aria-pressed="false" data-node-kind="external" data-node-sublabel="AI 助手 / 脚本" data-node-context="Architecture component">
          <title>OpenAPI 调用方 · AI 助手 / 脚本 · Architecture component</title>
          <rect x="880" y="320" width="180" height="64" rx="6" class="c-mask"/>
          <rect x="880" y="320" width="180" height="64" rx="6" class="c-external" stroke-width="1.5"/>
          <g aria-hidden="true" data-semantic-sigil="external" class="semantic-sigil s-external" transform="translate(886 326) scale(0.6875)">
            <rect x="2.5" y="5" width="8.5" height="8" rx="1.5"/>
            <path d="M8 2.5h5.5V8M13.5 2.5 7.5 8.5"/>
          </g>
          <text data-detail-anchor x="970" y="350" class="t-primary" font-size="11" font-weight="600" text-anchor="middle">OpenAPI 调用方</text>
        <text data-detail="context" x="970" y="366" class="t-muted" font-size="9" text-anchor="middle">AI 助手 / 脚本</text>
        </g>

        <!-- Connection labels -->
        <g data-detail="context" data-edge-from="obsidian" data-edge-to="server" data-edge-label="WebSocket 笔记同步" data-edge-key="0" data-edge-id="plugin-sync">
          <rect x="321.8" y="116" width="96.39999999999999" height="14" rx="3" class="c-mask"/>
          <text x="370" y="126" class="t-backend" font-size="8" text-anchor="middle">WebSocket 笔记同步</text>
        </g>
        <g data-detail="context" data-edge-from="server" data-edge-to="sqlite" data-edge-label="GORM" data-edge-key="1" data-edge-id="server-db">
          <rect x="805" y="118" width="30" height="14" rx="3" class="c-mask"/>
          <text x="820" y="128" class="t-muted" font-size="8" text-anchor="middle">GORM</text>
        </g>
        <g data-detail="context" data-edge-from="web" data-edge-to="server" data-edge-label="REST API 读写" data-edge-key="2" data-edge-id="web-api">
          <rect x="503.8" y="243" width="72.4" height="14" rx="3" class="c-mask"/>
          <text x="540" y="253" class="t-muted" font-size="8" text-anchor="middle">REST API 读写</text>
        </g>
        <g data-detail="context" data-edge-from="server" data-edge-to="web" data-edge-label="SSE 事件推送" data-edge-key="3" data-edge-id="server-sse">
          <rect x="626.2" y="243" width="67.6" height="14" rx="3" class="c-mask"/>
          <text x="660" y="253" class="t-messagebus" font-size="8" text-anchor="middle">SSE 事件推送</text>
        </g>
        <g data-detail="context" data-edge-from="openapi" data-edge-to="server" data-edge-label="X-API-Key" data-edge-key="4" data-edge-id="openapi-write">
          <rect x="783.4" y="275" width="53.199999999999996" height="14" rx="3" class="c-mask"/>
          <text x="810" y="285" class="t-messagebus" font-size="8" text-anchor="middle">X-API-Key</text>
        </g>

        <!-- Legend -->
        <g data-legend data-legend-bridge>
          <text x="40" y="424" class="t-primary" font-size="12" font-weight="650">Legend</text>
          <g data-legend-semantic-kind="frontend" data-legend-kind="frontend" data-legend-label="Frontend" data-legend-x="40" data-legend-baseline="444" data-legend-width="83">
            <rect x="40" y="435" width="16" height="10" rx="2.5" class="c-frontend" stroke-width="1"/>
            <text x="62" y="444" class="t-muted" font-size="10" font-weight="500">Frontend</text>
          </g>
          <g data-legend-semantic-kind="backend" data-legend-kind="backend" data-legend-label="Backend" data-legend-x="145" data-legend-baseline="444" data-legend-width="78">
            <rect x="145" y="435" width="16" height="10" rx="2.5" class="c-backend" stroke-width="1"/>
            <text x="167" y="444" class="t-muted" font-size="10" font-weight="500">Backend</text>
          </g>
          <g data-legend-semantic-kind="database" data-legend-kind="database" data-legend-label="Database" data-legend-x="245" data-legend-baseline="444" data-legend-width="83">
            <rect x="245" y="435" width="16" height="10" rx="2.5" class="c-database" stroke-width="1"/>
            <text x="267" y="444" class="t-muted" font-size="10" font-weight="500">Database</text>
          </g>
          <g data-legend-semantic-kind="external" data-legend-kind="external" data-legend-label="External" data-legend-x="350" data-legend-baseline="444" data-legend-width="83">
            <rect x="350" y="435" width="16" height="10" rx="2.5" class="c-external" stroke-width="1"/>
            <text x="372" y="444" class="t-muted" font-size="10" font-weight="500">External</text>
          </g>
        </g>
      </svg>`

export function Architecture() {
  const { t } = useLang()

  return (
    <section id="architecture" className="border-y border-line-soft bg-surface/30 py-20 md:py-28">
      <style>{`
.owiki-arch {
  --bg: transparent;
  --grid: #211d36;
  --text: var(--color-ink, #eceaf6);
  --text-muted: var(--color-muted, #a29bc0);
  --text-dim: var(--color-faint, #6f6890);
  --text-faint: var(--color-faint, #6f6890);
  --panel: rgba(18, 16, 28, 0.5);
  --panel-border: #2a2542;
  --lane-fill: rgba(25, 22, 39, 0.22);
  --lane-stroke: #2a2542;
  --mask: #12101c;
  --arrow: #6f6890;
  --arrow-emphasis: #4ade80;
  --frontend-fill: rgba(125, 211, 252, 0.10);
  --frontend-stroke: #7dd3fc;
  --backend-fill: rgba(139, 92, 246, 0.12);
  --backend-stroke: #8b5cf6;
  --database-fill: rgba(196, 181, 253, 0.08);
  --database-stroke: #c4b5fd;
  --external-fill: rgba(162, 155, 192, 0.08);
  --external-stroke: #a29bc0;
  --cloud-fill: rgba(251, 191, 36, 0.06);
  --cloud-stroke: #fbbf24;
  --security-fill: rgba(251, 113, 133, 0.10);
  --security-stroke: #fb7185;
  --messagebus-fill: rgba(251, 146, 60, 0.08);
  --messagebus-stroke: #fb923c;
}
.owiki-arch .c-grid { stroke: var(--grid); fill: none; }
.owiki-arch .c-mask { fill: var(--mask); stroke: none; }
.owiki-arch .c-frontend { fill: var(--frontend-fill); stroke: var(--frontend-stroke); }
.owiki-arch .c-backend { fill: var(--backend-fill); stroke: var(--backend-stroke); }
.owiki-arch .c-database { fill: var(--database-fill); stroke: var(--database-stroke); }
.owiki-arch .c-external { fill: var(--external-fill); stroke: var(--external-stroke); }
.owiki-arch .c-region { fill: rgba(251, 191, 36, 0.05); stroke: var(--cloud-stroke); stroke-dasharray: 8,4; }
.owiki-arch .t-primary { fill: var(--text); }
.owiki-arch .t-muted { fill: var(--text-muted); }
.owiki-arch .t-frontend { fill: var(--frontend-stroke); }
.owiki-arch .t-backend { fill: var(--backend-stroke); }
.owiki-arch .t-cloud { fill: var(--cloud-stroke); }
.owiki-arch .t-messagebus { fill: var(--messagebus-stroke); }
.owiki-arch svg .semantic-sigil { fill: none; stroke: currentColor; stroke-width: 1.35; stroke-linecap: round; stroke-linejoin: round; opacity: 0.76; }
.owiki-arch svg .semantic-sigil > * { vector-effect: non-scaling-stroke; }
.owiki-arch svg .semantic-sigil .sigil-fill { fill: currentColor; stroke: none; }
.owiki-arch svg .s-frontend { color: var(--frontend-stroke); }
.owiki-arch svg .s-backend { color: var(--backend-stroke); }
.owiki-arch svg .s-database { color: var(--database-stroke); }
.owiki-arch svg .s-external { color: var(--external-stroke); }
.owiki-arch .a-default { stroke: var(--arrow); fill: none; }
.owiki-arch .a-emphasis { stroke: var(--arrow-emphasis); fill: none; }
.owiki-arch .a-dashed { stroke: var(--database-stroke); fill: none; stroke-dasharray: 4,4; }
.owiki-arch .m-default { fill: var(--arrow); }
.owiki-arch .m-emphasis { fill: var(--arrow-emphasis); }
.owiki-arch .m-dashed { fill: var(--database-stroke); }
.owiki-arch .owiki-arch-svg { width: 100%; height: auto; display: block; }
      `}</style>
      <div className="mx-auto max-w-6xl px-5">
        <SectionHeading title={t.architecture.title} subtitle={t.architecture.subtitle} />
        <SpotlightCard className="card-glow mt-14 overflow-hidden rounded-2xl border border-line bg-surface/80">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h3 className="text-sm font-semibold">{t.architecture.panelTitle}</h3>
            <span className="font-mono text-[10px] text-faint">{'obsidian -> server -> web'}</span>
          </div>
          <div
            className="owiki-arch flex min-h-[280px] items-center justify-center p-4 md:p-8"
            dangerouslySetInnerHTML={{ __html: ARCH_SVG }}
          />
        </SpotlightCard>
      </div>
    </section>
  )
}
