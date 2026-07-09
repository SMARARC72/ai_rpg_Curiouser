/*
 * Curiouser Director — client. Feeds the comic mod from play.
 * "The comic is the output": panels are gated, player-chosen beats (Snap
 * Panel), with auto-capture of the big stakes moments (Episode wraps,
 * Cancellations). Compose pages and export the chapter from a Comic panel.
 * Auto-injected into the chat page. Pure client add-on.
 */
(function () {
  'use strict';
  var COMIC = '/api/mods/curiouser-comic';
  var ECON = '/api/mods/curiouser-economy';
  var MIN_GAP_MS = 1500;
  var busy = false, lastAt = 0;
  var lastEpisode = null, lastCancelled = null;

  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return null; }); }).catch(function () { return null; });
  }
  function get(url) { return fetch(url).then(function (r) { return r.json().catch(function () { return null; }); }).catch(function () { return null; }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function chatLog() { return document.getElementById('chatLog'); }
  function toast(text) {
    var el = chatLog(); if (!el || !text) return;
    var w = document.createElement('div'); w.className = 'message ai-message director-beat';
    var s = document.createElement('div'); s.className = 'message-sender'; s.textContent = '🎬 The Edit';
    var b = document.createElement('div'); b.textContent = text;
    w.appendChild(s); w.appendChild(b); el.appendChild(w); el.scrollTop = el.scrollHeight;
  }
  function lastHostLine() {
    var nodes = document.querySelectorAll('.message.ai-message');
    for (var i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].classList.contains('director-beat')) continue;
      var body = nodes[i].querySelector('div:not(.message-sender):not(.message-timestamp):not(.message-actions)');
      var txt = ((body ? body.textContent : nodes[i].textContent) || '').trim();
      if (txt) return txt.slice(0, 220);
    }
    return 'A beat on Curiouser.';
  }
  function locationImageUrl() {
    var img = document.querySelector('#locationImage img, .location-image img, #chatPlayerPortraitImage');
    var src = img && (img.src || img.getAttribute('src'));
    if (src && src.indexOf('/generated-images/') >= 0) { try { return src.replace(location.origin, ''); } catch (e) { return src; } }
    return '';
  }

  function snap(auto, captionOverride) {
    return post(COMIC + '/panel', { caption: captionOverride || lastHostLine(), imageUrl: locationImageUrl() }).then(function (res) {
      if (res && res.success) { toast('📸 Panel captured' + (res.pendingCount ? ' (' + res.pendingCount + ' pending)' : '') + '. Compose a page from the 📖 Comic panel.'); if (isOpen()) refresh(); }
      else if (!auto && res && res.error) toast('📸 ' + res.error);
      return res;
    });
  }

  // ---- Comic viewer ----
  var overlay = null, bodyEl = null;
  function build() {
    overlay = document.createElement('div'); overlay.className = 'dr-backdrop';
    var modal = document.createElement('div'); modal.className = 'dr-modal';
    var header = document.createElement('div'); header.className = 'dr-header';
    var title = document.createElement('div'); title.className = 'dr-title'; title.textContent = '📖 Your Comic';
    var close = document.createElement('button'); close.className = 'dr-close'; close.type = 'button'; close.textContent = '✕';
    close.addEventListener('click', hide);
    header.appendChild(title); header.appendChild(close);

    var actions = document.createElement('div'); actions.className = 'dr-actions';
    var snapBtn = mkBtn('📸 Snap Panel', 'dr-primary', function () { snap(false); });
    var compBtn = mkBtn('🧩 Compose Page', '', function () { post(COMIC + '/page/compose').then(function (r) { if (r && r.success) toast('🧩 Page composed — ' + r.page.panelCount + ' panels.'); else if (r && r.error) toast('🧩 ' + r.error); refresh(); }); });
    var expBtn = mkBtn('📖 Export Chapter', '', function () { post(COMIC + '/chapter/export', { title: 'Curiouser — Chapter' }).then(function (r) { if (r && r.success && r.url) { toast('📖 Chapter exported — ' + r.pages + ' page(s).'); window.open(r.url, '_blank'); refresh(); } else if (r && r.error) toast('📖 ' + r.error); }); });
    actions.appendChild(snapBtn); actions.appendChild(compBtn); actions.appendChild(expBtn);

    bodyEl = document.createElement('div'); bodyEl.className = 'dr-body';
    modal.appendChild(header); modal.appendChild(actions); modal.appendChild(bodyEl); overlay.appendChild(modal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) hide(); });
    document.addEventListener('keydown', function (e) { if (overlay && overlay.style.display !== 'none' && e.key === 'Escape') hide(); });
    document.body.appendChild(overlay);
  }
  function mkBtn(label, cls, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'dr-btn ' + (cls || ''); b.textContent = label; b.addEventListener('click', fn); return b; }
  function refresh() {
    if (!bodyEl) return;
    get(COMIC + '/state').then(function (s) {
      if (!s || !s.success) { bodyEl.innerHTML = '<div class="dr-empty">Comic mod unavailable.</div>'; return; }
      var pending = (s.pendingBeats || []).length;
      var pages = s.pages || [];
      var html = '<div class="dr-status">' + pending + ' panel' + (pending === 1 ? '' : 's') + ' pending · ' + pages.length + ' page' + (pages.length === 1 ? '' : 's') + ' composed</div>';
      if (pages.length) html += '<div class="dr-pages">' + pages.map(function (p) { return '<a href="' + esc(p.url) + '" target="_blank"><img src="' + esc(p.url) + '" alt="page"/></a>'; }).join('') + '</div>';
      else html += '<div class="dr-empty">No pages yet. Snap a few panels on your best beats, Compose a page, then Export your chapter.</div>';
      bodyEl.innerHTML = html;
    });
  }
  function isOpen() { return overlay && overlay.style.display !== 'none'; }
  function open() { if (!overlay) build(); overlay.style.display = 'flex'; refresh(); }
  function hide() { if (overlay) overlay.style.display = 'none'; }
  function addButton() {
    if (document.getElementById('drReopen')) return;
    var b = document.createElement('button'); b.id = 'drReopen'; b.className = 'dr-reopen'; b.type = 'button';
    b.textContent = '📖 Comic'; b.addEventListener('click', open); document.body.appendChild(b);
  }

  // ---- auto-capture the big stakes beats ----
  function onTurn() {
    var now = Date.now(); if (busy || (now - lastAt) < MIN_GAP_MS) return; busy = true; lastAt = now;
    get(ECON + '/state').then(function (s) {
      var st = s && s.state; if (!st) return;
      if (lastEpisode === null) { lastEpisode = st.episode; lastCancelled = st.cancelledCount || 0; return; }
      if ((st.cancelledCount || 0) > (lastCancelled || 0)) { lastCancelled = st.cancelledCount; snap(true, lastHostLine()); }
      else if (Number.isFinite(st.episode) && st.episode > lastEpisode) { snap(true, lastHostLine()); }
      lastEpisode = st.episode;
    }).catch(function () {}).then(function () { busy = false; });
  }
  function tryHook() {
    var cm = window.AIRPG_CHAT;
    if (!cm || typeof cm.handleChatComplete !== 'function') return false;
    if (cm.__curiouserDirectorHooked) return true;
    var orig = cm.handleChatComplete.bind(cm);
    cm.handleChatComplete = function (p) { var r = orig(p); window.setTimeout(onTurn, 900); return r; };
    cm.__curiouserDirectorHooked = true;
    return true;
  }
  function init() { addButton(); var t = 0, iv = window.setInterval(function () { if (tryHook() || ++t > 150) window.clearInterval(iv); }, 200); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
