// Feedback log: state/feedback/FB-####.md + index.json
import path from 'node:path';
import fs from 'node:fs';
import { readJson, writeJson, writeText, readText, toPosix } from './util.mjs';
import { projectPaths } from './project.mjs';

/** Default agent for a target path. The orchestrator may override. */
export const ROUTES = [
  ['characters/', 'character-designer'],
  ['script/', 'dialog-writer'],
  ['design/loops/', 'loop-designer'],
  ['design/', 'story-planner'],
  ['src/', 'game-builder'],
  ['build/', 'game-builder'],
  ['qa/', 'qa-functional'],
];

export function suggestRoute(targets = []) {
  for (const t of targets.map(toPosix)) {
    const hit = ROUTES.find(([prefix]) => t.startsWith(prefix));
    if (hit) return hit[1];
  }
  return 'orchestrator';
}

function indexFile(root) {
  return path.join(projectPaths(root).feedback, 'index.json');
}

export function loadIndex(root) {
  return readJson(indexFile(root), { next: 1, items: [] });
}

export function addFeedback(root, { text, stage = null, targets = [], route = null, source = 'chat', passage = null, snapshot = null, severity = null }) {
  if (!text || !text.trim()) throw new Error('Feedback text is empty');
  const idx = loadIndex(root);
  const id = `FB-${String(idx.next).padStart(4, '0')}`;
  idx.next += 1;
  const item = {
    id,
    status: 'open',
    stage,
    targets: targets.map(toPosix),
    route: route || suggestRoute(targets),
    source,
    severity,
    passage,
    created: new Date().toISOString(),
    summary: text.trim().split('\n')[0].slice(0, 80),
  };
  idx.items.push(item);
  writeJson(indexFile(root), idx);

  const lines = [
    `# ${id} — ${item.summary}`,
    '',
    `- status: open`,
    `- stage: ${stage ?? '-'}`,
    `- targets: ${item.targets.join(', ') || '-'}`,
    `- route: ${item.route}`,
    `- source: ${source}`,
    ...(severity ? [`- severity: ${severity}`] : []),
    ...(passage ? [`- passage: ${passage}`] : []),
    `- created: ${item.created}`,
    '',
    '## Note',
    '',
    text.trim(),
    '',
  ];
  if (snapshot) lines.push('## State snapshot', '', '```json', JSON.stringify(snapshot, null, 2), '```', '');
  lines.push('## Resolution', '', '_open_', '');
  writeText(path.join(projectPaths(root).feedback, `${id}.md`), lines.join('\n'));
  return item;
}

export function listFeedback(root, { open = false } = {}) {
  const idx = loadIndex(root);
  return open ? idx.items.filter((i) => i.status === 'open') : idx.items;
}

export function resolveFeedback(root, id, { note = '', commit = null, status = 'resolved' } = {}) {
  const idx = loadIndex(root);
  const item = idx.items.find((i) => i.id === id);
  if (!item) throw new Error(`No feedback item ${id}`);
  item.status = status;
  item.resolved = new Date().toISOString();
  if (commit) item.commit = commit;
  writeJson(indexFile(root), idx);
  const file = path.join(projectPaths(root).feedback, `${id}.md`);
  if (fs.existsSync(file)) {
    let md = readText(file).replace('- status: open', `- status: ${status}`);
    md = md.replace(/## Resolution\n\n_open_\n?/, `## Resolution\n\n${note || status}${commit ? ` (commit ${commit})` : ''}\n`);
    writeText(file, md);
  }
  return item;
}
