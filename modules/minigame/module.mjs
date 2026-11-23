// Minigames loop module: small turn-based challenges embedded in a passage. Each one ends by
// sending the player to a success or a failure passage, so the story graph stays explicit.
//
// loops.yaml entry:
//   - id: trials
//     type: minigame
//     params:
//       dice: 20                       # skill checks roll 1..dice (+ the stat's value)
//       show_odds: true                # show the chance of success before rolling
//       locks:
//         - { id: vault, code: "1847", hint: "The year on the lighthouse plaque.", attempts: 3 }
//
// Script usage (raw lines in a scene, or a choice's do-block):
//   <<skill_check "Climb the slick ladder" "grit" 12 "lamp_room" "ladder_fall">>
//       label, stat variable (or "" for none), difficulty, success passage, failure passage
//   <<codelock "vault" "vault_open" "vault_stuck">>
//       lock id, success passage, failure passage (after the attempts run out, or "Step away")
//
// Automated QA can't roll dice or type codes, so in QA runs (window.__forgeQA) each minigame
// also shows direct links to both outcomes.

export const description = 'Embedded turn-based challenges: dice skill checks against a stat, and code locks with limited attempts.';

export const usage = `<<skill_check "label" "statVar" dc "success" "failure">>   <<codelock "lockId" "success" "failure">>`;

export function validate(params) {
  const errs = [];
  if (params?.dice != null && !(Number.isInteger(params.dice) && params.dice >= 2)) errs.push('dice must be an integer >= 2');
  const ids = new Set();
  for (const l of params?.locks || []) {
    if (!/^[A-Za-z_][\w-]*$/.test(l.id || '')) errs.push(`lock id '${l.id}' must be a plain identifier`);
    if (ids.has(l.id)) errs.push(`lock '${l.id}' is listed twice`);
    ids.add(l.id);
    if (l.code === undefined || l.code === null || String(l.code) === '') errs.push(`lock '${l.id}' needs a code`);
    if (l.attempts != null && !(Number.isInteger(l.attempts) && l.attempts >= 1)) errs.push(`lock '${l.id}': attempts must be >= 1`);
  }
  return errs;
}

export function normalize(params = {}) {
  return {
    dice: params.dice || 20,
    show_odds: params.show_odds !== false,
    locks: (params.locks || []).map((l) => ({ id: l.id, code: String(l.code), hint: l.hint || '', attempts: l.attempts ?? 3, case_sensitive: !!l.case_sensitive })),
  };
}

export function variables() {
  return [];
}

export function invariants() {
  return [];
}

/** Passage arguments of this module's macros (0-based), for static link analysis. */
export function links() {
  return [
    { macro: 'skill_check', args: [3, 4] },
    { macro: 'codelock', args: [1, 2] },
  ];
}

const STR = `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`;

export function lint(params, passages) {
  const p = normalize(params);
  const locks = new Set(p.locks.map((l) => l.id));
  const errs = [];
  const lockRe = new RegExp(`<<codelock\\s+${STR}`, 'g');
  const checkRe = /<<skill_check\b([^>]*)>>/g;
  for (const ps of passages) {
    let m;
    lockRe.lastIndex = 0;
    while ((m = lockRe.exec(ps.text))) if (!locks.has(m[1].slice(1, -1))) errs.push({ passage: ps.name, message: `<<codelock>> unknown lock '${m[1].slice(1, -1)}' (module minigame)` });
    checkRe.lastIndex = 0;
    while ((m = checkRe.exec(ps.text))) {
      const parts = m[1].match(new RegExp(`${STR}|-?\\d+`, 'g')) || [];
      if (parts.length !== 5) errs.push({ passage: ps.name, message: `<<skill_check>> needs 5 arguments: label, stat, difficulty, success, failure (module minigame)` });
      else if (!/^-?\d+$/.test(parts[2])) errs.push({ passage: ps.name, message: '<<skill_check>> difficulty must be a number (module minigame)' });
    }
  }
  return errs;
}
