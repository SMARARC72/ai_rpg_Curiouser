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

  function api(routePath, method, body) {
    return fetch(BASE + routePath, {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json().catch(function () { return null; });
    }).catch(function () { return null; });
  }

  function chatLog() { return document.getElementById('chatLog'); }

  // The player's most recent action text (for House-Rule enforcement).
  function lastPlayerMessage() {
    var nodes = document.querySelectorAll('.message.user-message');
    if (!nodes.length) return '';
    var last = nodes[nodes.length - 1];
    var body = last.querySelector('div:not(.message-sender):not(.message-timestamp):not(.message-actions)');
    return (body ? body.textContent : last.textContent) || '';
  }

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
      // Clearing the Finale earns the Off-Air choice — render it and STOP; the
      // player must walk or re-sign before any new Episode rolls.
      if (rc.outcome === 'offair_unlocked') {
        renderOffAirChoice(rc.host);
        return true;
      }
      renderBeat(rc.host, 'stakes');
      // Renewed or Cancelled closes the Episode; On-the-Bubble keeps it open
      // for one more stretch (the route already threw the last-chance twist).
      if (rc.outcome === 'renewed' || rc.outcome === 'cancelled' || rc.outcome === 'reboot_insurance') {
        return rollEpisode('episode');
      }
      turnsThisEpisode = 0; // bubble: give the contestant another run at the bar
      return true;
    });
  }

  // The Off-Air prize: Walk Off (the rare win) or Re-Sign (harder, richer season).
  function renderOffAirChoice(hostText) {
    var logEl = chatLog();
    if (!logEl) return;
    var wrap = document.createElement('div');
    wrap.className = 'message ai-message curiouser-beat curiouser-beat--offair';
    var sender = document.createElement('div');
    sender.className = 'message-sender';
    sender.textContent = SENDER;
    var body = document.createElement('div');
    body.textContent = hostText || 'The Off-Air option is on the table.';
    var actions = document.createElement('div');
    actions.className = 'curiouser-sponsor-actions curiouser-offair-actions';
    var walk = document.createElement('button');
    walk.type = 'button';
    walk.className = 'btn curiouser-sponsor-btn curiouser-offair-walk';
    walk.textContent = '🚪 Walk Off (end your show)';
    var resign = document.createElement('button');
    resign.type = 'button';
    resign.className = 'btn curiouser-sponsor-btn curiouser-offair-resign';
    resign.textContent = '✒️ Re-Sign (higher stakes)';

    function settle(note) {
      walk.disabled = true; resign.disabled = true;
      actions.classList.add('is-resolved');
      if (note) { var n = document.createElement('div'); n.className = 'curiouser-sponsor-result'; n.textContent = note; wrap.appendChild(n); }
      logEl.scrollTop = logEl.scrollHeight;
    }
    walk.addEventListener('click', function () {
      walk.disabled = true; resign.disabled = true;
      api('/offair/walk').then(function (r) { settle(r && r.host ? r.host : 'You walk off, on your terms.'); });
    });
    resign.addEventListener('click', function () {
      walk.disabled = true; resign.disabled = true;
      api('/offair/resign').then(function (r) {
        settle(r && r.host ? r.host : 'You re-sign for a harder season.');
        // A fresh season starts — open its first Episode.
        window.setTimeout(function () { rollEpisode('episode'); }, 600);
      });
    });
    actions.appendChild(walk); actions.appendChild(resign);
    wrap.appendChild(sender); wrap.appendChild(body); wrap.appendChild(actions);
    logEl.appendChild(wrap);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function maybeSideBeat() {
    var roll = Math.random();
    if (roll < CURVEBALL_CHANCE) {
      return api('/curveball').then(function (cb) {
        if (cb && cb.success && cb.curveball) renderCurveball(cb.curveball, cb.host);
        else if (cb && cb.success) renderBeat(cb.host, 'curveball');
      });
    }
    if (roll < CURVEBALL_CHANCE + SPONSOR_CHANCE) {
      return api('/sponsor').then(function (sp) {
        if (sp && sp.success && sp.sponsor) renderSponsorOffer(sp.sponsor, sp.host);
        else if (sp && sp.success) renderBeat(sp.host, 'sponsor');
      });
    }
    return Promise.resolve();
  }

  // A Curveball the audience decides. Bend it your way with Ink, or ride it out.
  function renderCurveball(cb, hostText) {
    var logEl = chatLog();
    if (!logEl || !cb) return;
    var wrap = document.createElement('div');
    wrap.className = 'message ai-message curiouser-beat curiouser-beat--curveball';
    var sender = document.createElement('div');
    sender.className = 'message-sender';
    sender.textContent = SENDER;
    var body = document.createElement('div');
    body.textContent = hostText || cb.text || 'Curveball!';
    var actions = document.createElement('div');
    actions.className = 'curiouser-sponsor-actions curiouser-curveball-actions';
    var bend = document.createElement('button');
    bend.type = 'button';
    bend.className = 'btn curiouser-sponsor-btn curiouser-curveball-bend';
    bend.textContent = '✒️ Bend it (−' + cb.bendCost + ' Ink)';
    if (cb.canAfford === false) { bend.disabled = true; bend.title = 'Not enough Ink'; }
    var ride = document.createElement('button');
    ride.type = 'button';
    ride.className = 'btn curiouser-sponsor-btn curiouser-sponsor-pass';
    ride.textContent = 'Ride it out';

    function settle(note) {
      bend.disabled = true; ride.disabled = true;
      actions.classList.add('is-resolved');
      if (note) { var n = document.createElement('div'); n.className = 'curiouser-sponsor-result'; n.textContent = note; wrap.appendChild(n); }
      logEl.scrollTop = logEl.scrollHeight;
    }
    bend.addEventListener('click', function () {
      bend.disabled = true; ride.disabled = true;
      api('/curveball/resolve', 'POST', { bend: true }).then(function (r) { settle(r && r.host ? r.host : 'You bend the vote.'); });
    });
    ride.addEventListener('click', function () {
      bend.disabled = true; ride.disabled = true;
      api('/curveball/resolve', 'POST', { bend: false }).then(function (r) { settle(r && r.host ? r.host : 'You let the crowd decide.'); });
    });
    actions.appendChild(bend); actions.appendChild(ride);
    wrap.appendChild(sender); wrap.appendChild(body); wrap.appendChild(actions);
    logEl.appendChild(wrap);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // A Sponsor break renders with live Take/Pass controls (the only beat the
  // player answers directly). Take -> /sponsor/accept (Ink in, string attached);
  // Pass -> /sponsor/decline.
  function renderSponsorOffer(sponsor, hostText) {
    var logEl = chatLog();
    if (!logEl || !sponsor) return;
    var wrap = document.createElement('div');
    wrap.className = 'message ai-message curiouser-beat curiouser-beat--sponsor';

    var sender = document.createElement('div');
    sender.className = 'message-sender';
    sender.textContent = SENDER;

    var body = document.createElement('div');
    body.textContent = hostText || (sponsor.name + ' wants to attach.');

    var actions = document.createElement('div');
    actions.className = 'curiouser-sponsor-actions';
    var take = document.createElement('button');
    take.type = 'button';
    take.className = 'btn curiouser-sponsor-btn curiouser-sponsor-take';
    take.textContent = 'Take the deal (+' + sponsor.ink + ' Ink)';
    var pass = document.createElement('button');
    pass.type = 'button';
    pass.className = 'btn curiouser-sponsor-btn curiouser-sponsor-pass';
    pass.textContent = 'Pass';

    function settle(note) {
      take.disabled = true;
      pass.disabled = true;
      actions.classList.add('is-resolved');
      if (note) {
        var n = document.createElement('div');
        n.className = 'curiouser-sponsor-result';
        n.textContent = note;
        wrap.appendChild(n);
      }
      logEl.scrollTop = logEl.scrollHeight;
    }

    take.addEventListener('click', function () {
      take.disabled = true;
      pass.disabled = true;
      fetch(BASE + '/sponsor/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sponsor: sponsor.name })
      }).then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (res) { settle(res && res.host ? res.host : 'Deal done.'); })
        .catch(function () { take.disabled = false; pass.disabled = false; });
    });
    pass.addEventListener('click', function () {
      take.disabled = true;
      pass.disabled = true;
      api('/sponsor/decline').then(function (res) {
        settle(res && res.host ? res.host : 'You wave the sponsor off.');
      });
    });

    actions.appendChild(take);
    actions.appendChild(pass);
    wrap.appendChild(sender);
    wrap.appendChild(body);
    wrap.appendChild(actions);
    logEl.appendChild(wrap);
    logEl.scrollTop = logEl.scrollHeight;
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
        // This Episode's House Rule bites off your own action text, every turn
        // it triggers (independent of the gated side-beat below).
        api('/houserule/enforce', 'POST', { playerMessage: lastPlayerMessage() }).then(function (hr) {
          if (hr && hr.host) renderBeat(hr.host, 'houserule');
        });
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

  // The traveling pen — a dock action, always to hand. Uncap it to break the
  // Episode's House Rule once; the route narrates the result (and refuses, in the
  // Host's voice, if it's already spent this Episode or there's no rule to break).
  function uncapPen() {
    fetch(BASE + '/pen/uncap', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (res) {
        if (res && res.host) renderBeat(res.host, 'pen');
        else if (res && res.error) renderBeat(res.error, 'pen');
        else renderBeat('The pen won\'t write just now.', 'pen');
      })
      .catch(function () { renderBeat('The pen won\'t write just now.', 'pen'); });
  }

  function registerPenDock() {
    (window.__CUR_DOCK__ = window.__CUR_DOCK__ || []).push({
      icon: '🖊️', label: 'The Pen — break the rule', onClick: uncapPen
    });
    if (window.__CUR_DOCK_RENDER__) window.__CUR_DOCK_RENDER__();
  }
  registerPenDock();

  var tries = 0;
  var iv = window.setInterval(function () {
    if (tryHook() || ++tries > 150) window.clearInterval(iv);
  }, 200);
})();
