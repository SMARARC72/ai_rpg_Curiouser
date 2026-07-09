/*
 * Curiouser Economy — client driver.
 * ------------------------------------------------------------------------
 * The economy mod's stakes engine (Episodes, Curveballs, Sponsors, the
 * Renewal/Cancellation lifecycle) lives as HTTP routes under
 * /api/mods/curiouser-economy/... but the engine has no per-turn mod hook,
 * so nothing fired them and the whole gameshow layer sat inert.
 *
 * This script — auto-injected into the chat page by the mod loader — supplies
 * the missing trigger. It wraps the chat client's turn-completion handler
 * (window.AIRPG_CHAT.handleChatComplete) and, after each player turn, paces the
 * beats: it opens Episode 1 when a game first has meters, throws the occasional
 * live Curveball or Sponsor break, and runs a Renewal check at each Episode's
 * climax (Renewed / On-the-Bubble / Cancelled → next Episode). Every beat's
 * Host line is rendered into the chat as an on-air interruption; the route also
 * records it server-side so the next turn's Host is aware of it.
 *
 * Pure client add-on: no core engine changes. Beats only fire during an active
 * game (chat_complete never fires on the pre-game screen), and gracefully
 * no-op if the economy meters aren't present.
 */
(function () {
  'use strict';

  var BASE = '/api/mods/curiouser-economy';
  var SENDER = '🎙️ The Host';

  // Cadence knobs.
  var EPISODE_LENGTH = 12;     // player turns before a Renewal check
  var CURVEBALL_CHANCE = 0.18; // per eligible turn
  var SPONSOR_CHANCE = 0.09;   // per eligible turn
  var MIN_GAP_MS = 1500;       // debounce duplicate chat_complete events

  var active = false;          // economy meters present on this character
  var bootstrapped = false;    // an Episode has been opened
  var turnsThisEpisode = 0;
  var busy = false;
  var lastFireAt = 0;

  function log() {
    try { console.log.apply(console, ['[curiouser-economy]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  function api(routePath, method) {
    return fetch(BASE + routePath, {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json' }
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json().catch(function () { return null; });
    }).catch(function () { return null; });
  }

  function chatLog() { return document.getElementById('chatLog'); }

  // Render a Host beat as an on-air interruption in the chat.
  function renderBeat(text, kind) {
    var logEl = chatLog();
    if (!logEl || !text) return;
    var wrap = document.createElement('div');
    wrap.className = 'message ai-message curiouser-beat' + (kind ? ' curiouser-beat--' + kind : '');
    var sender = document.createElement('div');
    sender.className = 'message-sender';
    sender.textContent = SENDER;
    var body = document.createElement('div');
    body.textContent = text;
    wrap.appendChild(sender);
    wrap.appendChild(body);
    logEl.appendChild(wrap);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // Confirm the gameshow meters exist (Curiouser setting + economy mod applied).
  function ensureActive() {
    if (active) return Promise.resolve(true);
    return api('/state', 'GET').then(function (st) {
      if (st && st.success && st.meters && st.meters.ratings !== null && st.meters.ratings !== undefined) {
        active = true;
      }
      return active;
    });
  }

  function rollEpisode(kind) {
    return api('/episode/roll').then(function (r) {
      if (r && r.success) {
        bootstrapped = true;
        turnsThisEpisode = 0;
        renderBeat(r.host, kind || 'episode');
        return true;
      }
      return false;
    });
  }

  function runRenewalCheck() {
    return api('/episode/renewal-check').then(function (rc) {
      if (!rc || !rc.success) return false;
      renderBeat(rc.host, 'stakes');
      // Renewed or Cancelled closes the Episode; On-the-Bubble keeps it open
      // for one more stretch (the route already threw the last-chance twist).
      if (rc.outcome === 'renewed' || rc.outcome === 'cancelled') {
        return rollEpisode('episode');
      }
      turnsThisEpisode = 0; // bubble: give the contestant another run at the bar
      return true;
    });
  }

  function maybeSideBeat() {
    var roll = Math.random();
    if (roll < CURVEBALL_CHANCE) {
      return api('/curveball').then(function (cb) {
        if (cb && cb.success) renderBeat(cb.host, 'curveball');
      });
    }
    if (roll < CURVEBALL_CHANCE + SPONSOR_CHANCE) {
      return api('/sponsor').then(function (sp) {
        if (sp && sp.success) renderBeat(sp.host, 'sponsor');
      });
    }
    return Promise.resolve();
  }

  function onTurnComplete() {
    var now = Date.now();
    if (busy || (now - lastFireAt) < MIN_GAP_MS) return;
    busy = true;
    lastFireAt = now;

    ensureActive().then(function (ok) {
      if (!ok) return;
      return api('/state', 'GET').then(function (st) {
        var hasFormat = st && st.state && st.state.format;
        if (!bootstrapped && !hasFormat) {
          // First real turn of a fresh game: open Episode 1 and stop there.
          return rollEpisode('episode');
        }
        bootstrapped = true;
        turnsThisEpisode += 1;
        if (turnsThisEpisode >= EPISODE_LENGTH) {
          return runRenewalCheck();
        }
        return maybeSideBeat();
      });
    }).catch(function (e) {
      log('beat error:', e && e.message);
    }).then(function () {
      busy = false;
    });
  }

  // Wrap the chat client's completion handler once it exists.
  function tryHook() {
    var cm = window.AIRPG_CHAT;
    if (!cm || typeof cm.handleChatComplete !== 'function') return false;
    if (cm.__curiouserEconomyHooked) return true;
    var orig = cm.handleChatComplete.bind(cm);
    cm.handleChatComplete = function (payload) {
      var result = orig(payload);
      // Let the turn's own DOM settle, then interject.
      window.setTimeout(onTurnComplete, 450);
      return result;
    };
    cm.__curiouserEconomyHooked = true;
    log('hooked turn completion — gameshow beats armed');
    return true;
  }

  var tries = 0;
  var iv = window.setInterval(function () {
    if (tryHook() || ++tries > 150) window.clearInterval(iv);
  }, 200);
})();
