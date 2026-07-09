/*
 * Curiouser Rivals — client (Season Standings panel + per-turn tick).
 * Auto-injected into the chat page. Pure client add-on.
 */
(function () {
  'use strict';
  var BASE = '/api/mods/curiouser-rivals';
  var SENDER = '🎙️ The Host';
  var MIN_GAP_MS = 1500;
  var busy = false, lastAt = 0;

  function api(p, m) {
    return fetch(BASE + p, { method: m || 'GET', headers: { 'Content-Type': 'application/json' } })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .catch(function () { return null; });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function chatLog() { return document.getElementById('chatLog'); }
  function renderBeat(text) {
    var el = chatLog(); if (!el || !text) return;
    var w = document.createElement('div'); w.className = 'message ai-message rivals-beat';
    var s = document.createElement('div'); s.className = 'message-sender'; s.textContent = SENDER;
    var b = document.createElement('div'); b.textContent = text;
    w.appendChild(s); w.appendChild(b); el.appendChild(w); el.scrollTop = el.scrollHeight;
  }

  // ---- Standings panel ----
  var overlay = null, bodyEl = null;
  function build() {
    overlay = document.createElement('div'); overlay.className = 'rv-backdrop';
    var modal = document.createElement('div'); modal.className = 'rv-modal';
    var header = document.createElement('div'); header.className = 'rv-header';
    var title = document.createElement('div'); title.className = 'rv-title'; title.textContent = '📺 Season Standings';
    var close = document.createElement('button'); close.className = 'rv-close'; close.type = 'button'; close.textContent = '✕';
    close.addEventListener('click', hide);
    header.appendChild(title); header.appendChild(close);
    bodyEl = document.createElement('div'); bodyEl.className = 'rv-body';
    modal.appendChild(header); modal.appendChild(bodyEl); overlay.appendChild(modal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) hide(); });
    document.addEventListener('keydown', function (e) { if (overlay && overlay.style.display !== 'none' && e.key === 'Escape') hide(); });
    document.body.appendChild(overlay);
  }
  function renderBoard(rows) {
    if (!bodyEl) return;
    if (!rows || !rows.length) { bodyEl.innerHTML = '<div class="rv-empty">No season running yet — start a game and play a turn.</div>'; return; }
    var max = Math.max(1, rows[0].ratings);
    bodyEl.innerHTML = rows.map(function (r) {
      var w = Math.round((r.ratings / 100) * 100);
      return '<div class="rv-row' + (r.isPlayer ? ' rv-you' : '') + '">' +
        '<span class="rv-rank">#' + r.rank + '</span>' +
        '<span class="rv-name">' + esc(r.name) + ' <span class="rv-edit">' + esc(r.edit) + '</span></span>' +
        '<span class="rv-bar"><span class="rv-fill" style="width:' + w + '%"></span></span>' +
        '<span class="rv-num">' + r.ratings + '%</span></div>';
    }).join('');
  }
  function open() { if (!overlay) build(); overlay.style.display = 'flex'; api('/standings', 'GET').then(function (s) { renderBoard(s && s.standings); }); }
  function hide() { if (overlay) overlay.style.display = 'none'; }
  function addButton() {
    (window.__CUR_DOCK__ = window.__CUR_DOCK__ || []).push({ icon: '📺', label: 'Standings', onClick: open });
    if (window.__CUR_DOCK_RENDER__) window.__CUR_DOCK_RENDER__();
  }

  // ---- per-turn tick ----
  function onTurn() {
    var now = Date.now(); if (busy || (now - lastAt) < MIN_GAP_MS) return; busy = true; lastAt = now;
    api('/tick', 'POST').then(function (res) {
      if (res && Array.isArray(res.beats)) res.beats.forEach(renderBeat);
      if (overlay && overlay.style.display !== 'none') api('/standings', 'GET').then(function (s) { renderBoard(s && s.standings); });
    }).catch(function () {}).then(function () { busy = false; });
  }
  function tryHook() {
    var cm = window.AIRPG_CHAT;
    if (!cm || typeof cm.handleChatComplete !== 'function') return false;
    if (cm.__curiouserRivalsHooked) return true;
    var orig = cm.handleChatComplete.bind(cm);
    cm.handleChatComplete = function (p) { var r = orig(p); window.setTimeout(onTurn, 700); return r; };
    cm.__curiouserRivalsHooked = true;
    return true;
  }

  function init() { addButton(); var t = 0, iv = window.setInterval(function () { if (tryHook() || ++t > 150) window.clearInterval(iv); }, 200); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
