/* Story Forge runtime - dev-build debug overlay (excluded from release builds) */
(function () {
  'use strict';
  var F = (setup.forge = setup.forge || {});
  var ifid = (F.build && F.build.ifid) || 'forge';
  var covKey = 'forge-coverage-' + ifid;

  /* (The QA turn counter, window.__forgeTurn, lives in core.js so release builds can be tested too.) */
  $(document).on(':passageend', function () {
    var cov = loadCov();
    cov[State.passage] = (cov[State.passage] || 0) + 1;
    try { localStorage.setItem(covKey, JSON.stringify(cov)); } catch (e) { /* ignore */ }
    render();
  });

  function loadCov() {
    try { return JSON.parse(localStorage.getItem(covKey) || '{}'); } catch (e) { return {}; }
  }
  function allPassages() {
    var fn = Story.filter || Story.lookupWith;
    return fn.call(Story, function (p) {
      var t = p.tags || [];
      return t.indexOf('widget') < 0 && t.indexOf('debug') < 0 && !/^Story|^Passage/.test(p.name || p.title);
    }).map(function (p) { return p.name || p.title; }).sort();
  }

  var $btn = $('<button id="forge-debug-toggle" title="Forge debug (dev build)" aria-label="Forge debug">⚙</button>');
  var $panel = $('<div id="forge-debug" hidden></div>');
  $btn.on('click', function () { $panel.prop('hidden', !$panel.prop('hidden')); render(); });

  function render() {
    if ($panel.prop('hidden')) return;
    var names = allPassages();
    var cov = loadCov();
    var visited = names.filter(function (n) { return cov[n]; }).length;
    var media = (F.mediaLog || []).map(function (m) { return '@' + m.kind + ' ' + m.args.join(' '); });
    $panel.empty().append(
      $('<h3>Forge debug</h3>'),
      $('<div class="fd-row"></div>').append('<b>Passage:</b> ', $('<code></code>').text(State.passage), F.scene ? ' <span class="fd-muted">(scene ' + F.scene + ')</span>' : ''),
      $('<div class="fd-row"></div>').append(
        $('<select id="fd-jump"></select>').append(names.map(function (n) { return $('<option></option>').val(n).text(n).prop('selected', n === State.passage); })),
        $('<button>Go</button>').on('click', function () { Engine.play($('#fd-jump').val()); })
      ),
      $('<div class="fd-row"></div>').append('<b>Coverage:</b> ' + visited + ' / ' + names.length + ' passages ',
        $('<button>Unvisited</button>').on('click', function () {
          var un = names.filter(function (n) { return !cov[n]; });
          $('#fd-unvisited').text(un.join('\n') || '(none)').prop('hidden', false);
        }),
        $('<button>Reset</button>').on('click', function () { localStorage.removeItem(covKey); render(); })
      ),
      $('<pre id="fd-unvisited" hidden></pre>'),
      $('<div class="fd-row"><b>Media this passage:</b> ' + (media.length ? '' : '<span class="fd-muted">none</span>') + '</div>').append(
        media.length ? $('<code></code>').text(media.join('  ')) : ''
      ),
      $('<details><summary>Variables</summary></details>').append(
        $('<textarea id="fd-vars" rows="8" spellcheck="false"></textarea>').val(JSON.stringify(State.variables, null, 1)),
        $('<button>Apply &amp; re-render</button>').on('click', function () {
          try { Object.assign(State.variables, JSON.parse($('#fd-vars').val())); Engine.show(); }
          catch (e) { alert('Invalid JSON: ' + e.message); }
        })
      ),
      $('<details open><summary>Send feedback</summary></details>').append(
        $('<textarea id="fd-note" rows="3" placeholder="What should change here?"></textarea>'),
        $('<button>Send</button>').on('click', sendFeedback),
        $('<div id="fd-status" class="fd-muted"></div>')
      )
    );
  }

  function sendFeedback() {
    var note = $('#fd-note').val().trim();
    if (!note) return;
    var payload = { note: note, passage: State.passage, scene: F.scene, variables: State.variables, at: new Date().toISOString() };
    fetch('/__forge/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { $('#fd-note').val(''); $('#fd-status').text('Logged as ' + j.id); })
      .catch(function () {
        var text = JSON.stringify(payload);
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
          function () { $('#fd-status').text('No playtest server - feedback copied to clipboard. Paste it to Claude.'); },
          function () { $('#fd-status').text('No playtest server. Copy this: ' + text); }
        );
      });
  }

  $(document).one(':storyready', function () { $('body').append($btn, $panel); });
})();
