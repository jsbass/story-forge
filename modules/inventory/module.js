/* Twine Forge module: inventory (instance __MODULE_ID__) */
(function () {
  'use strict';
  var F = setup.forge;
  var cfg = F.modules['__MODULE_ID__'];
  var byId = {};
  cfg.items.forEach(function (i) { byId[i.id] = i; });

  function list() {
    var v = State.variables[cfg.var];
    if (!Array.isArray(v)) { v = []; State.variables[cfg.var] = v; }
    return v;
  }
  function label(id) { return byId[id] ? byId[id].label : id; }
  function known(id, macro) {
    if (!byId[id]) throw new Error('<<' + macro + '>>: unknown item "' + id + '"');
  }

  var Inv = {
    cfg: cfg,
    has: function (id) { return list().indexOf(id) >= 0; },
    items: function () { return list().map(function (id) { return byId[id] || { id: id, label: id, desc: '' }; }); },
    give: function (id) {
      known(id, 'give');
      var l = list();
      if (l.indexOf(id) >= 0) return false;
      if (cfg.capacity !== null && l.length >= cfg.capacity) {
        if (F.toast) F.toast('No room for ' + label(id), 'down');
        return false;
      }
      l.push(id);
      if (F.toast) F.toast('+ ' + label(id), 'up');
      return true;
    },
    take: function (id) {
      known(id, 'take');
      var l = list(), i = l.indexOf(id);
      if (i < 0) return false;
      l.splice(i, 1);
      if (F.toast) F.toast('- ' + label(id), 'down');
      return true;
    },
    recipe: function (a, b) {
      for (var i = 0; i < cfg.recipes.length; i++) {
        var r = cfg.recipes[i];
        if (r.use.indexOf(a) >= 0 && r.use.indexOf(b) >= 0 && a !== b) return r;
      }
      return null;
    },
    combine: function (a, b) {
      var r = Inv.recipe(a, b);
      if (!r || !Inv.has(a) || !Inv.has(b)) return false;
      if (!r.keep) { Inv.take(a); Inv.take(b); }
      Inv.give(r.makes);
      if (r.message && F.toast) F.toast(r.message);
      return true;
    },
    /* Recipes the player can make right now (shown as buttons in the sidebar). */
    available: function () {
      return cfg.recipes.filter(function (r) { return Inv.has(r.use[0]) && Inv.has(r.use[1]) && !Inv.has(r.makes); });
    }
  };
  /* One inventory per game is the normal case; extra instances are reachable by id. */
  F.inventories = F.inventories || {};
  F.inventories['__MODULE_ID__'] = Inv;
  if (!F.inv) F.inv = Inv;
  if (F.captionWidgets.indexOf('inventory_panel') < 0) F.captionWidgets.push('inventory_panel');
})();
