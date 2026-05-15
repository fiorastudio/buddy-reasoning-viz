#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { writeFileSync, readdirSync, readFileSync } from "fs";
import { join, basename, dirname } from "path";
import { homedir } from "os";
import { exec } from "child_process";
import { createHash } from "crypto";

// --- Config ---
const DB_PATH = join(homedir(), ".buddy", "buddy.db");
const OUT_DIR = import.meta.dir;
const SESSION_FILTER = process.argv[2] || null; // optional: pass session_id as arg

// --- Resolve session hashes to project names ---
function buildCwdHashMap(): Map<string, string> {
  const map = new Map<string, string>();
  const sessionsDir = join(homedir(), ".claude", "sessions");
  try {
    const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const data = JSON.parse(
          readFileSync(join(sessionsDir, file), "utf-8")
        );
        if (data.cwd) {
          const hash = createHash("sha256")
            .update(data.cwd)
            .digest("hex")
            .slice(0, 16);
          const parent = basename(dirname(data.cwd));
          const folder = basename(data.cwd);
          map.set(hash, `${parent}/${folder}`);
        }
      } catch {}
    }
  } catch {}
  return map;
}

const cwdHashMap = buildCwdHashMap();
console.log(`Resolved ${cwdHashMap.size} project paths from Claude sessions`);

// --- Basis style map ---
const BASIS_STYLES: Record<string, { color: string; shape: string; label: string }> = {
  research: { color: "#1E88E5", shape: "trapezoid", label: "research" },
  empirical: { color: "#43A047", shape: "diamond", label: "empirical" },
  deduction: { color: "#8E24AA", shape: "circle", label: "deduction" },
  analogy: { color: "#FB8C00", shape: "rect", label: "analogy" },
  definition: { color: "#546E7A", shape: "hexagon", label: "definition" },
  llm_output: { color: "#FDD835", shape: "octagon", label: "llm_output" },
  assumption: { color: "#6D4C41", shape: "box", label: "assumption" },
  vibes: { color: "#E53935", shape: "triangleDown", label: "vibes" },
};

const BASIS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(BASIS_STYLES).map(([basis, style]) => [basis, style.color])
);

const EDGE_COLORS: Record<string, string> = {
  supports: "#2196F3",
  depends_on: "#9E9E9E",
  contradicts: "#F44336",
  questions: "#FF9800",
};

const CAUTION_FINDINGS = new Set([
  "load_bearing_vibes",
  "unchallenged_chain",
  "echo_chamber",
  "unverified_hedge",
]);
const KUDOS_FINDINGS = new Set([
  "well_sourced_load_bearer",
  "productive_stress_test",
  "grounded_premise_adopted",
]);

function svgMarkupForBasisShape(shape: string, fill: string, stroke: string, strokeWidth: number): string {
  const common = `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"`;
  switch (shape) {
    case "trapezoid":
      return `<polygon points="22,12 78,12 92,88 8,88" ${common} />`;
    case "diamond":
      return `<polygon points="50,8 92,50 50,92 8,50" ${common} />`;
    case "circle":
      return `<circle cx="50" cy="50" r="38" ${common} />`;
    case "wobble":
      return `<path d="M18 28 C26 10, 46 8, 60 14 C82 18, 92 34, 88 54 C86 78, 64 92, 42 88 C22 86, 10 68, 12 48 C10 40, 12 34, 18 28 Z" ${common} />`;
    case "rect":
      return `<rect x="12" y="18" width="76" height="64" rx="4" ry="4" ${common} />`;
    case "bowtie":
      return `<polygon points="8,18 44,18 50,50 56,18 92,18 64,50 92,82 56,82 50,50 44,82 8,82 36,50" ${common} />`;
    case "hexagon":
      return `<polygon points="25,10 75,10 92,50 75,90 25,90 8,50" ${common} />`;
    case "octagon":
      return `<polygon points="30,8 70,8 92,30 92,70 70,92 30,92 8,70 8,30" ${common} />`;
    case "triangle":
      return `<polygon points="50,8 92,88 8,88" ${common} />`;
    case "triangleDown":
      return `<polygon points="8,12 92,12 50,92" ${common} />`;
    case "box":
      return `<rect x="12" y="12" width="76" height="76" rx="6" ry="6" ${common} />`;
    default:
      return `<circle cx="50" cy="50" r="38" ${common} />`;
  }
}

