/*
 * Curiouser Segments — client (objective panel + per-turn tick).
 * Auto-injected into the chat page. Pure client add-on.
 */
(function () {
  'use strict';
  var BASE = '/api/mods/curiouser-segments';
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
    var w = document.createElement('div'); w.className = 'message ai-message segment-beat';
    var s = document.createElement('div'); s.className = 'message-sender'; s.textContent = SENDER;
    var b = document.createElement('div'); b.textContent = text;
    w.appendChild(s); w.appendChild(b); el.appendChild(w); el.scrollTop = el.scrollHeight;
  }

  var overlay = null, bodyEl = null;
  function build() {
    overlay = document.createElement('div'); overlay.className = 'sg-backdrop';
    var modal = document.createElement('div'); modal.className = 'sg-modal';
    var header = document.createElement('div'); header.className = 'sg-header';
    var title = document.createElement('div'); title.className = 'sg-title'; title.textContent = '🎬 This Segment';
    var close = document.createElement('button'); close.className = 'sg-close'; close.type = 'button'; close.textContent = '✕';
    close.addEventListener('click', hide);
    header.appendChild(title); header.appendChild(close);
    bodyEl = document.createElement('div'); bodyEl.className = 'sg-body';
    modal.appendChild(header); modal.appendChild(bodyEl); overlay.appendChild(modal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) hide(); });
    document.addEventListener('keydown', function (e) { if (overlay && overlay.style.display !== 'none' && e.key === 'Escape') hide(); });
    document.body.appendChild(overlay);
  }
  function renderSeg(seg) {
    if (!bodyEl) return;
    if (!seg) { bodyEl.innerHTML = '<div class="sg-empty">No segment running right now — the next one opens shortly.</div>'; return; }
    var pct = Number.isFinite(seg.progress) ? seg.progress : 0;
    bodyEl.innerHTML =
      '<div class="sg-name">' + esc(seg.name) + '</div>' +
      '<div class="sg-obj">' + esc(seg.objective) + '</div>' +
      '<div class="sg-bar"><span class="sg-fill" style="width:' + pct + '%"></span></div>' +
      '<div class="sg-meta"><span>' + pct + '%</span><span>' + esc(String(seg.turnsLeft)) + ' beats left</span></div>' +
      '<div class="sg-reward">Payoff: ' + esc(seg.reward) + '</div>';
  }
  function open() { if (!overlay) build(); overlay.style.display = 'flex'; api('/state', 'GET').then(function (s) { renderSeg(s && s.segment); }); }
  function hide() { if (overlay) overlay.style.display = 'none'; }
  function addButton() {
    if (document.getElementById('sgReopen')) return;
    var b = document.createElement('button'); b.id = 'sgReopen'; b.className = 'sg-reopen'; b.type = 'button';
    b.textContent = '🎬 Segment'; b.addEventListener('click', open); document.body.appendChild(b);
  }

  function onTurn() {
    var now = Date.now(); if (busy || (now - lastAt) < MIN_GAP_MS) return; busy = true; lastAt = now;
    api('/tick', 'POST').then(function (res) {
      if (res && Array.isArray(res.beats)) res.beats.forEach(renderBeat);
      if (overlay && overlay.style.display !== 'none') api('/state', 'GET').then(function (s) { renderSeg(s && s.segment); });
    }).catch(function () {}).then(function () { busy = false; });
  }
  function tryHook() {
    var cm = window.AIRPG_CHAT;
    if (!cm || typeof cm.handleChatComplete !== 'function') return false;
    if (cm.__curiouserSegmentsHooked) return true;
    var orig = cm.handleChatComplete.bind(cm);
    cm.handleChatComplete = function (p) { var r = orig(p); window.setTimeout(onTurn, 800); return r; };
    cm.__curiouserSegmentsHooked = true;
    return true;
  }
  function init() { addButton(); var t = 0, iv = window.setInterval(function () { if (tryHook() || ++t > 150) window.clearInterval(iv); }, 200); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
