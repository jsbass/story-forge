/* Twine Forge module: minigame (instance __MODULE_ID__) */
(function () {
  'use strict';
  var F = setup.forge;
  var cfg = F.modules['__MODULE_ID__'];
  var locks = {};
  cfg.locks.forEach(function (l) { locks[l.id] = l; });

  /* A normal SugarCube passage link (the QA walker follows these). */
  function link(text, passage) {
    return $('<a class="link-internal forge-mg-go" tabindex="0"></a>').attr('data-passage', passage).text(text)
      .ariaClick({ one: true }, function () { Engine.play(passage); });
  }
  function qaLinks($box, ok, fail) {
    if (!window.__forgeQA) return;
    $('<div class="forge-mg-qa"></div>').append(link('[QA] success', ok), ' ', link('[QA] failure', fail)).appendTo($box);
  }

  var MG = (F.minigame = F.minigame || {});

  /* Chance (0..1) that 1..dice + bonus >= dc. */
  MG.chance = function (dice, bonus, dc) {
    var need = dc - bonus;
    if (need <= 1) return 1;
    if (need > dice) return 0;
    return (dice - need + 1) / dice;
  };

  MG.skillCheck = function (out, label, stat, dc, ok, fail) {
    var bonus = stat ? Number(State.variables[stat]) || 0 : 0;
    var dice = cfg.dice;
    var $box = $('<div class="forge-mg forge-mg-check"></div>');
    $('<div class="forge-mg-title"></div>').text(label).appendTo($box);
    var detail = 'd' + dice + (stat ? ' + ' + stat + ' (' + bonus + ')' : '') + ' vs ' + dc;
    if (cfg.show_odds) detail += ' · ' + Math.round(MG.chance(dice, bonus, dc) * 100) + '% chance';
    $('<div class="forge-mg-detail"></div>').text(detail).appendTo($box);
    var $btn = $('<button class="forge-mg-roll"></button>').text('Roll').appendTo($box);
    $btn.ariaClick({ one: true }, function () {
      var roll = random(1, dice);
      var total = roll + bonus;
      var pass = total >= dc;
      $btn.remove();
      $('<div class="forge-mg-result"></div>').addClass(pass ? 'forge-mg-pass' : 'forge-mg-fail')
        .text('Rolled ' + roll + (bonus ? ' + ' + bonus + ' = ' + total : '') + ' - ' + (pass ? 'success' : 'failure'))
        .appendTo($box);
      link('Continue', pass ? ok : fail).appendTo($box).focus();
    });
    qaLinks($box, ok, fail);
    $box.appendTo(out);
  };

  MG.codelock = function (out, id, ok, fail) {
    var lock = locks[id];
    if (!lock) throw new Error('<<codelock>>: unknown lock "' + id + '"');
    var left = lock.attempts;
    var norm = function (s) { s = String(s).trim(); return lock.case_sensitive ? s : s.toLowerCase(); };
    var $box = $('<div class="forge-mg forge-mg-lock"></div>');
    if (lock.hint) $('<div class="forge-mg-detail"></div>').text(lock.hint).appendTo($box);
    var $row = $('<div class="forge-mg-row"></div>').appendTo($box);
    var $in = $('<input type="text" class="forge-mg-input" autocomplete="off" aria-label="Code">').appendTo($row);
    var $try = $('<button class="forge-mg-try"></button>').text('Try').appendTo($row);
    var $msg = $('<div class="forge-mg-result" aria-live="polite"></div>').appendTo($box);
    var $away = link('Step away', fail).appendTo($box);
    function attempt() {
      if (norm($in.val()) === norm(lock.code)) {
        $row.remove(); $away.remove();
        $msg.attr('class', 'forge-mg-result forge-mg-pass').text('It opens.');
        link('Continue', ok).appendTo($box).focus();
        return;
      }
      left -= 1;
      if (left <= 0) {
        $row.remove(); $away.remove();
        $msg.attr('class', 'forge-mg-result forge-mg-fail').text('It will not open.');
        link('Continue', fail).appendTo($box).focus();
      } else {
        $msg.attr('class', 'forge-mg-result').text('Wrong. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.');
        $in.val('').focus();
      }
    }
    $try.ariaClick(attempt);
    $in.on('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); attempt(); } });
    qaLinks($box, ok, fail);
    $box.appendTo(out);
  };

  if (!Macro.has('skill_check')) {
    Macro.add('skill_check', {
      handler: function () {
        if (this.args.length < 5) return this.error('<<skill_check>> needs: label, stat, difficulty, success passage, failure passage');
        MG.skillCheck(this.output, this.args[0], this.args[1], Number(this.args[2]), this.args[3], this.args[4]);
      }
    });
    Macro.add('codelock', {
      handler: function () {
        if (this.args.length < 3) return this.error('<<codelock>> needs: lock id, success passage, failure passage');
        try { MG.codelock(this.output, this.args[0], this.args[1], this.args[2]); } catch (e) { return this.error(e.message); }
      }
    });
  }
})();
