// @ts-check
'use strict';
// Tracking store — the single sanctioned interface to RELEASE.md and .nightwatch/ledger.jsonl
// (spec §5, FR16/FR17). Jobs are written against the backend-neutral TrackerStore returned by
// openTracker(); a future backend migration is a mechanical replay against this same interface,
// not a rewrite. Two backends ship: `markdown` (persists to RELEASE.md, atomic) and an
// in-memory `memory` backend used by the conformance suite. Both share one core state machine
// so they pass the same behavioral tests by construction.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { nwDir, ensureDir, readFileSafe, exists } = require('./util');
const { dedupeFindings } = require('./findings');
const { openFindings: computeOpenFindings } = require('./lifecycle');

/** @typedef {import('./types').EvidenceItem} EvidenceItem */
/** @typedef {import('./types').Finding} Finding */

const KNOWN_BACKENDS = ['markdown', 'memory'];

// Recognized-but-future backends (§2.7): each maps to the CLI it drives. They are subject to the
// same local-only availability probe as extractor adapters (§2.6) — resolve the binary on PATH,
// never install, never touch the network. v0.1 ships no implementation for them, so a requested
// recognized backend always falls back to markdown; when its tool is missing the fallback names
// the tool, so the daytime fix is obvious.
const RECOGNIZED_BACKENDS = { beads: 'bd', backlogmd: 'backlog' };

/**
 * Resolve an executable by name on PATH (local-only; no network, no install). Returns the absolute
 * path if an executable candidate exists, else null. Mirrors the adapter availability contract.
 * @param {string} bin @returns {string|null}
 */
function resolveOnPath(bin) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const cand = path.join(dir, bin + ext);
      try { fs.accessSync(cand, fs.constants.X_OK); return cand; } catch { /* keep looking */ }
    }
  }
  return null;
}

// Store-level item sections and the RELEASE.md headings they render into. Completed items
// move to the shared Done section regardless of their origin section (never deleted).
const SECTIONS = ['implementation', 'documentation', 'blockers', 'decisions', 'nice', 'next'];
const HEADING_BY_SECTION = {
  implementation: 'Remaining — implementation',
  documentation: 'Remaining — documentation',
  blockers: 'Release blockers',
  decisions: 'Human decisions needed',
  nice: 'Nice to have',
  next: 'Next actions (top 3)',
};
const STATUS_CAP = 10;

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'RELEASE.md');

/** Stable, backend-independent item id from a caller locus/key (mirrors findings ids). */
function itemId(key) {
  return 'IT-' + crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 6);
}

function evToString(ev) {
  if (!Array.isArray(ev) || !ev.length) return '';
  return ev.map((e) => (e && e.line != null ? `${e.path}:${e.line}` : e && e.path)).filter(Boolean).join(', ');
}

// ---- RELEASE.md parse / serialize (markdown backend only) -----------------------------

/**
 * Split a RELEASE.md document into an ordered section model. `head` is everything before the
 * first `##` heading (frontmatter + title). Item lines carry a trailing `<!-- nw:ID -->` marker
 * so a human can freely edit the visible text while identity survives. The raw body of every
 * section is retained so an unmodified round-trip is byte-identical.
 */
