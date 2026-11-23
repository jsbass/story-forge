/* Story Forge module: stats (instance __MODULE_ID__) */
(function () {
  'use strict';
  var F = setup.forge;
  var cfg = F.modules['__MODULE_ID__'];
  var S = (F.stats = F.stats || {
    defs: {},
    order: [],
    change: function (name, delta) {
      var d = S.defs[name];
      if (!d) throw new Error('<<stat>>: unknown stat "' + name + '"');
      var before = Number(State.variables[name]) || 0;
      var after = Math.max(d.min, Math.min(d.max, before + Number(delta)));
      State.variables[name] = after;
      var diff = after - before;
      if (diff !== 0 && d.notify && F.toast) F.toast((diff > 0 ? '+' : '') + diff + ' ' + d.label, diff > 0 ? 'up' : 'down');
      return after;
    },
    visible: function () {
      return S.order.map(function (n) { return S.defs[n]; }).filter(function (d) { return d.visible; });
    }
  });
  cfg.stats.forEach(function (s) {
    if (!S.defs[s.var]) S.order.push(s.var);
    S.defs[s.var] = s;
  });
  if (F.captionWidgets.indexOf('stats_panel') < 0) F.captionWidgets.push('stats_panel');
})();
