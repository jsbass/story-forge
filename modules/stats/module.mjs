// Stats / relationships loop module: named numeric meters with clamping,
// toasts, a sidebar panel, and QA invariants.
//
// loops.yaml entry:
//   - id: relationships
//     type: stats
//     params:
//       stats:
//         - { var: mara_aff, label: Mara, min: 0, max: 10, init: 3, visible: true, notify: true }
//
// Script usage:   <<stat "mara_aff" 2>>   (clamped; shows a toast)
//                 ?? if $mara_aff >= 5     (read like any variable)

export const description = 'Named meters (relationships, reputation, resources) that clamp to a range and gate branches.';

export const usage = `<<stat "var" +2>>   conditions: $mara_aff >= 5`;

export function validate(params) {
  const errs = [];
  if (!Array.isArray(params?.stats) || !params.stats.length) errs.push('params.stats must be a non-empty list');
  for (const s of params?.stats || []) {
    if (!/^[A-Za-z_]\w*$/.test(s.var || '')) errs.push(`stat var '${s.var}' must be a plain variable name (no $)`);
    if (s.min != null && s.max != null && s.min > s.max) errs.push(`stat ${s.var}: min > max`);
  }
  return errs;
}

export function normalize(params) {
  return {
    stats: params.stats.map((s) => ({
      var: s.var,
      label: s.label || s.var,
      min: s.min ?? 0,
      max: s.max ?? 10,
      init: s.init ?? s.min ?? 0,
      visible: s.visible !== false,
      notify: s.notify !== false,
    })),
  };
}

/** Variables this module owns: [{name, init}] */
export function variables(params) {
  return normalize(params).stats.map((s) => ({ name: s.var, init: s.init }));
}

/** QA invariants checked after every step of an automated playthrough. */
export function invariants(params) {
  return normalize(params).stats.map((s) => ({ var: s.var, min: s.min, max: s.max, module: 'stats' }));
}