function parseRelease(text) {
  const lines = text.split('\n');
  const headingIdx = [];
  for (let i = 0; i < lines.length; i++) if (/^## /.test(lines[i])) headingIdx.push(i);
  const head = headingIdx.length ? lines.slice(0, headingIdx[0]).join('\n') + '\n' : text;
  const sections = [];
  for (let s = 0; s < headingIdx.length; s++) {
    const start = headingIdx[s];
    const end = s + 1 < headingIdx.length ? headingIdx[s + 1] : lines.length;
    const heading = lines[start];
    const bodyRaw = lines.slice(start + 1, end).join('\n');
    sections.push({ heading, bodyRaw });
  }
  return { head, sections, raw: text };
}

/**
 * Rewrite a single frontmatter field inside a parsed `head` block, operating line-by-line so
 * every other frontmatter line (e.g. a quoted `target:`) is preserved byte-for-byte. `value`
 * is the already-formatted scalar text; pass `null` to delete the key. Returns `head` unchanged
 * when there is no `---` frontmatter fence (nothing safe to edit). This is the sole mechanism by
 * which a job updates RELEASE.md's header — the tracker stays the only sanctioned writer (FR16).
 */
function setFrontmatterField(head, key, value) {
  const lines = head.split('\n');
  if (lines[0] !== '---') return head;
  let end = -1;
  for (let i = 1; i < lines.length; i++) { if (lines[i] === '---') { end = i; break; } }
  if (end === -1) return head;
  const re = new RegExp('^' + key + ':');
  let idx = -1;
  for (let i = 1; i < end; i++) { if (re.test(lines[i])) { idx = i; break; } }
  if (value == null) {
    if (idx !== -1) lines.splice(idx, 1);
  } else if (idx !== -1) {
    lines[idx] = `${key}: ${value}`;
  } else {
    lines.splice(end, 0, `${key}: ${value}`);
  }
  return lines.join('\n');
}

/** Double-quote a string as a YAML scalar (safe for em dashes, backticks, colons). */
function yamlQuote(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

// Trailing-id form (canonical, FR63/§P3): `- [ ] <title> — evidence: … <!-- nw:IT-xxxxxx -->`.
// The id trails the line inside an HTML comment so the reader meets the action, not the code (0017),
// while identity survives a human editing the visible text.
const ITEM_RE = /^- \[([ xX])\] (.*?)(?:\s*<!-- nw:(IT-[0-9a-f]{6}) -->)?\s*$/;
// Legacy leading-id form: `- [ ] IT-xxxxxx — <title>`. Accepted on READ so a pre-reorder file still
// parses to the same {id,title,done}; the writer only ever emits the trailing form above (FR63).
const ITEM_LEADING_RE = /^- \[([ xX])\] (IT-[0-9a-f]{6}) — (.*?)\s*$/;

/** Parse item checklist lines out of a section body; non-item lines are section preamble. */
function parseItems(bodyRaw) {
  const items = [];
  const preamble = [];
  let seenItem = false;
  for (const line of bodyRaw.split('\n')) {
    // Legacy leading-id form first (its id token would otherwise read as part of the title).
    const lead = line.match(ITEM_LEADING_RE);
    if (lead) {
      seenItem = true;
      items.push({ id: lead[2], title: lead[3].trim(), done: lead[1].toLowerCase() === 'x', raw: line });
      continue;
    }
    const m = line.match(ITEM_RE);
    if (m && m[3]) {
      seenItem = true;
      items.push({ id: m[3], title: m[2].trim(), done: m[1].toLowerCase() === 'x', raw: line });
    } else if (!seenItem) {
      preamble.push(line);
    }
  }
  // Trim a single trailing blank preamble line so re-render spacing is predictable.
  return { preamble, items };
}

// Machine-rendered item: the id TRAILS the line (FR63). Human items carry their own `raw` and are
// emitted verbatim — their id placement is whatever the human wrote (never rewritten here).
function renderItem(it) {
  const box = it.status === 'done' ? 'x' : ' ';
  const ev = evToString(it.evidence);
  const body = it.title + (ev ? ` — evidence: ${ev}` : '');
  return `- [${box}] ${body} <!-- nw:${it.id} -->`;
}

// ---- Core state machine (shared by both backends) -------------------------------------

function makeCore(seed) {
  const items = new Map(); // id -> {id, title, section, status:'open'|'done', evidence, raw?}
  const order = [];
  let status = []; // [{date, text}] latest first
  let journey = null; // the release road (spec release-journey P2), re-derived and set each run
  let dirty = false;

  if (seed) {
    for (const it of seed.items || []) { items.set(it.id, it); order.push(it.id); }
    status = (seed.status || []).slice(0, STATUS_CAP);
  }

  function list(filter) {
    let out = order.map((id) => items.get(id)).filter(Boolean);
    if (filter && filter.status) out = out.filter((it) => it.status === filter.status);
    if (filter && filter.section) out = out.filter((it) => it.section === filter.section);
    return out.map((it) => ({ id: it.id, title: it.title, section: it.section, status: it.status, evidence: it.evidence || [] }));
  }

  return {
    get dirty() { return dirty; },
    get statusLines() { return status; },
    get journey() { return journey; },
    items,
    order,
    markDirty() { dirty = true; },
    // Set the release road (spec release-journey P2/10.4): the goal + ✓ ▶ ○ milestone marks, the
    // waivable hygiene gate, the 🏁 line, and the blockers line — re-derived from criteria state every
    // run (never stored in the file), so a stale mark self-corrects. Passing a journey dirties the doc.
    setJourney(j) { journey = j || null; dirty = true; return journey; },

    listItems(filter) { return list(filter); },
    query(filter) { return list(filter); },

    upsertItem(input) {
      if (!input || !input.title) throw new Error('upsertItem requires a title');
      if (input.section && !SECTIONS.includes(input.section)) throw new Error(`unknown section: ${input.section}`);
      const id = input.id || itemId(input.key != null ? input.key : `${input.section || 'implementation'}|${input.title}`);
      const evidence = Array.isArray(input.evidence) ? input.evidence : [];
      const existing = items.get(id);
      if (existing) {
        existing.title = input.title;
        if (input.section) existing.section = input.section;
        existing.evidence = evidence;
        existing.raw = null; // changed → re-render
      } else {
        items.set(id, { id, title: input.title, section: input.section || 'implementation', status: 'open', evidence, raw: null });
        order.push(id);
      }
      dirty = true;
      return items.get(id);
    },

    completeItem(id) {
      const it = items.get(id);
      if (!it) return null;
      it.status = 'done';
      it.raw = null;
      dirty = true;
      return it;
    },

    appendStatus(text, date) {
      status.unshift({ date: date || '', text: String(text) });
      if (status.length > STATUS_CAP) status = status.slice(0, STATUS_CAP);
      dirty = true;
      return status[0];
    },
    _setStatus(s) { status = s; },
  };
}

// ---- Ledger (append-only; tracker is the sole writer, FR17) ----------------------------

function ledgerPath(root) { return path.join(nwDir(root), 'ledger.jsonl'); }

function appendLedgerRows(root, rows) {
  if (!rows || !rows.length) return;
  ensureDir(nwDir(root));
  fs.appendFileSync(ledgerPath(root), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// ---- Backends --------------------------------------------------------------------------

/** Atomic file write: temp file in the same dir, then rename. */
function writeAtomic(file, text) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const DEFAULT_RELEASE_PATH = '.nightwatch/RELEASE.md';
const LEGACY_RELEASE_PATH = 'RELEASE.md';

/**
 * Absolute path the tracker WRITES RELEASE.md to — the configured `release_path` (repo-relative),
 * defaulting under `.nightwatch/` so a fresh install writes zero root files (FR49).
 * @param {string} root @param {{ release_path?: string }} [config]
 */
function releaseWritePath(root, config) {
  const rel = (config && config.release_path) || DEFAULT_RELEASE_PATH;
  return path.resolve(root, rel);
}

/**
 * Absolute path the tracker READS RELEASE.md from. Normally the write path; but when that file is
 * absent and a legacy root `RELEASE.md` exists, the legacy file is adopted (read byte-for-byte) so
 * an existing install keeps its history until migration (Story 7.2) relocates it (FR49).
 * @param {string} root @param {{ release_path?: string }} [config]
 */
function releaseReadPath(root, config) {
  const write = releaseWritePath(root, config);
  if (exists(write)) return write;
  const legacy = path.resolve(root, LEGACY_RELEASE_PATH);
  if (legacy !== write && exists(legacy)) return legacy;
  return write;
}

function loadReleaseText(readPath) {
  const existing = readFileSafe(readPath);
  if (existing != null) return existing;
  const tmpl = readFileSafe(TEMPLATE_PATH);
  return tmpl != null ? tmpl : '';
}

// The reader-side status section (spec release-journey P3): renamed "Status update" → "What changed
// lately". Parsing accepts BOTH names so a file in either order/name reads correctly; the writer only
// ever emits the new name. The road section is machine-rendered from the journey, never parsed for items.
const STATUS_HEADING_RE = /^## (Status update|What changed lately)/;
const ROAD_HEADING_RE = /^## The road/;

/** Seed core items from a parsed RELEASE.md model (parsed items become open/done in-memory). */
function seedFromRelease(model) {
  const items = [];
  const status = [];
  for (const sec of model.sections) {
    if (ROAD_HEADING_RE.test(sec.heading)) continue; // machine-rendered every run; never a source of items
    if (STATUS_HEADING_RE.test(sec.heading)) {
      for (const line of sec.bodyRaw.split('\n')) {
        const m = line.match(/^- (\d{4}-\d{2}-\d{2}) — (.*)$/);
        if (m) status.push({ date: m[1], text: m[2] });
      }
      continue;
    }
    const isDone = /^## Done/.test(sec.heading);
    let section = null;
    for (const s of SECTIONS) if (sec.heading === `## ${HEADING_BY_SECTION[s]}`) section = s;
    if (!isDone && !section) continue;
    const { items: parsed } = parseItems(sec.bodyRaw);
    for (const p of parsed) {
      items.push({ id: p.id, title: p.title, section: section || 'implementation', status: p.done || isDone ? 'done' : 'open', evidence: [], raw: p.raw });
    }
  }
  return { items, status };
}

// Reader-side canonical section order v2 (spec release-journey P3, supersedes FR63): the road leads,
// history reads as impact, Notes last. Whenever the document is rewritten (dirty), sections re-emit in
// THIS order regardless of read order. "Release blockers" and the "Remaining —" sections DISAPPEAR as
// headings — blockers fold into the road's Blocked-by line and remaining work into the current
// milestone / a "(not yet on the road)" group (serialization only; the tracker items and their
// `section` field are retained). Sections not named here keep their relative input order before Notes.
// The road leads; "Release blockers" and "Remaining —" rank here for the FLAT (no-milestones)
// rendering, but are FOLDED (skipped) when a journey is set — blockers → the road's Blocked-by line,
// remaining work → the current milestone / "(not yet on the road)". With them folded, the journey
// order is exactly: The road → Next actions → Human decisions → What changed lately → Done → Nice →
// Phase → Notes (spec release-journey P3).
const CANONICAL_ORDER = [
  'The road',                        // machine-rendered journey (first)
  HEADING_BY_SECTION.next,           // Next actions (top 3)
  HEADING_BY_SECTION.blockers,       // Release blockers (flat only; folded with a journey)
  HEADING_BY_SECTION.decisions,      // Human decisions needed
  HEADING_BY_SECTION.implementation, // Remaining — implementation (flat only; folded)
  HEADING_BY_SECTION.documentation,  // Remaining — documentation (flat only; folded)
  'What changed lately',             // was Status update — impact-first history
  'Done',
  HEADING_BY_SECTION.nice,           // Nice to have (Parked)
  'Phase',
];
// Folded into the road ONLY when a journey is set (a declared milestones list). Absent milestones →
// flat rendering keeps these sections so no tracker item is ever lost (FR17).
const FOLDED_HEADINGS = [HEADING_BY_SECTION.blockers, HEADING_BY_SECTION.implementation, HEADING_BY_SECTION.documentation];

/** Rank a heading in the canonical reader-side order (lower = earlier). Notes always sorts last. */
function canonicalRank(heading) {
  const h = heading.replace(/^##\s+/, '');
  if (/^Notes\b/.test(h)) return CANONICAL_ORDER.length + 1;
  // "Status update" ranks where "What changed lately" does (the rename) so a legacy file re-sorts correctly.
  if (h.startsWith('Status update')) return CANONICAL_ORDER.indexOf('What changed lately');
  for (let i = 0; i < CANONICAL_ORDER.length; i++) {
    if (h === CANONICAL_ORDER[i] || h.startsWith(CANONICAL_ORDER[i])) return i;
  }
  return CANONICAL_ORDER.length; // unknown/extra: after the known sections, before Notes
}

const CHANGED_HEADING = '## What changed lately (latest first, capped at 10 entries)';

/**
 * Render the `## The road` block (spec release-journey P2): the goal (attributed), ✓ ▶ ○ milestone
 * lines with the current milestone's remaining criteria expanded and later milestones as one
 * orientation clause, the waivable hygiene gate (never interleaved with declared milestones), the 🏁
 * line, the blockers line, and any "(not yet on the road)" work. Marks are whatever `journey` carries
 * — re-derived from criteria state by the caller every run, never stored. Byte-deterministic.
 */
function renderRoad(journey) {
  const L = ['## The road', ''];
  L.push(`**Goal (yours, declared in STATE.md):** ${journey.goal || '—'}`, '');
  const ms = journey.milestones || [];
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    if (m.done) { L.push(`- ✓ **${m.name}**`); continue; }
    if (i === journey.currentIndex) {
      L.push(`- ▶ **${m.name}** — *current milestone.*`);
      for (const c of (m.criteria || [])) L.push(`  - ${c}`);
    } else {
      L.push(`- ○ **${m.name}**`);
    }
  }
  const gate = (journey.hygiene && journey.hygiene.length) ? journey.hygiene.join(', ') : 'generic release checks';
  L.push(`- ○ **Hygiene gate before tagging** *(waivable gate — ${gate})*`);
  L.push('- 🏁 **Tag the release.**', '');
  L.push(`**Blocked by:** ${(journey.blockers && journey.blockers.length) ? journey.blockers.join(', ') : 'nothing'}`);
  if (journey.notOnRoad && journey.notOnRoad.length) {
    L.push('', '_(not yet on the road)_');
    for (const c of journey.notOnRoad) L.push(`- ${c}`);
  }
  L.push('');
  return L.join('\n');
}

function renderRelease(model, core) {
  // Untouched document → return original bytes (guarantees byte-identical round-trip, FR16). Canonical
  // reordering happens ONLY when the document is actually rewritten (a legacy-order file re-serializes
  // into the new order + new section names the first time something dirties it).
  if (!core.dirty) return model.raw;

  const doneItems = core.order.map((id) => core.items.get(id)).filter((it) => it && it.status === 'done');
  const openBySection = {};
  for (const s of SECTIONS) openBySection[s] = [];
  for (const id of core.order) {
    const it = core.items.get(id);
    if (it && it.status === 'open') (openBySection[it.section] || openBySection.implementation).push(it);
  }

  const renderLine = (it) => (it.raw != null ? it.raw : renderItem(it));

  // Fold the journey's blockers + "(not yet on the road)" work from the tracker's own open items when
  // the caller didn't supply them, so nothing an ex-section held is lost (spec P3 folding).
  const journey = core.journey;
  if (journey) {
    if (!journey.blockers) journey.blockers = openBySection.blockers.map((it) => it.title);
    if (!journey.notOnRoad) {
      const criteria = new Set((journey.milestones || []).flatMap((m) => m.criteria || []));
      const extras = [...openBySection.implementation, ...openBySection.documentation]
        .map((it) => it.title).filter((t) => !criteria.has(t));
      journey.notOnRoad = [...(journey.unreferenced || []), ...extras];
    }
  }

  // Fold blockers/remaining into the road ONLY when a journey is set; flat rendering keeps them.
  const isFolded = (heading) => !!journey && FOLDED_HEADINGS.some((h) => heading === `## ${h}`);

  const blockFor = (sec) => {
    if (/^## Notes/.test(sec.heading)) return [sec.heading, sec.bodyRaw.replace(/\n$/, '')].join('\n');
    if (ROAD_HEADING_RE.test(sec.heading)) return journey ? renderRoad(journey) : [sec.heading, sec.bodyRaw.replace(/\n$/, '')].join('\n');
    if (STATUS_HEADING_RE.test(sec.heading)) {
      const lines = core.statusLines.map((s) => `- ${s.date} — ${s.text}`);
      return [CHANGED_HEADING, lines.join('\n'), ''].join('\n');
    }
    const isDone = /^## Done/.test(sec.heading);
    let section = null;
    for (const s of SECTIONS) if (sec.heading === `## ${HEADING_BY_SECTION[s]}`) section = s;
    if (!isDone && !section) return [sec.heading, sec.bodyRaw.replace(/\n$/, '')].join('\n');
    const { preamble } = parseItems(sec.bodyRaw);
    const listItems = isDone ? doneItems : openBySection[section];
    const chunk = [sec.heading];
    const pre = preamble.join('\n').replace(/\s+$/, '');
    if (pre) chunk.push(pre);
    for (const it of listItems) chunk.push(renderLine(it));
    chunk.push('');
    return chunk.join('\n');
  };

  // Input sections re-sorted into canonical order; folded headings (Release blockers, Remaining —)
  // are dropped entirely (their items fold into the road). If a journey is set but the file has no
  // "## The road" section (a legacy file), inject a synthetic one so the road always leads.
  const kept = model.sections.filter((sec) => !isFolded(sec.heading));
  const hasRoad = kept.some((sec) => ROAD_HEADING_RE.test(sec.heading));
  const synthetic = (journey && !hasRoad) ? [{ heading: '## The road', bodyRaw: '' }] : [];
  const ordered = [...synthetic, ...kept]
    .map((sec, i) => ({ sec, i, rank: canonicalRank(sec.heading) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i);
  const out = [model.head.replace(/\n$/, '')];
  for (const o of ordered) out.push(blockFor(o.sec));
  let text = out.join('\n');
  if (!text.endsWith('\n')) text += '\n';
  return text;
}

/**
 * Open a tracking store for a repo.
 * @param {string} repo Repo root.
 * @param {{ tracking?: { backend?: string }, release_path?: string }} [config]
 * @returns {object} TrackerStore
 */
function openTracker(repo, config) {
  const requested = (config && config.tracking && config.tracking.backend) || 'markdown';
  const setupFindings = [];
  let backend = requested;
  if (!KNOWN_BACKENDS.includes(backend)) {
    // Recognized-but-future backend: probe its CLI locally. Missing tool → name it; present but
    // not yet implemented → say so. Truly-unknown names take the generic path. Every branch falls
    // back to markdown with no migration and no partial write on open (FR16).
    if (Object.prototype.hasOwnProperty.call(RECOGNIZED_BACKENDS, requested)) {
      const bin = RECOGNIZED_BACKENDS[requested];
      const found = resolveOnPath(bin);
      setupFindings.push({
        kind: 'setup', severity: 3, action: 'daytime-task', verified: false,
        title: found
          ? `Tracking backend "${requested}" is not yet implemented (v0.1 ships markdown only); falling back to markdown`
          : `Tracking backend "${requested}" needs "${bin}" on PATH, which was not found; falling back to markdown`,
        evidence: [{ path: '.nightwatch/config.yaml' }],
        id: itemId(`setup|tracking-backend|${requested}`),
      });
    } else {
      setupFindings.push({
        kind: 'setup', severity: 3, action: 'daytime-task', verified: false,
        title: `Unknown tracking backend "${requested}"; falling back to markdown`,
        evidence: [{ path: '.nightwatch/config.yaml' }],
        id: itemId(`setup|tracking-backend|${requested}`),
      });
    }
    backend = 'markdown';
  }

  if (backend === 'memory') {
    const core = makeCore(null);
    const memLedger = [];
    let memHead = {};
    return Object.assign(core, {
      backend: 'memory',
      setupFindings,
      updateHead(patch) {
        if (!patch || typeof patch !== 'object') return memHead;
        for (const k of ['progress', 'updated', 'notice', 'target']) {
          if (Object.prototype.hasOwnProperty.call(patch, k)) {
            if (patch[k] == null) delete memHead[k]; else memHead[k] = patch[k];
          }
        }
        core.markDirty();
        return memHead;
      },
      readHead() { return { ...memHead }; },
      recordFindings(findings, meta) {
        const { findings: deduped } = dedupeFindings(findings || []);
        for (const f of deduped) memLedger.push(toLedgerRow(f, meta));
        return deduped;
      },
      recordFeedback(fb) {
        const row = { type: 'feedback', id: fb.id, verdict: fb.verdict, date: fb.date || '' };
        memLedger.push(row);
        return row;
      },
      // Finding-lifecycle classification rows (spec finding-lifecycle P1). `resolution` closes a
      // finding with an evidence clause; `recheck` records that an open finding was re-examined
      // (method `deterministic`|`judgment`) or not reached (`skipped`). Both go through the store —
      // the sole sanctioned ledger writer (§2.7) — so no job touches ledger.jsonl directly.
      recordResolution(row) {
        const r = { type: 'resolution', id: row.id, date: row.date || '', evidence: String((row && row.evidence) || '') };
        memLedger.push(r);
        return r;
      },
      recordRecheck(row) {
        const r = { type: 'recheck', id: row.id, date: row.date || '', method: row.method };
        memLedger.push(r);
        return r;
      },
      recordRun(row) {
        const r = Object.assign({ type: 'run' }, row);
        memLedger.push(r);
        return r;
      },
      readLedger() { return memLedger.slice(); },
      // The open set carried into a run (spec P1): finding ids with no resolution and no dismissal.
      openFindings(opts) { return computeOpenFindings(memLedger.slice(), opts); },
      flush() { core.markDirty(); return { backend: 'memory' }; },
    });
  }

  // markdown backend — resolve the release_path once (with legacy-root adoption for reads).
  const writePath = releaseWritePath(repo, config);
  const readPath = releaseReadPath(repo, config);
  const releaseText = loadReleaseText(readPath);
  const model = parseRelease(releaseText);
  const core = makeCore(seedFromRelease(model));
  return Object.assign(core, {
    backend: 'markdown',
    setupFindings,
    /**
     * Update RELEASE.md frontmatter fields (progress/updated/notice) in the parsed `head`.
     * Only keys explicitly present in `patch` are touched; pass `null` to remove a key
     * (e.g. drop the generic-criteria notice once a `release:` block is declared). Marks the
     * document dirty only when the head actually changes, so an unchanged doc still round-trips
     * byte-identically (FR16).
     * @param {{ progress?: number|null, updated?: string|null, notice?: string|null, target?: string|null }} patch
     */
    updateHead(patch) {
      if (!patch || typeof patch !== 'object') return null;
      let head = model.head;
      if (Object.prototype.hasOwnProperty.call(patch, 'progress')) {
        head = setFrontmatterField(head, 'progress', patch.progress == null ? null : String(patch.progress));
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'updated')) {
        head = setFrontmatterField(head, 'updated', patch.updated == null ? null : String(patch.updated));
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'notice')) {
        head = setFrontmatterField(head, 'notice', patch.notice == null ? null : yamlQuote(patch.notice));
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'target')) {
        head = setFrontmatterField(head, 'target', patch.target == null ? null : yamlQuote(patch.target));
      }
      if (head !== model.head) { model.head = head; core.markDirty(); }
      return { head: model.head };
    },
    readHead() { return model.head; },
    recordFindings(findings, meta) {
      const { findings: deduped } = dedupeFindings(findings || []);
      appendLedgerRows(repo, deduped.map((f) => toLedgerRow(f, meta)));
      return deduped;
    },
    recordFeedback(fb) {
      const row = { type: 'feedback', id: fb.id, verdict: fb.verdict, date: fb.date || '' };
      appendLedgerRows(repo, [row]);
      return row;
    },
    // Finding-lifecycle classification rows (spec finding-lifecycle P1) — see the memory backend for
    // the semantics. Append-only through the store, never a raw ledger write (§2.7).
    recordResolution(row) {
      const r = { type: 'resolution', id: row.id, date: row.date || '', evidence: String((row && row.evidence) || '') };
      appendLedgerRows(repo, [r]);
      return r;
    },
    recordRecheck(row) {
      const r = { type: 'recheck', id: row.id, date: row.date || '', method: row.method };
      appendLedgerRows(repo, [r]);
      return r;
    },
    // The open set carried into a run (spec P1): finding ids with no resolution and no dismissal.
    openFindings(opts) { return computeOpenFindings(this.readLedger(), opts); },
    // Append a per-run ledger line (the brief collector's per-job summary: date/job/tokens/
    // findings count/degraded flags). A plain object stamped `type:'run'` and written through the
    // store's sole ledger writer, so no consumer needs to touch ledger.jsonl directly (§2.7).
    recordRun(row) {
      const r = Object.assign({ type: 'run' }, row);
      appendLedgerRows(repo, [r]);
      return r;
    },
    readLedger() {
      const t = readFileSafe(ledgerPath(repo));
      if (!t) return [];
      return t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    },
    flush() {
      const text = renderRelease(model, core);
      // Always write to the resolved release_path (default under .nightwatch/); the atomic temp
      // lands beside it, so it never appears in the repo root (FR49).
      writeAtomic(writePath, text);
      return { backend: 'markdown', bytes: text.length, path: writePath };
    },
  });
}

function toLedgerRow(f, meta) {
  const row = {
    type: 'finding', id: f.id, kind: f.kind, severity: f.severity,
    date: (meta && meta.date) || '', job: (meta && meta.job) || undefined,
  };
  // Persist the cited evidence loci (and the cited text, when the finding carries one) so the
  // deterministic re-verification floor (spec finding-lifecycle P2) can re-check a carried-forward
  // finding from the ledger alone, without its original transient findings doc.
  if (Array.isArray(f.evidence) && f.evidence.length) {
    row.evidence = f.evidence.map((e) => (e && e.line != null ? { path: e.path, line: e.line } : { path: e.path }));
  }
  if (typeof f.text === 'string' && f.text) row.text = f.text;
  return row;
}

module.exports = {
  openTracker, itemId, parseRelease, renderRelease, renderRoad, seedFromRelease,
  KNOWN_BACKENDS, RECOGNIZED_BACKENDS, SECTIONS, HEADING_BY_SECTION, ledgerPath,
  releaseReadPath, releaseWritePath, DEFAULT_RELEASE_PATH,
};
