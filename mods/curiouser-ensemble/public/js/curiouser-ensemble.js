/*
 * Curiouser Ensemble — client tick driver.
 * ------------------------------------------------------------------------
 * Fires the living-world tick once per player turn: wraps the chat client's
 * turn-completion handler and POSTs /api/mods/curiouser-ensemble/tick, then
 * renders any returned world beats into the chat. Auto-injected into the chat
 * page. Pure client add-on.
 */
(function () {
  'use strict';

  var BASE = '/api/mods/curiouser-ensemble';
  var SENDER = '🎭 The Set';
  var MIN_GAP_MS = 1500;

  var busy = false;
  var lastAt = 0;

  function log() { try { console.log.apply(console, ['[curiouser-ensemble]'].concat([].slice.call(arguments))); } catch (e) {} }

  function chatLog() { return document.getElementById('chatLog'); }
  function renderBeat(text) {
    var el = chatLog();
    if (!el || !text) return;
    var wrap = document.createElement('div');
    wrap.className = 'message ai-message world-beat';
    var s = document.createElement('div'); s.className = 'message-sender'; s.textContent = SENDER;
    var b = document.createElement('div'); b.textContent = text;
    wrap.appendChild(s); wrap.appendChild(b);
    el.appendChild(wrap);
    el.scrollTop = el.scrollHeight;
  }

  function onTurnComplete() {
    var now = Date.now();
    if (busy || (now - lastAt) < MIN_GAP_MS) return;
    busy = true; lastAt = now;
    fetch(BASE + '/tick', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (res) {
        if (res && Array.isArray(res.beats)) res.beats.forEach(renderBeat);
      })
      .catch(function () {})
      .then(function () { busy = false; });
  }

  function tryHook() {
    var cm = window.AIRPG_CHAT;
    if (!cm || typeof cm.handleChatComplete !== 'function') return false;
    if (cm.__curiouserEnsembleHooked) return true;
    var orig = cm.handleChatComplete.bind(cm);
    cm.handleChatComplete = function (payload) {
      var r = orig(payload);
      window.setTimeout(onTurnComplete, 600);
      return r;
    };
    cm.__curiouserEnsembleHooked = true;
    log('hooked turn completion — the set is live');
    return true;
  }

  var tries = 0;
  var iv = window.setInterval(function () { if (tryHook() || ++tries > 150) window.clearInterval(iv); }, 200);
})();
