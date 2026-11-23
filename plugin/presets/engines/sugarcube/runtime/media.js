/* Story Forge runtime - media: backgrounds, portraits, music/ambience loops, sfx, voice, video.
 *
 * Semantics (match skills/forge-script/reference.md):
 *   @bg id          background persists until the next @bg (saved with the game)
 *   @music id       loops until the next @music; "@music none" stops it (same for @ambience)
 *   @sfx id         one-shot sound
 *   @voice id       one-shot on the voice channel (a new line stops the previous one)
 *   @portrait c e   shown inline where the cue appears, for that passage only
 *   @video id       shown inline, muted loop
 * Missing assets: dev builds show a small "pending" chip; release builds skip silently.
 */
(function () {
  'use strict';
  var F = setup.forge;
  F.assets = F.assets || {};
  var dev = !!(F.build && F.build.mode === 'dev');
  var channels = { music: null, ambience: null, voice: null };
  var pending = [];

  Setting.addRange('musicVolume', { label: 'Music volume', min: 0, max: 100, step: 5, default: 60, onChange: applyVolumes });
  Setting.addRange('sfxVolume', { label: 'Sound volume', min: 0, max: 100, step: 5, default: 80, onChange: applyVolumes });

  /* Optimized release builds add smaller image variants, video posters, and a per-passage image list
     (used to prefetch the images the next choices will show). */
  F.assetsSmall = F.assetsSmall || {};
  F.posters = F.posters || {};
  F.mediaByPassage = F.mediaByPassage || {};
  var conn = navigator.connection || {};
  var small = !!conn.saveData || Math.max(window.innerWidth || 0, window.innerHeight || 0) <= 1024;

  function url(kind, id) {
    var k = kind + ':' + id;
    return (small && F.assetsSmall[k]) || F.assets[k] || null;
  }

  var prefetched = {};
  function prefetchNext() {
    var n = 0;
    $('#passages a[data-passage]').each(function () {
      var keys = F.mediaByPassage[$(this).attr('data-passage')] || [];
      for (var i = 0; i < keys.length && n < 6; i++) {
        var parts = keys[i].split(':'), u = url(parts[0], parts.slice(1).join(':'));
        if (u && !prefetched[u]) { prefetched[u] = true; n++; new Image().src = u; }
      }
    });
  }
  function vol(kind) {
    var s = kind === 'music' ? settings.musicVolume : settings.sfxVolume;
    return (typeof s === 'number' ? s : kind === 'music' ? 60 : 80) / 100;
  }
  function state() {
    var v = State.variables;
    if (!v.forge_media || typeof v.forge_media !== 'object') v.forge_media = {};
    return v.forge_media;
  }
  function chip(kind, args) {
    return dev ? '<span class="forge-pending" title="Asset not generated/approved yet">' + kind + ' ' + args.join(' ') + '</span>' : '';
  }
  function tryPlay(el) {
    var p = el.play();
    if (p && p.catch) p.catch(function () { pending.push(el); });
  }
  /* Browsers block audio until the first click/tap: retry then. */
  $(document).on('click keydown touchstart', function () {
    var list = pending; pending = [];
    list.forEach(function (el) { tryPlay(el); });
  });

  function fadeTo(el, target, ms, done) {
    var start = el.volume, t0 = Date.now();
    var reduced = settings.reducedMotion;
    if (reduced || ms <= 0) { el.volume = target; if (done) done(); return; }
    var iv = setInterval(function () {
      var k = Math.min(1, (Date.now() - t0) / ms);
      el.volume = Math.max(0, Math.min(1, start + (target - start) * k));
      if (k >= 1) { clearInterval(iv); if (done) done(); }
    }, 50);
  }

  function playLoop(channel, id) {
    var cur = channels[channel];
    if (cur && cur.id === id) return;
    if (cur) { var old = cur.el; fadeTo(old, 0, 800, function () { old.pause(); }); channels[channel] = null; }
    if (!id) return;
    var u = url(channel, id);
    if (!u) return;
    var el = new Audio(u);
    el.loop = true;
    el.volume = 0;
    channels[channel] = { id: id, el: el };
    tryPlay(el);
    fadeTo(el, channel === 'music' ? vol('music') : vol('sfx'), 1200);
  }

  function playOnce(kind, id) {
    var u = url(kind, id);
    if (!u) return;
    if (kind === 'voice' && channels.voice) channels.voice.el.pause();
    var el = new Audio(u);
    el.volume = vol('sfx');
    if (kind === 'voice') channels.voice = { id: id, el: el };
    tryPlay(el);
  }

  function applyBg(id) {
    var $bg = $('#forge-bg');
    var u = id && url('bg', id);
    if (u) $bg.css('background-image', 'url("' + u + '")').addClass('forge-bg-on');
    else $bg.css('background-image', '').removeClass('forge-bg-on');
  }

  function applyVolumes() {
    if (channels.music) channels.music.el.volume = vol('music');
    if (channels.ambience) channels.ambience.el.volume = vol('sfx');
  }

  /* Re-apply persistent media from saved state (after load, restart, or history navigation). */
  function applyPersistent() {
    var s = state();
    applyBg(s.bg || null);
    playLoop('music', s.music || null);
    playLoop('ambience', s.ambience || null);
  }

  /* Called by <<forge_media>>; returns inline HTML (portraits, video, dev chips) or ''. */
  F.mediaRender = function (entry) {
    var kind = entry.kind, args = entry.args, id = kind === 'portrait' ? args[0] + '.' + (args[1] || 'neutral') : args[0];
    var s = state();
    switch (kind) {
      case 'bg':
        s.bg = id; applyBg(id);
        return url('bg', id) ? '' : chip('bg', args);
      case 'music':
      case 'ambience':
        s[kind] = id === 'none' ? null : id;
        playLoop(kind, s[kind]);
        return id === 'none' || url(kind, id) ? '' : chip(kind, args);
      case 'sfx':
      case 'voice':
        playOnce(kind, id);
        return url(kind, id) ? '' : chip(kind, args);
      case 'portrait': {
        var p = url('portrait', id);
        return p ? '<img class="forge-portrait" alt="" src="' + p + '" data-character="' + args[0] + '">' : chip('portrait', args);
      }
      case 'video': {
        var v = url('video', id);
        var poster = F.posters['video:' + id];
        return v ? '<video class="forge-video" src="' + v + '"' + (poster ? ' poster="' + poster + '"' : '') + ' preload="metadata" autoplay muted loop playsinline></video>' : chip('video', args);
      }
    }
    return '';
  };

  $(document).one(':storyready', function () {
    $('body').prepend('<div id="forge-bg" aria-hidden="true"></div>');
    applyPersistent();
  });
  $(document).on(':passagestart', function () {
    if (State.passage && !State.variables.forge_media) state();
  });
  $(document).on(':passagedisplay', function () {
    applyPersistent();
    setTimeout(prefetchNext, 300);
  });
})();
