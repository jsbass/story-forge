// Static analysis of a compiled story (list of Twee passages).
// Severity: S1 story/character (never auto-fixed) · S2 major · S3 minor · S4 cosmetic

export const SPECIAL_NAMES = new Set([
  'StoryInit', 'StoryCaption', 'StoryMenu', 'StoryBanner', 'StorySubtitle', 'StoryAuthor', 'StoryInterface',
  'StoryShare', 'StoryTitle', 'StoryData', 'PassageReady', 'PassageDone', 'PassageHeader', 'PassageFooter',
]);
const NON_STORY_TAGS = ['widget', 'script', 'stylesheet', 'debug', 'Twine.private'];

export function isStoryPassage(p) {
  return !SPECIAL_NAMES.has(p.name) && !p.tags.some((t) => NON_STORY_TAGS.includes(t));
}

const STR = `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`;
const LINK_MACRO_RE = new RegExp(`<<(?:link|button|actions|choice)\\s+${STR}\\s+${STR}`, 'g');
const NAV_MACRO_RE = new RegExp(`<<(goto|include|display)\\s+${STR}`, 'g');
const WIKI_LINK_RE = /\[\[(.+?)\]\]/g;
const ASSIGN_RE = /\$([A-Za-z_]\w*)\s*(?:to\b|=(?!=)|\+=|-=|\*=|\/=)/g;
const VAR_RE = /\$([A-Za-z_]\w*)/g;

const unquote = (s) => (s.startsWith('"') ? JSON.parse(s) : s.slice(1, -1).replace(/\\'/g, "'"));

/** Outgoing references from passage text. kind: link | goto | include */
export function extractRefs(text) {
  const refs = [];
  let m;
  LINK_MACRO_RE.lastIndex = 0;
  while ((m = LINK_MACRO_RE.exec(text))) refs.push({ kind: 'link', to: unquote(m[2]), label: unquote(m[1]) });
  NAV_MACRO_RE.lastIndex = 0;
  while ((m = NAV_MACRO_RE.exec(text))) refs.push({ kind: m[1] === 'goto' ? 'goto' : 'include', to: unquote(m[2]) });
  WIKI_LINK_RE.lastIndex = 0;
  while ((m = WIKI_LINK_RE.exec(text))) {
    let inner = m[1].split('][')[0];
    let to;
    if (inner.includes('|')) to = inner.slice(inner.lastIndexOf('|') + 1);
    else if (inner.includes('->')) to = inner.slice(inner.lastIndexOf('->') + 2);
    else if (inner.includes('<-')) to = inner.slice(0, inner.indexOf('<-'));
    else to = inner;
    refs.push({ kind: 'link', to: to.trim(), label: inner });
  }
  return refs;
}

/** Variables assigned / read in a piece of text. */
export function extractVars(text) {
  const assigned = new Set();
  const macroBodies = text.match(/<<(?:set|run|capture|unset)\s[\s\S]*?>>/g) || [];
  for (const body of macroBodies) {
    let m;
    ASSIGN_RE.lastIndex = 0;
    while ((m = ASSIGN_RE.exec(body))) assigned.add(m[1]);
  }
  const all = new Set();
  let m;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(text))) all.add(m[1]);
  // A read is any occurrence that isn't the left side of an assignment.
  const stripped = text.replace(/\$([A-Za-z_]\w*)\s*(?:to\b|=(?!=))/g, '');
  const read = new Set();
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(stripped))) read.add(m[1]);
  return { assigned, read, all };
}

/**
 * @param {object} o
 * @param {{name,tags,text}[]} o.passages
 * @param {string} o.start
 * @param {{id,scene?}[]} [o.expectedEndings]  from branch map
 * @param {string[]} [o.expectedScenes]        scene ids from branch map
 */