function makeNodeSvg(shape: string, fill: string, stroke: string, strokeWidth: number): string {
  const body = svgMarkupForBasisShape(shape, fill, stroke, strokeWidth);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function makeLegendIconSvg(shape: string, fill: string): string {
  const body = svgMarkupForBasisShape(shape, fill, "rgba(0,0,0,0.18)", 4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 100 100">${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// --- Read database ---
console.log(`Opening database: ${DB_PATH}`);
const db = new Database(DB_PATH, { readonly: true, strict: true });

const sessionClause = SESSION_FILTER
  ? `WHERE session_id = '${SESSION_FILTER}'`
  : "";

const claims = db
  .prepare(`SELECT * FROM reasoning_claims ${sessionClause} ORDER BY created_at`)
  .all() as Array<{
  id: string;
  session_id: string;
  speaker: string;
  text: string;
  basis: string;
  confidence: string;
  created_at: number;
}>;

const edges = db
  .prepare(`SELECT * FROM reasoning_edges ${sessionClause} ORDER BY created_at`)
  .all() as Array<{
  id: string;
  session_id: string;
  from_claim: string;
  to_claim: string;
  type: string;
  created_at: number;
}>;

const findings = db
  .prepare(
    `SELECT * FROM reasoning_findings_log ${
      SESSION_FILTER ? `WHERE session_id = '${SESSION_FILTER}'` : ""
    } ORDER BY created_at`
  )
  .all() as Array<{
  id: number;
  companion_id: string;
  session_id: string;
  finding_type: string;
  anchor_claim_id: string;
  observe_seq: number;
  created_at: number;
}>;

db.close();

console.log(
  `Loaded: ${claims.length} claims, ${edges.length} edges, ${findings.length} findings`
);

// --- Build finding map (claim_id → finding_types[]) ---
const findingMap = new Map<string, string[]>();
for (const f of findings) {
  const list = findingMap.get(f.anchor_claim_id) || [];
  list.push(f.finding_type);
  findingMap.set(f.anchor_claim_id, list);
}

// --- Build degree map ---
const degreeMap = new Map<string, number>();
for (const e of edges) {
  degreeMap.set(e.from_claim, (degreeMap.get(e.from_claim) || 0) + 1);
  degreeMap.set(e.to_claim, (degreeMap.get(e.to_claim) || 0) + 1);
}

// --- Collect sessions and build project/date structures ---
const sessions = [...new Set(claims.map((c) => c.session_id))].sort();

// Parse session IDs into project + date
const sessionMeta = sessions.map((sid) => {
  const parts = sid.split("-");
  const date = parts.slice(-1)[0]; // YYYYMMDD
  const hash = parts.slice(0, -1).join("-"); // everything before date
  const projectName = cwdHashMap.get(hash) || hash.slice(0, 8) + "…";
  return { session_id: sid, hash, date, projectName };
});

const projects = [...new Set(sessionMeta.map((s) => s.hash))].map((hash) => ({
  hash,
  name: cwdHashMap.get(hash) || hash.slice(0, 8) + "…",
}));

const datesByProject = new Map<string, string[]>();
for (const s of sessionMeta) {
  const list = datesByProject.get(s.hash) || [];
  if (!list.includes(s.date)) list.push(s.date);
  datesByProject.set(s.hash, list.sort());
}

// --- Build vis.js nodes ---
const claimIds = new Set(claims.map((c) => c.id));
const visNodes = claims.map((c) => {
  const claimFindings = findingMap.get(c.id) || [];
  const hasCaution = claimFindings.some((f) => CAUTION_FINDINGS.has(f));
  const hasKudos = claimFindings.some((f) => KUDOS_FINDINGS.has(f));
  const degree = degreeMap.get(c.id) || 0;
  const baseSize = 28 + Math.min(degree * 5, 20);

  let borderColor = "#CCCCCC";
  let borderWidth = 1;
  if (hasCaution) {
    borderColor = "#F44336";
    borderWidth = 3;
  } else if (hasKudos) {
    borderColor = "#4CAF50";
    borderWidth = 3;
  }

  const ts = new Date(c.created_at).toLocaleString();
  const label =
    c.text.length > 60 ? c.text.slice(0, 57) + "..." : c.text;

  const basisShape = BASIS_STYLES[c.basis]?.shape || "dot";
  const basisColor = BASIS_STYLES[c.basis]?.color || "#999";

  return {
    id: c.id,
    label,
    title: c.text,
    shape: "image",
    image: makeNodeSvg(basisShape, basisColor, borderColor, borderWidth),
    brokenImage: makeNodeSvg("dot", basisColor, borderColor, borderWidth),
    size: baseSize,
    color: {
      background: basisColor,
      border: borderColor,
      highlight: {
        background: basisColor,
        border: "#333",
      },
    },
    borderWidth,
    font: { size: 18, color: "#1a1a1a", strokeWidth: 5, strokeColor: "#ffffff", face: "-apple-system, 'Segoe UI', sans-serif" },
    // metadata for sidebar
    _meta: {
      text: c.text,
      speaker: c.speaker,
      basis: c.basis,
      confidence: c.confidence,
      session_id: c.session_id,
      created_at: ts,
      findings: claimFindings,
      degree,
    },
  };
});

// --- Build vis.js edges (skip orphans) ---
const visEdges = edges
  .filter((e) => claimIds.has(e.from_claim) && claimIds.has(e.to_claim))
  .map((e) => {
    const isDashed = e.type === "contradicts" || e.type === "questions";
    return {
      id: e.id,
      from: e.from_claim,
      to: e.to_claim,
      label: e.type,
      arrows: { to: { enabled: true, scaleFactor: 0.5 } },
      dashes: isDashed,
      color: { color: EDGE_COLORS[e.type] || "#999", opacity: 0.7 },
      width: e.type === "contradicts" ? 2 : 1.5,
      font: { size: 16, color: "#333", strokeWidth: 4, strokeColor: "#ffffff", background: "#ffffffee", align: "horizontal" },
      smooth: { type: "continuous", roundness: 0.2 },
      _meta: {
        type: e.type,
        session_id: e.session_id,
      },
    };
  });

// --- Stats ---
const stats = {
  claims: claims.length,
  edges: edges.length,
  findings: findings.length,
  sessions: sessions.length,
  basisBreakdown: Object.fromEntries(
    Object.keys(BASIS_COLORS).map((b) => [
      b,
      claims.filter((c) => c.basis === b).length,
    ])
  ),
  findingBreakdown: Object.fromEntries(
    [...CAUTION_FINDINGS, ...KUDOS_FINDINGS].map((f) => [
      f,
      findings.filter((fi) => fi.finding_type === f).length,
    ])
  ),
};

// --- Write graph.json ---
const graphJson = {
  generated_at: new Date().toISOString(),
  db_path: DB_PATH,
  sessions,
  stats,
  nodes: claims.map((c) => ({
    id: c.id,
    session_id: c.session_id,
    speaker: c.speaker,
    text: c.text,
    basis: c.basis,
    confidence: c.confidence,
    created_at: c.created_at,
    findings: findingMap.get(c.id) || [],
  })),
  edges: edges.map((e) => ({
    id: e.id,
    from: e.from_claim,
    to: e.to_claim,
    type: e.type,
    session_id: e.session_id,
  })),
};

writeFileSync(
  join(OUT_DIR, "graph.json"),
  JSON.stringify(graphJson, null, 2)
);
console.log(`Wrote graph.json`);

// --- Generate HTML ---
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Buddy Guard Mode — Reasoning Graph</title>
<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #ffffff; color: #1a1a1a; display: flex; height: 100vh; overflow: hidden; }
  #graph { flex: 1; background: #fafafa; }
  #sidebar { width: 360px; background: #f5f5f5; border-left: 1px solid #ddd; display: flex; flex-direction: column; overflow-y: auto; }
  .section { padding: 14px 16px; border-bottom: 1px solid #e0e0e0; }
  .section h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.8px; color: #555; margin-bottom: 8px; font-weight: 600; }
  h1 { font-size: 17px; font-weight: 700; color: #1a1a1a; }
  h1 span { font-weight: 400; color: #777; font-size: 13px; }

  select, input[type="text"] {
    width: 100%; padding: 8px 10px; background: #fff; border: 1px solid #ccc; border-radius: 6px;
    color: #1a1a1a; font-size: 14px; outline: none;
  }
  select:focus, input:focus { border-color: #4a6cf7; box-shadow: 0 0 0 2px #4a6cf733; }

  .filters { display: flex; flex-wrap: wrap; gap: 5px; }
  .filter-chip {
    display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px;
    border-radius: 14px; font-size: 12px; cursor: pointer; border: 1px solid #ccc; background: #fff;
    transition: opacity 0.15s; color: #333;
  }
  .filter-chip:hover { background: #e8e8e8; }
  .filter-chip.off { opacity: 0.3; }
  .filter-chip.active { background: #e3e8ff; border-color: #4a6cf7; font-weight: 600; }
  .filter-chip .basis-icon { width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .filter-chip .basis-icon img { width: 14px; height: 14px; display: block; }
  .filter-chip .dot { width: 10px; height: 10px; border-radius: 50%; }
  .shape-dot { border-radius: 50%; }
    .shape-box { border-radius: 2px; }
  .shape-trapezoid { clip-path: polygon(18% 0%, 82% 0%, 100% 100%, 0% 100%); }
  .shape-circle { border-radius: 50%; }
  .shape-wobble { clip-path: polygon(14% 18%, 36% 3%, 68% 10%, 90% 30%, 85% 68%, 63% 92%, 28% 86%, 8% 58%); }
  .shape-rect { border-radius: 4px; }
  .shape-bowtie { clip-path: polygon(0% 20%, 44% 20%, 50% 50%, 56% 20%, 100% 20%, 66% 50%, 100% 80%, 56% 80%, 50% 50%, 44% 80%, 0% 80%, 34% 50%); }
  .shape-diamond { transform: rotate(45deg); border-radius: 1px; }
  .shape-triangle { border-bottom: 12px solid var(--basis-color, currentColor); border-top: 0; border-radius: 0; border-color: transparent transparent var(--basis-color, currentColor) transparent; border-style: solid; }
  .shape-triangleDown { border-top: 12px solid var(--basis-color, currentColor); border-bottom: 0; border-radius: 0; border-color: var(--basis-color, currentColor) transparent transparent transparent; border-style: solid; }
  .shape-star { clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%); }
  .shape-hexagon { clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%); }
  .shape-octagon { clip-path: polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%); }
  .shape-database { border-radius: 999px / 6px; }

  #detail { min-height: 120px; }
  #detail .empty { color: #999; font-style: italic; font-size: 14px; }
  .detail-row { margin-bottom: 8px; font-size: 14px; }
  .detail-row .label { color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px; font-weight: 600; }
  .detail-row .value { color: #1a1a1a; line-height: 1.5; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; margin-right: 4px; }
  .badge.caution { background: #FFEBEE; color: #C62828; border: 1px solid #EF9A9A; }
  .badge.kudos { background: #E8F5E9; color: #2E7D32; border: 1px solid #A5D6A7; }

  .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .stat-card { background: #fff; border-radius: 8px; padding: 12px 14px; border: 1px solid #e0e0e0; }
  .stat-card .num { font-size: 24px; font-weight: 700; color: #1a1a1a; }
  .stat-card .lbl { font-size: 12px; color: #666; }

  .legend-item { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 5px; color: #333; }
  .legend-swatch { width: 16px; height: 16px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; color: inherit; }
  .legend-swatch img { width: 16px; height: 16px; display: block; }
  .legend-line { width: 22px; height: 3px; flex-shrink: 0; border-radius: 1px; }
  .legend-line.dashed { background: repeating-linear-gradient(to right, currentColor 0, currentColor 4px, transparent 4px, transparent 8px); height: 3px; }

  .edge-section { font-size: 14px; margin-top: 8px; }
  .edge-section .label { color: #666; font-size: 11px; font-weight: 600; }

  /* vis.js nav buttons */
  div.vis-network div.vis-navigation div.vis-button { background-color: rgba(255,255,255,0.9) !important; border: 1px solid #ccc !important; border-radius: 6px !important; }
  div.vis-network div.vis-navigation div.vis-button:hover { background-color: #eee !important; }
</style>
</head>
<body>

<div id="graph"></div>

<div id="sidebar">
  <div class="section">
    <h1>Buddy Guard Mode <span>reasoning graph</span></h1>
  </div>

  <div class="section">
    <h3>Project</h3>
    <select id="projectFilter">
      <option value="all">All Projects (${projects.length})</option>
      ${projects.map((p) => `<option value="${esc(p.hash)}">${esc(p.name)}</option>`).join("\n      ")}
    </select>
  </div>

  <div class="section">
    <h3>Date</h3>
    <select id="dateFilter">
      <option value="all">All Dates</option>
    </select>
  </div>

  <div class="section">
    <h3>Search Claims</h3>
    <input type="text" id="searchBox" placeholder="Type to filter claims..." />
  </div>

  <div class="section">
    <h3>Isolate by Basis</h3>
    <div class="filters" id="basisFilters">
      ${Object.entries(BASIS_STYLES)
        .map(
          ([basis, style]) =>
            `<div class="filter-chip" data-basis="${basis}"><span class="basis-icon"><img alt="" src="${makeLegendIconSvg(style.shape, style.color)}" /></span>${basis}</div>`
        )
        .join("\n      ")}
    </div>
  </div>

  <div class="section">
    <h3>Filter by Edge Type</h3>
    <div class="filters" id="edgeFilters">
      ${Object.entries(EDGE_COLORS)
        .map(
          ([type, color]) =>
            `<div class="filter-chip" data-edge="${type}"><span class="dot" style="background:${color}"></span>${type.replace("_", " ")}</div>`
        )
        .join("\n      ")}
    </div>
  </div>

  <div class="section">
    <h3>Node Detail</h3>
    <div id="detail"><div class="empty">Click a node to see details</div></div>
  </div>

  <div class="section">
    <h3>Stats</h3>
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${stats.claims}</div><div class="lbl">Claims</div></div>
      <div class="stat-card"><div class="num">${stats.edges}</div><div class="lbl">Edges</div></div>
      <div class="stat-card"><div class="num">${stats.findings}</div><div class="lbl">Findings</div></div>
      <div class="stat-card"><div class="num">${stats.sessions}</div><div class="lbl">Sessions</div></div>
    </div>
  </div>

  <div class="section">
    <h3>Legend — Basis</h3>
    ${Object.entries(BASIS_STYLES)
      .map(
        ([basis, style]) =>
          `<div class="legend-item"><div class="legend-swatch"><img alt="" src="${makeLegendIconSvg(style.shape, style.color)}" /></div>${basis}</div>`
      )
      .join("\n    ")}
  </div>

  <div class="section">
    <h3>Legend — Edges</h3>
    <div class="legend-item"><div class="legend-line" style="background:#2196F3"></div>supports</div>
    <div class="legend-item"><div class="legend-line" style="background:#9E9E9E"></div>depends_on</div>
    <div class="legend-item"><div class="legend-line dashed" style="color:#F44336"></div>contradicts</div>
    <div class="legend-item"><div class="legend-line dashed" style="color:#FF9800"></div>questions</div>
  </div>

  <div class="section">
    <h3>Legend — Findings</h3>
    <div class="legend-item"><div class="legend-swatch" style="background:transparent;border:3px solid #C62828"></div>Caution finding (red border)</div>
    <div class="legend-item"><div class="legend-swatch" style="background:transparent;border:3px solid #2E7D32"></div>Kudos finding (green border)</div>
    <div class="legend-item"><div class="legend-swatch" style="background:transparent;border:1px solid #999"></div>No findings</div>
    <div style="margin-top:6px; font-size:12px; color:#666">
      Diamond = user claim &nbsp;|&nbsp; Circle = assistant claim
    </div>
  </div>
</div>

<script>
const RAW_NODES = ${JSON.stringify(visNodes).replace(/<\/script>/gi, "<\\/script>")};
const RAW_EDGES = ${JSON.stringify(visEdges).replace(/<\/script>/gi, "<\\/script>")};
const ALL_SESSIONS = ${JSON.stringify(sessions)};
const SESSION_META = ${JSON.stringify(sessionMeta)};
const DATES_BY_PROJECT = ${JSON.stringify(Object.fromEntries(datesByProject))};

const nodes = new vis.DataSet(RAW_NODES);
const edges = new vis.DataSet(RAW_EDGES);

const container = document.getElementById("graph");
const network = new vis.Network(container, { nodes, edges }, {
  physics: {
    enabled: true,
    solver: "forceAtlas2Based",
    forceAtlas2Based: {
      gravitationalConstant: -230,
      centralGravity: 0.006,
      springLength: 320,
      springConstant: 0.025,
      damping: 0.6,
      avoidOverlap: 1.35
    },
    stabilization: { iterations: 400, fit: true },
    minVelocity: 0.75
  },
  interaction: {
    hover: true,
    tooltipDelay: 100,
    hideEdgesOnDrag: false,
    zoomView: true,
    dragView: true,
    navigationButtons: true,
    keyboard: { enabled: true },
    zoomSpeed: 0.5,
    multiselect: true
  },
  edges: {
    smooth: {
      enabled: true,
      type: "dynamic",
      roundness: 0.32,
      forceDirection: "none"
    },
    length: 290,
    width: 1.5,
    selectionWidth: 2.5,
    hoverWidth: 2
  },
  layout: {
    improvedLayout: true,
    randomSeed: 7,
    clusterThreshold: 150
  },
  nodes: {
    font: { size: 18 }
  }
});

// After stabilization: disable physics and enforce readable zoom
network.on("stabilizationIterationsDone", () => {
  network.setOptions({ physics: { enabled: false } });
  // Fit to view, then enforce minimum zoom so labels stay readable
  network.fit({ animation: false });
  setTimeout(() => {
    const scale = network.getScale();
    // If zoomed out so far that 18px graph-font < ~10px screen-font, zoom in
    const minScale = 0.55;
    if (scale < minScale) {
      network.moveTo({ scale: minScale, animation: { duration: 300, easingFunction: "easeInOutQuad" } });
    }
  }, 100);
});

// --- Click handler: show node detail ---
network.on("click", (params) => {
  const detail = document.getElementById("detail");
  if (params.nodes.length > 0) {
    const nodeId = params.nodes[0];
    const node = nodes.get(nodeId);
    if (!node || !node._meta) return;
    const m = node._meta;

    const findingBadges = m.findings.length > 0
      ? m.findings.map(f => {
          const cls = ["load_bearing_vibes","unchallenged_chain","echo_chamber"].includes(f) ? "caution" : "kudos";
          return '<span class="badge ' + cls + '">' + esc(f.replace(/_/g, " ")) + '</span>';
        }).join("")
      : '<span style="color:#999">None</span>';

    detail.innerHTML =
      '<div class="detail-row"><span class="label">Claim</span><span class="value">' + esc(m.text) + '</span></div>' +
      '<div class="detail-row"><span class="label">Speaker</span><span class="value">' + esc(m.speaker) + '</span></div>' +
      '<div class="detail-row"><span class="label">Basis</span><span class="value">' + esc(m.basis) + '</span></div>' +
      '<div class="detail-row"><span class="label">Confidence</span><span class="value">' + esc(m.confidence) + '</span></div>' +
      '<div class="detail-row"><span class="label">Session</span><span class="value" style="font-size:11px;word-break:break-all">' + esc(m.session_id) + '</span></div>' +
      '<div class="detail-row"><span class="label">Time</span><span class="value">' + esc(m.created_at) + '</span></div>' +
      '<div class="detail-row"><span class="label">Connections</span><span class="value">' + m.degree + ' edge(s)</span></div>' +
      '<div class="detail-row"><span class="label">Findings</span><span class="value">' + findingBadges + '</span></div>';
  } else if (params.edges.length > 0) {
    const edgeId = params.edges[0];
    const edge = edges.get(edgeId);
    if (!edge) return;
    const fromNode = nodes.get(edge.from);
    const toNode = nodes.get(edge.to);
    detail.innerHTML =
      '<div class="edge-section"><span class="label">Edge Type</span><div class="value" style="margin:4px 0;font-weight:600">' + esc(edge.label) + '</div></div>' +
      '<div class="edge-section"><span class="label">From</span><div class="value">' + esc(fromNode?._meta?.text || edge.from) + '</div></div>' +
      '<div class="edge-section"><span class="label">To</span><div class="value">' + esc(toNode?._meta?.text || edge.to) + '</div></div>';
  } else {
    detail.innerHTML = '<div class="empty">Click a node to see details</div>';
  }
});

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// --- Double-click: zoom to neighborhood ---
network.on("doubleClick", (params) => {
  if (params.nodes.length > 0) {
    const nodeId = params.nodes[0];
    const connected = network.getConnectedNodes(nodeId);
    network.fit({ nodes: [nodeId, ...connected], animation: { duration: 500, easingFunction: "easeInOutQuad" } });
  }
});

// --- Project filter ---
const projectFilter = document.getElementById("projectFilter");
const dateFilter = document.getElementById("dateFilter");

function formatDate(d) {
  return d.slice(0, 4) + "/" + d.slice(4, 6) + "/" + d.slice(6, 8);
}

projectFilter.addEventListener("change", () => {
  const hash = projectFilter.value;
  dateFilter.innerHTML = '<option value="all">All Dates</option>';
  if (hash !== "all" && DATES_BY_PROJECT[hash]) {
    DATES_BY_PROJECT[hash].forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = formatDate(d);
      dateFilter.appendChild(opt);
    });
  }
  applyFilters();
});
dateFilter.addEventListener("change", applyFilters);

// --- Search ---
let searchTerm = "";
document.getElementById("searchBox").addEventListener("input", (e) => {
  searchTerm = e.target.value.toLowerCase();
  applyFilters();
});

// --- Basis filter chips ---
let activeBasis = null;
document.querySelectorAll("#basisFilters .filter-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    const basis = chip.dataset.basis;
    if (activeBasis === basis) {
      activeBasis = null;
      chip.classList.remove("active");
    } else {
      activeBasis = basis;
      document.querySelectorAll("#basisFilters .filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
    }
    applyFilters();
  });
});

// --- Edge type filter chips ---
const activeEdgeTypes = new Set();
document.querySelectorAll("#edgeFilters .filter-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    const edgeType = chip.dataset.edge;
    if (activeEdgeTypes.has(edgeType)) {
      activeEdgeTypes.delete(edgeType);
      chip.classList.remove("active");
    } else {
      activeEdgeTypes.add(edgeType);
      chip.classList.add("active");
    }
    applyFilters();
  });
});

// Build adjacency for neighbor lookups
const adjacency = new Map();
RAW_EDGES.forEach(e => {
  if (!adjacency.has(e.from)) adjacency.set(e.from, new Set());
  if (!adjacency.has(e.to)) adjacency.set(e.to, new Set());
  adjacency.get(e.from).add(e.to);
  adjacency.get(e.to).add(e.from);
});

// Parse session_id into hash and date
function parseSessionId(sid) {
  const parts = sid.split("-");
  const date = parts[parts.length - 1];
  const hash = parts.slice(0, -1).join("-");
  return { hash, date };
}

function applyFilters() {
  const selectedProject = projectFilter.value;
  const selectedDate = dateFilter.value;

  // Step 1: find primary matching nodes
  const primaryIds = new Set();
  RAW_NODES.forEach(n => {
    const m = n._meta;
    let match = true;
    const { hash, date } = parseSessionId(m.session_id);
    if (selectedProject !== "all" && hash !== selectedProject) match = false;
    if (selectedDate !== "all" && date !== selectedDate) match = false;
    if (activeBasis && m.basis !== activeBasis) match = false;
    if (searchTerm && !m.text.toLowerCase().includes(searchTerm)) match = false;
    if (match) primaryIds.add(n.id);
  });

  // Step 2: if basis filter is active, also include connected neighbors
  const visibleIds = new Set(primaryIds);
  if (activeBasis) {
    primaryIds.forEach(id => {
      const neighbors = adjacency.get(id);
      if (neighbors) {
        neighbors.forEach(nid => {
          const neighborNode = RAW_NODES.find(n => n.id === nid);
          if (neighborNode) {
            const { hash, date } = parseSessionId(neighborNode._meta.session_id);
            const projectOk = selectedProject === "all" || hash === selectedProject;
            const dateOk = selectedDate === "all" || date === selectedDate;
            if (projectOk && dateOk) visibleIds.add(nid);
          }
        });
      }
    });
  }

  // Step 3: if edge type filter active, only show nodes connected by those edge types
  let filteredEdgeNodeIds = null;
  if (activeEdgeTypes.size > 0) {
    filteredEdgeNodeIds = new Set();
    RAW_EDGES.forEach(e => {
      if (activeEdgeTypes.has(e._meta.type)) {
        filteredEdgeNodeIds.add(e.from);
        filteredEdgeNodeIds.add(e.to);
      }
    });
  }

  // Step 4: apply visibility
  const nodeUpdates = [];
  RAW_NODES.forEach(n => {
    let visible = visibleIds.has(n.id);
    if (visible && filteredEdgeNodeIds) visible = filteredEdgeNodeIds.has(n.id);
    nodeUpdates.push({ id: n.id, hidden: !visible });
  });
  nodes.update(nodeUpdates);

  const finalVisibleNodes = new Set(nodeUpdates.filter(u => !u.hidden).map(u => u.id));
  const edgeUpdates = [];
  RAW_EDGES.forEach(e => {
    let visible = finalVisibleNodes.has(e.from) && finalVisibleNodes.has(e.to);
    if (visible && activeEdgeTypes.size > 0) visible = activeEdgeTypes.has(e._meta.type);
    edgeUpdates.push({ id: e.id, hidden: !visible });
  });
  edges.update(edgeUpdates);

  // Highlight search matches
  if (searchTerm) {
    const matchIds = [...primaryIds].filter(id => finalVisibleNodes.has(id)).slice(0, 20);
    if (matchIds.length > 0) network.selectNodes(matchIds);
  } else {
    network.unselectAll();
  }
}
<\/script>
</body>
</html>`;

const htmlPath = join(OUT_DIR, "graph.html");
writeFileSync(htmlPath, html);
console.log(`Wrote graph.html`);

const openCmd =
  process.platform === "win32" ? `start "" "${htmlPath}"` :
  process.platform === "darwin" ? `open "${htmlPath}"` :
  `xdg-open "${htmlPath}"`;

exec(openCmd, (err) => {
  if (err) console.error(`Could not open browser: ${err.message}`);
});
console.log(`Opening in browser...`);
