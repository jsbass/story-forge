// Exploration & time budget loop module: a hub-and-spoke map of locations, each visit costing time,
// with a deadline passage when the time runs out.
//
// loops.yaml entry:
//   - id: night
//     type: explore
//     params:
//       time: { var: hours, start: 8, label: "Hours until dawn", expire: dawn, warn_at: 2 }
//       locations:
//         - { id: cellar, passage: cellar, label: "The cellar", cost: 2 }
//         - { id: lamp, passage: lamp_room, label: "The lamp room", cost: 1, requires: '$inv.includes("lantern")', locked_text: "Too dark without a lantern" }
//
// Script usage:   <<map_menu>>        list of locations (cost, visited marker, locked ones greyed out)
//                 <<spend 1>>          spend time in place (e.g. in a choice's do-block)
// When the time reaches 0, the move that spent it still happens; the navigation after that goes to
// the `expire` passage instead (endings and the expire passage itself are exempt).
// Read the clock like any variable: $hours.

export const description = 'Hub-and-spoke exploration with travel costs, and an optional time budget with a deadline passage.';

export const usage = `<<map_menu>>  <<spend n>>   conditions: $hours > 2`;

export function validate(params) {
  const errs = [];
  const t = params?.time;
  if (!t && !(params?.locations || []).length) errs.push('give params.time, params.locations, or both');
  if (t) {
    if (!/^[A-Za-z_]\w*$/.test(t.var || '')) errs.push(`time.var '${t.var}' must be a plain variable name (no $)`);
    if (!(Number(t.start) > 0)) errs.push('time.start must be > 0');
    if (!t.expire) errs.push('time.expire must name the passage shown when time runs out');
  }
  const ids = new Set();
  for (const l of params?.locations || []) {
    if (!/^[A-Za-z_][\w-]*$/.test(l.id || '')) errs.push(`location id '${l.id}' must be a plain identifier`);
    if (ids.has(l.id)) errs.push(`location '${l.id}' is listed twice`);
    ids.add(l.id);
    if (!l.passage) errs.push(`location '${l.id}' needs a passage`);
    if (l.cost != null && !(Number(l.cost) >= 0)) errs.push(`location '${l.id}': cost must be >= 0`);
  }
  return errs;
}

export function normalize(params) {
  const t = params.time;
  return {
    time: t ? { var: t.var, start: Number(t.start), label: t.label || t.var, expire: t.expire, warn_at: t.warn_at ?? null, unit: t.unit || '' } : null,
    locations: (params.locations || []).map((l) => ({ id: l.id, passage: l.passage, label: l.label || l.id, cost: Number(l.cost || 0), requires: l.requires || null, locked_text: l.locked_text || '' })),
  };
}

export function variables(params) {
  const p = normalize(params);
  return p.time ? [{ name: p.time.var, init: p.time.start }] : [];
}

export function invariants(params) {
  const p = normalize(params);
  return p.time ? [{ var: p.time.var, min: 0, max: p.time.start, module: 'explore' }] : [];
}

/** Static links: the map links to every location; spending time can lead to the deadline passage. */
export function links(params) {
  const p = normalize(params);
  const out = [];
  if (p.locations.length) out.push({ macro: 'map_menu', targets: p.locations.map((l) => l.passage) });
  if (p.time) out.push({ macro: 'map_menu', targets: [p.time.expire] }, { macro: 'spend', targets: [p.time.expire] });
  return out;
}

export function lint(params, passages) {
  const p = normalize(params);
  const names = new Set(passages.map((x) => x.name));
  const errs = [];
  for (const l of p.locations) if (!names.has(l.passage)) errs.push({ passage: null, message: `location '${l.id}' points at missing passage '${l.passage}' (module explore)` });
  if (p.time && !names.has(p.time.expire)) errs.push({ passage: null, message: `time.expire passage '${p.time.expire}' does not exist (module explore)` });
  for (const ps of passages) {
    for (const m of ps.text.matchAll(/<<spend\s+([^>]*)>>/g)) if (!/^-?\d+(\.\d+)?$/.test(m[1].trim()) && !/^[$_]/.test(m[1].trim())) errs.push({ passage: ps.name, message: `<<spend ${m[1].trim()}>>: expected a number (module explore)` });
    if (!p.time && /<<spend\b/.test(ps.text)) errs.push({ passage: ps.name, message: '<<spend>> used but the explore module has no time budget (module explore)' });
  }
  return errs;
}