export function analyzeStatic({ passages, start, expectedEndings = [], expectedScenes = [] }) {
  const findings = [];
  const add = (severity, kind, passage, message) => findings.push({ severity, kind, passage, message });
  const byName = new Map(passages.map((p) => [p.name, p]));
  const story = passages.filter(isStoryPassage);
  const storyNames = new Set(story.map((p) => p.name));

  // Graph
  const edges = [];
  const out = new Map();
  for (const p of passages) {
    const refs = extractRefs(p.text);
    out.set(p.name, refs);
    for (const r of refs) {
      if (!byName.has(r.to)) {
        add('S2', 'broken-link', p.name, `${r.kind} to unknown passage '${r.to}'`);
        continue;
      }
      if (isStoryPassage(p)) edges.push({ from: p.name, to: r.to, kind: r.kind, label: r.label });
    }
  }
  if (!byName.has(start)) add('S1', 'no-start', null, `Start passage '${start}' does not exist`);

  // Reachability from start
  const reach = new Set();
  const queue = byName.has(start) ? [start] : [];
  while (queue.length) {
    const n = queue.shift();
    if (reach.has(n)) continue;
    reach.add(n);
    for (const r of out.get(n) || []) if (byName.has(r.to) && !reach.has(r.to)) queue.push(r.to);
  }
  const endingPassages = story.filter((p) => p.tags.includes('ending'));
  for (const p of story) {
    if (reach.has(p.name)) continue;
    if (p.tags.includes('ending')) add('S2', 'unreachable-ending', p.name, `Ending passage can't be reached from '${start}'`);
    else add('S3', 'unreachable', p.name, `Passage can't be reached from '${start}'`);
  }

  // Dead ends: story passages with no way forward that aren't endings or include-fragments
  const includedOnly = new Set(edges.filter((e) => e.kind === 'include').map((e) => e.to));
  for (const p of story) {
    if (p.tags.includes('ending') || includedOnly.has(p.name)) continue;
    const nav = (out.get(p.name) || []).filter((r) => r.kind !== 'include' && byName.has(r.to));
    if (!nav.length) add('S2', 'dead-end', p.name, 'No choices or links out, and not tagged as an ending');
  }
  if (!endingPassages.length) add('S2', 'no-endings', null, 'Story has no ending passages (END in Forge Script)');

  // Branch-map expectations
  const endingIds = new Set(
    endingPassages.flatMap((p) => [...p.text.matchAll(/<<forge_ending\s+"([^"]+)"/g)].map((m) => m[1]))
  );
  for (const e of expectedEndings) {
    if (!endingIds.has(e.id)) add('S2', 'missing-ending', e.scene || null, `Ending '${e.id}' from the branch map isn't implemented`);
  }
  const scenePassages = new Set(story.filter((p) => p.tags.includes('scene')).map((p) => p.name));
  for (const s of expectedScenes) {
    if (!scenePassages.has(s)) add('S2', 'missing-scene', s, `Scene '${s}' from the branch map has no script`);
  }
  if (expectedScenes.length) {
    const planned = new Set(expectedScenes);
    for (const s of scenePassages) if (!planned.has(s)) add('S4', 'unplanned-scene', s, 'Scene exists in scripts but not in the branch map');
  }

  // Variables
  const init = byName.get('StoryInit');
  const declared = init ? extractVars(init.text).assigned : new Set();
  const assigned = new Set(declared);
  const read = new Set();
  const readWhere = new Map();
  for (const p of passages) {
    // StoryInit is declarations; script/stylesheet passages are JS/CSS where `$` isn't a story variable.
    if (p.name === 'StoryInit' || p.tags.includes('script') || p.tags.includes('stylesheet')) continue;
    const v = extractVars(p.text);
    v.assigned.forEach((x) => assigned.add(x));
    v.read.forEach((x) => {
      read.add(x);
      if (!readWhere.has(x)) readWhere.set(x, p.name);
    });
  }
  // Module code refers to variables by name in strings ("mara_aff"); count those as reads.
  const allText = passages.map((p) => p.text).join('\n');
  for (const name of assigned) if (new RegExp(`["']${name}["']`).test(allText)) read.add(name);
  for (const name of read) {
    if (!assigned.has(name)) add('S2', 'undefined-variable', readWhere.get(name), `$${name} is read but never set or declared in StoryInit`);
  }
  for (const name of assigned) {
    // forge_* variables belong to the runtime (e.g. $forge_media) and are read from JS.
    if (!read.has(name) && !name.startsWith('forge_')) add('S4', 'unused-variable', null, `$${name} is set but never read`);
  }

  const order = { S1: 0, S2: 1, S3: 2, S4: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || String(a.passage).localeCompare(String(b.passage)));
  return {
    findings,
    graph: { start, nodes: [...storyNames], edges, endings: endingPassages.map((p) => p.name) },
    stats: {
      storyPassages: story.length,
      reachable: story.filter((p) => reach.has(p.name)).length,
      endings: endingPassages.length,
      variables: assigned.size,
    },
  };
}

/** Shortest path (BFS) between two passages over the static link graph. */
export function shortestPath(graph, from, to, { avoid = () => false } = {}) {
  const adj = new Map();
  for (const e of graph.edges) {
    if (e.kind === 'include') continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const n = queue.shift();
    if (n === to) break;
    for (const m of adj.get(n) || []) {
      if (prev.has(m) || avoid(m)) continue;
      prev.set(m, n);
      queue.push(m);
    }
  }
  if (!prev.has(to)) return null;
  const path = [];
  for (let n = to; n !== null; n = prev.get(n)) path.unshift(n);
  return path;
}
