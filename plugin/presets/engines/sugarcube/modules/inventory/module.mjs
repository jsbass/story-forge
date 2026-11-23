// Inventory & puzzles loop module: items the player carries, combine recipes, and item-gated choices.
//
// loops.yaml entry:
//   - id: pack
//     type: inventory
//     params:
//       var: inv                      # story variable (array of item ids), default "inv"
//       capacity: 6                   # optional limit
//       start: [lantern]              # items at the start
//       items:
//         - { id: lantern, label: Storm lantern, desc: "Dented brass, half full of oil." }
//         - { id: rope, label: Coil of rope }
//         - { id: hook, label: Iron hook }
//         - { id: grapple, label: Grappling line }
//       recipes:
//         - { use: [rope, hook], makes: grapple, message: "You knot the rope to the hook." }
//
// Script usage:   <<give "rope">>   <<take "rope">>   <<combine "rope" "hook">>
//                 * [Climb the cliff] -> cliff_top {requires $inv.includes("grapple")}
//                 ?? if $inv.includes("lantern")
// The sidebar shows the inventory; recipes the player can make appear as "Combine" buttons there.

export const description = 'Items the player carries (with an optional capacity), combine recipes, and item-gated choices.';

export const usage = `<<give "id">>  <<take "id">>  <<combine "a" "b">>   conditions: $inv.includes("id")`;

const ID = /^[A-Za-z_][\w-]*$/;

export function validate(params) {
  const errs = [];
  const items = params?.items;
  if (!Array.isArray(items) || !items.length) errs.push('params.items must be a non-empty list');
  const ids = new Set();
  for (const it of items || []) {
    if (!ID.test(it.id || '')) errs.push(`item id '${it.id}' must be a plain identifier`);
    if (ids.has(it.id)) errs.push(`item '${it.id}' is listed twice`);
    ids.add(it.id);
  }
  if (params?.var && !/^[A-Za-z_]\w*$/.test(params.var)) errs.push(`var '${params.var}' must be a plain variable name (no $)`);
  for (const s of params?.start || []) if (!ids.has(s)) errs.push(`start item '${s}' is not in items`);
  for (const r of params?.recipes || []) {
    if (!Array.isArray(r.use) || r.use.length !== 2) errs.push(`recipe ${JSON.stringify(r)}: 'use' needs exactly two item ids`);
    for (const u of [...(r.use || []), r.makes]) if (!ids.has(u)) errs.push(`recipe uses unknown item '${u}'`);
  }
  if (params?.capacity != null && (params.start || []).length > params.capacity) errs.push('more start items than capacity');
  return errs;
}

export function normalize(params) {
  return {
    var: params.var || 'inv',
    capacity: params.capacity ?? null,
    start: params.start || [],
    items: params.items.map((i) => ({ id: i.id, label: i.label || i.id, desc: i.desc || '' })),
    recipes: (params.recipes || []).map((r) => ({ use: r.use, makes: r.makes, keep: !!r.keep, message: r.message || '' })),
  };
}

export function variables(params) {
  const p = normalize(params);
  return [{ name: p.var, init: p.start }];
}

/** Checked by the QA walker after every step: only known items, never over capacity. */
export function invariants(params) {
  const p = normalize(params);
  return [{ var: p.var, allowed: p.items.map((i) => i.id), maxItems: p.capacity, module: 'inventory' }];
}

const STR = `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`;
const unq = (s) => s.slice(1, -1);

/** Build-time check: every item id used in a macro or $inv.includes() exists. */
export function lint(params, passages) {
  const p = normalize(params);
  const ids = new Set(p.items.map((i) => i.id));
  const errs = [];
  const macro = new RegExp(`<<(give|take|combine)((?:\\s+${STR})+)\\s*>>`, 'g');
  const includes = new RegExp(`\\$${p.var}\\.includes\\(\\s*${STR}\\s*\\)`, 'g');
  for (const ps of passages) {
    let m;
    macro.lastIndex = 0;
    while ((m = macro.exec(ps.text))) {
      const args = [...m[2].matchAll(new RegExp(STR, 'g'))].map((x) => unq(x[1]));
      for (const a of args) if (!ids.has(a)) errs.push({ passage: ps.name, message: `<<${m[1]}>> unknown item '${a}' (module inventory)` });
      if (m[1] === 'combine' && !p.recipes.some((r) => r.use.includes(args[0]) && r.use.includes(args[1]))) errs.push({ passage: ps.name, message: `<<combine "${args[0]}" "${args[1]}">> has no recipe (module inventory)` });
    }
    includes.lastIndex = 0;
    while ((m = includes.exec(ps.text))) if (!ids.has(unq(m[1]))) errs.push({ passage: ps.name, message: `$${p.var}.includes("${unq(m[1])}"): unknown item (module inventory)` });
  }
  return errs;
}
