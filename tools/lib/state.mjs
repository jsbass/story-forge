// Pipeline state machine: stages, approval gates, staleness.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, hashFile, listFiles, rel } from './util.mjs';
import { projectPaths } from './project.mjs';

/** Phase 1 stages, in order. `artifacts` are project-relative files or folders (trailing /). */
export const STAGES = [
  { id: 'interview', label: 'Concept interview', owner: 'main session (story-interview skill)', artifacts: ['design/interview.md'] },
  { id: 'bible', label: 'Story Bible & branch map', owner: 'story-planner', artifacts: ['design/story-bible.md', 'design/branch-map.yaml'] },
  { id: 'characters', label: 'Character bios', owner: 'character-designer', artifacts: ['characters/'] },
  { id: 'loops', label: 'Game loop design', owner: 'loop-designer', artifacts: ['design/loops/'] },
  { id: 'script', label: 'Script / dialog', owner: 'dialog-writer', artifacts: ['script/'] },
  { id: 'build', label: 'Build (SugarCube)', owner: 'game-builder', artifacts: ['src/'] },
  { id: 'qa', label: 'QA (functional + character)', owner: 'qa-functional, qa-character', artifacts: ['qa/reports/'] },
  { id: 'playtest', label: 'Playtest sign-off', owner: 'you', artifacts: [] },
];

export const STATUS = ['pending', 'in_progress', 'awaiting_approval', 'approved'];

export function stageIndex(id) {
  const i = STAGES.findIndex((s) => s.id === id);
  if (i < 0) throw new Error(`Unknown stage '${id}'. Stages: ${STAGES.map((s) => s.id).join(', ')}`);
  return i;
}

export function newPipeline() {
  const stages = {};
  for (const s of STAGES) stages[s.id] = { status: 'pending', version: 0, approvedAt: null, approvedHashes: null, basedOn: null, history: [] };
  return { schema: 1, stages };
}

export function loadPipeline(root) {
  const p = readJson(projectPaths(root).pipeline);
  if (!p) throw new Error('state/pipeline.json missing. Is this a Forge project?');
  for (const s of STAGES) if (!p.stages[s.id]) p.stages[s.id] = newPipeline().stages[s.id];
  return p;
}

export function savePipeline(root, p) {
  writeJson(projectPaths(root).pipeline, p);
}

/** Expand a stage's artifact list to concrete files. */
export function artifactFiles(root, stage) {
  const files = [];
  for (const a of stage.artifacts) {
    const abs = path.join(root, a);
    if (a.endsWith('/')) files.push(...listFiles(abs).map((f) => rel(root, f)));
    else if (fs.existsSync(abs)) files.push(a);
  }
  return files;
}

export function hashArtifacts(root, stage) {
  const out = {};
  for (const f of artifactFiles(root, stage)) out[f] = hashFile(path.join(root, f));
  return out;
}

/** Files changed since the stage was last approved: {added, removed, changed}. */
export function diffSinceApproval(root, stage, st) {
  if (!st.approvedHashes) return null;
  const now = hashArtifacts(root, stage);
  const before = st.approvedHashes;
  const added = Object.keys(now).filter((f) => !(f in before));
  const removed = Object.keys(before).filter((f) => !(f in now));
  const changed = Object.keys(now).filter((f) => f in before && before[f] !== now[f]);
  return added.length || removed.length || changed.length ? { added, removed, changed } : null;
}

/** Compute derived status for every stage (modified / stale / blocked). */
export function computeStatus(root, p) {
  const rows = [];
  for (let i = 0; i < STAGES.length; i++) {
    const stage = STAGES[i];
    const st = p.stages[stage.id];
    const modified = st.status === 'approved' ? diffSinceApproval(root, stage, st) : null;
    const staleReasons = [];
    if (st.status === 'approved' && st.basedOn) {
      for (const up of STAGES.slice(0, i)) {
        const upSt = p.stages[up.id];
        if ((st.basedOn[up.id] ?? 0) < upSt.version) staleReasons.push(`${up.id} re-approved (v${st.basedOn[up.id] ?? 0} → v${upSt.version})`);
      }
    }
    for (const r of rows) if (r.modified) staleReasons.push(`${r.id} modified since approval`);
    const blockedBy = STAGES.slice(0, i).filter((u) => p.stages[u.id].status !== 'approved').map((u) => u.id);
    rows.push({
      id: stage.id,
      label: stage.label,
      owner: stage.owner,
      status: st.status,
      version: st.version,
      modified,
      stale: st.status === 'approved' && staleReasons.length > 0,
      staleReasons: [...new Set(staleReasons)],
      blockedBy,
    });
  }
  return rows;
}

/** The next actionable stage (first that isn't approved, or first stale). */
export function nextStage(rows) {
  const firstIssue = rows.find((r) => r.status !== 'approved' || r.stale || r.modified);
  return firstIssue || null;
}

export function transition(root, p, id, action, { note } = {}) {
  const i = stageIndex(id);
  const stage = STAGES[i];
  const st = p.stages[id];
  const now = new Date().toISOString();
  const rows = computeStatus(root, p);
  const row = rows[i];

  if (action === 'start') {
    if (row.blockedBy.length) throw new Error(`Can't start '${id}': waiting on approval of ${row.blockedBy.join(', ')}`);
    st.status = 'in_progress';
  } else if (action === 'submit') {
    if (st.status === 'pending' && row.blockedBy.length) throw new Error(`Can't submit '${id}': waiting on approval of ${row.blockedBy.join(', ')}`);
    const missing = stage.artifacts.filter((a) => artifactFiles(root, { artifacts: [a] }).length === 0);
    if (missing.length) throw new Error(`Can't submit '${id}': missing artifacts ${missing.join(', ')}`);
    st.status = 'awaiting_approval';
  } else if (action === 'approve') {
    if (row.blockedBy.length) throw new Error(`Can't approve '${id}': waiting on approval of ${row.blockedBy.join(', ')}`);
    if (st.status !== 'awaiting_approval' && !(st.status === 'approved' && (row.modified || row.stale))) {
      throw new Error(`'${id}' is ${st.status}; submit it for approval first`);
    }
    st.status = 'approved';
    st.version += 1;
    st.approvedAt = now;
    st.approvedHashes = hashArtifacts(root, stage);
    st.basedOn = Object.fromEntries(STAGES.slice(0, i).map((u) => [u.id, p.stages[u.id].version]));
  } else if (action === 'reject') {
    if (st.status === 'pending') throw new Error(`'${id}' hasn't been started`);
    st.status = 'in_progress';
  } else {
    throw new Error(`Unknown action '${action}'`);
  }
  st.history.push({ action, at: now, version: st.version, ...(note ? { note } : {}) });
  return st;
}
