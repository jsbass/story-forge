/* Twine Forge runtime - core (included in every build) */
(function () {
  'use strict';
  var F = (setup.forge = setup.forge || {});
  F.characters = F.characters || {};
  F.modules = F.modules || {};
  F.invariants = F.invariants || [];
  F.captionWidgets = F.captionWidgets || [];
  F.mediaLog = [];
  F.scene = null;

  Config.history.maxStates = (F.build && F.build.historyMaxStates) || 20;

  /* Media hook. Phase 1 records requests; the Phase 2 asset runtime renders them. */
  F.media = function (args) {
    args = Array.prototype.slice.call(args);
    var entry = { kind: args[0], args: args.slice(1), passage: State.passage };
    F.mediaLog.push(entry);
    document.documentElement.setAttribute('data-forge-' + entry.kind, entry.args.join(' '));
    $(document).trigger({ type: ':forge-media', forge: entry });
  };

  F.reachedEnding = function (id) {
    $(document).trigger({ type: ':forge-ending', forge: { id: id, passage: State.passage } });
  };

  $(document).on(':passagestart', function () {
    F.mediaLog = [];
  });

  /* Accessibility settings */
  function applyScale() {
    document.documentElement.style.setProperty('--forge-text-scale', String((settings.textScale || 100) / 100));
  }
  function applyMotion() {
    document.documentElement.classList.toggle('forge-reduced-motion', !!settings.reducedMotion);
  }
  Setting.addRange('textScale', { label: 'Text size (%)', min: 80, max: 150, step: 10, default: 100, onInit: applyScale, onChange: applyScale });
  Setting.addToggle('reducedMotion', { label: 'Reduce motion', default: false, onInit: applyMotion, onChange: applyMotion });

  /* Small toast helper modules can use for feedback (e.g. "+2 Mara"). */
  F.toast = function (text, kind) {
    var $t = $('<div class="forge-toast"></div>').addClass(kind ? 'forge-toast-' + kind : '').text(text);
    $('body').append($t);
    setTimeout(function () { $t.addClass('forge-toast-out'); }, 1600);
    setTimeout(function () { $t.remove(); }, 2200);
  };
})();
