/* Story Forge module: explore (instance __MODULE_ID__) */
(function () {
  'use strict';
  var F = setup.forge;
  var cfg = F.modules['__MODULE_ID__'];
  var X = (F.explore = F.explore || { cfg: cfg });
  X.cfg = cfg;

  function time() { return cfg.time ? Number(State.variables[cfg.time.var]) || 0 : Infinity; }

  X.spend = function (n) {
    if (!cfg.time) throw new Error('<<spend>>: the explore module has no time budget');
    var before = time();
    var after = Math.max(0, before - Number(n));
    State.variables[cfg.time.var] = after;
    /* The move that used up the last of the time still happens; the deadline applies after it. */
    if (after <= 0 && before > 0) X.zeroTurn = window.__forgeTurn;
    if (F.toast && after !== before) {
      var warn = cfg.time.warn_at !== null && after <= cfg.time.warn_at && after > 0;
      F.toast((after > 0 ? after + (cfg.time.unit ? ' ' + cfg.time.unit : '') + ' left' : 'Out of time') + (warn ? '!' : ''), warn || after === 0 ? 'down' : '');
    }
    return after;
  };

  X.expired = function () { return !!cfg.time && time() <= 0; };

  X.locations = function () {
    var here = State.passage;
    return cfg.locations.filter(function (l) { return l.passage !== here; }).map(function (l) {
      var ok = true;
      if (l.requires) {
        try { ok = !!Scripting.evalTwineScript(l.requires); } catch (e) { ok = false; }
      }
      var affordable = !cfg.time || l.cost <= time();
      return { id: l.id, passage: l.passage, label: l.label, cost: l.cost, open: ok && affordable, why: !ok ? (l.locked_text || 'Locked') : !affordable ? 'Not enough time' : '', visited: visited(l.passage) > 0 };
    });
  };

  /* When the time is gone, the next navigation goes to the deadline passage. */
  if (cfg.time) {
    var prev = Config.navigation.override;
    Config.navigation.override = function (dest) {
      var r = typeof prev === 'function' ? prev(dest) : undefined;
      if (r) return r;
      if (!X.expired() || dest === cfg.time.expire) return undefined;
      /* Re-rendering the current passage (Engine.show after loading a save) is not a move. */
      if (dest === State.passage) return undefined;
      if (X.zeroTurn === window.__forgeTurn) return undefined;
      var p = Story.has(dest) ? Story.get(dest) : null;
      if (p && p.tags.indexOf('ending') >= 0) return undefined;
      return cfg.time.expire;
    };
    if (F.captionWidgets.indexOf('time_panel') < 0) F.captionWidgets.push('time_panel');
  }

  if (!Macro.has('map_menu')) {
    Macro.add('map_menu', {
      handler: function () {
        var $ul = $('<ul class="forge-map"></ul>');
        X.locations().forEach(function (l) {
          var $li = $('<li></li>').toggleClass('forge-map-visited', l.visited).appendTo($ul);
          var text = l.label + (cfg.time && l.cost ? ' (' + l.cost + (cfg.time.unit ? ' ' + cfg.time.unit : '') + ')' : '');
          if (l.open) {
            $('<a class="link-internal" tabindex="0"></a>').attr('data-passage', l.passage).text(text)
              .ariaClick({ one: true }, function () { if (cfg.time && l.cost) X.spend(l.cost); Engine.play(l.passage); })
              .appendTo($li);
          } else {
            $('<span class="forge-map-locked"></span>').text(text).attr('title', l.why).appendTo($li);
            $('<span class="forge-map-why"></span>').text(' - ' + l.why).appendTo($li);
          }
          if (l.visited) $('<span class="forge-map-mark" aria-label="visited"> ✓</span>').appendTo($li);
        });
        if (window.__forgeQA && cfg.time) {
          $('<li class="forge-mg-qa"></li>').append($('<a class="link-internal" tabindex="0">[QA] run out of time</a>').attr('data-passage', cfg.time.expire)
            .ariaClick({ one: true }, function () { State.variables[cfg.time.var] = 0; Engine.play(cfg.time.expire); })).appendTo($ul);
        }
        $ul.appendTo(this.output);
      }
    });
  }
})();
