/*
 * Curiouser Workshop — "The Prop Department" client panel.
 * ------------------------------------------------------------------------
 * A tabbed modal (Salvage · Craft · Build · Green Room) opened from a floating
 * button, driving the workshop mod's routes. Auto-injected into the chat page.
 * Every action re-reads /state and re-renders, and echoes the Host's result
 * line into the chat. Pure client add-on; no core changes.
 */
(function () {
  'use strict';

  var BASE = '/api/mods/curiouser-workshop';
  var SENDER = '🎙️ The Host';
  var TABS = [
    { id: 'salvage', label: 'Salvage' },
    { id: 'craft', label: 'Craft' },
    { id: 'build', label: 'Build' },
    { id: 'base', label: 'Green Room' }
  ];

  var overlay = null;
  var refs = null;
  var activeTab = 'craft';
  var state = null;
  var busy = false;

  function api(routePath, method, body) {
    return fetch(BASE + routePath, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().catch(function () { return null; }); })
      .catch(function () { return null; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function chatLog() { return document.getElementById('chatLog'); }
  function hostLine(text) {
    var logEl = chatLog();
    if (!logEl || !text) return;
    var wrap = document.createElement('div');
    wrap.className = 'message ai-message cw-beat';
    var s = document.createElement('div'); s.className = 'message-sender'; s.textContent = SENDER;
    var b = document.createElement('div'); b.textContent = text;
    wrap.appendChild(s); wrap.appendChild(b);
    logEl.appendChild(wrap);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function costStr(parts, ink) {
    var bits = Object.keys(parts || {}).map(function (k) {
      var lbl = (state && state.partLabels && state.partLabels[k]) || k;
      return parts[k] + ' ' + lbl;
    });
    if (ink) bits.unshift(ink + ' Ink');
    return bits.join(' + ') || 'free';
  }
  function rar(r) { return 'cw-rar-' + esc(r || 'common'); }

  // ---- action runner: call route, echo host, refresh ----
  function act(routePath, body) {
    if (busy) return;
    busy = true;
    api(routePath, 'POST', body).then(function (res) {
      if (res && res.host) hostLine(res.host);
      else if (res && res.error) hostLine('🔧 ' + res.error);
      return refresh();
    }).then(function () { busy = false; });
  }

  function refresh() {
    return api('/state', 'GET').then(function (s) {
      if (s && s.success) state = s;
      render();
    });
  }

  // ---- renderers ----
  function partsLedger() {
    if (!state) return '';
    var chips = (state.partOrder || []).map(function (k) {
      var n = (state.parts && state.parts[k]) || 0;
      var lbl = (state.partLabels && state.partLabels[k]) || k;
      return '<span class="cw-chip' + (n > 0 ? ' has' : '') + '">' + esc(lbl) + ' <b>' + n + '</b></span>';
    }).join('');
    return '<div class="cw-ledger"><span class="cw-ink-chip">Ink <b>' + (state.ink == null ? '–' : state.ink) + '</b></span>' + chips + '</div>';
  }

  function renderSalvage() {
    var inv = (state && state.inventory) || [];
    var rows = inv.length ? inv.map(function (it) {
      return '<div class="cw-row"><div class="cw-row-main"><span class="cw-name ' + rar(it.rarity) + '">' + esc(it.name) + '</span>' +
        '<span class="cw-sub">' + esc(it.rarity) + (it.value ? ' · ' + it.value + ' Ink' : '') + '</span></div>' +
        '<button class="cw-btn cw-salvage" data-id="' + esc(it.id) + '">Salvage</button></div>';
    }).join('') : '<div class="cw-empty">No props on you to salvage. Loot the set, then come back.</div>';
    return partsLedger() +
      '<div class="cw-actionbar"><button class="cw-btn cw-appraise">Appraise inventory</button>' +
      '<span class="cw-hint">Salvage breaks a prop into parts (+ a little Ink) by rarity.</span></div>' +
      '<div class="cw-list">' + rows + '</div>';
  }

  function renderCraft() {
    var recipes = (state && state.recipes) || [];
    var rows = recipes.map(function (r) {
      return '<div class="cw-row' + (r.craftable ? '' : ' cw-locked') + '"><div class="cw-row-main">' +
        '<span class="cw-name ' + rar(r.rarity) + '">' + esc(r.name) + '</span>' +
        '<span class="cw-sub">' + esc(r.description || '') + '</span>' +
        '<span class="cw-cost">' + costStr(r.parts, r.ink) + ' · ' + esc(r.station) + ' L' + r.tier + '</span></div>' +
        '<button class="cw-btn cw-craft" data-id="' + esc(r.id) + '"' + (r.craftable ? '' : ' disabled') + '>Craft</button></div>';
    }).join('');
    return partsLedger() +
      '<div class="cw-actionbar"><button class="cw-btn cw-primary cw-experiment">🧪 Experiment</button>' +
      '<span class="cw-hint">Combine random parts for a surprising prop — sometimes a new recipe.</span></div>' +
      '<div class="cw-list">' + rows + '</div>';
  }

  function renderBuild() {
    var structures = (state && state.structures) || [];
    var rows = structures.map(function (s) {
      return '<div class="cw-row' + (s.buildable ? '' : ' cw-locked') + '"><div class="cw-row-main">' +
        '<span class="cw-name">' + esc(s.name) + '</span>' +
        '<span class="cw-sub">' + esc(s.description || '') + '</span>' +
        '<span class="cw-cost">' + costStr(s.parts, s.ink) + '</span></div>' +
        '<button class="cw-btn cw-build" data-id="' + esc(s.id) + '"' + (s.buildable ? '' : ' disabled') + '>Build here</button></div>';
    }).join('');
    return partsLedger() +
      '<div class="cw-hint cw-note">Structures are built into your current location and stay there.</div>' +
      '<div class="cw-list">' + rows + '</div>';
  }

  function renderBase() {
    var base = (state && state.base && state.base.stations) || {};
    var info = (state && state.stationInfo) || {};
    var insurance = (state && state.rebootInsurance) || 0;
    var rows = Object.keys(info).map(function (key) {
      var st = info[key]; var lvl = base[key] || 0;
      var maxed = lvl >= st.maxLevel;
      var sub = esc(st.blurb);
      var control, dim = maxed;
      if (key === 'panic' && lvl >= 1) {
        sub += insurance >= 1 ? ' <b class="cw-armed">Insurance: ARMED</b>' : ' <b class="cw-spent">Insurance: SPENT</b>';
        if (insurance >= 1) { control = '<span class="cw-maxtag">ARMED</span>'; }
        else { control = '<button class="cw-btn cw-primary cw-restock">Restock (40 Ink)</button>'; dim = false; }
      } else if (maxed) {
        control = '<span class="cw-maxtag">MAX</span>';
      } else {
        control = '<button class="cw-btn cw-upgrade" data-station="' + esc(key) + '">Upgrade</button>';
      }
      return '<div class="cw-row' + (dim ? ' cw-maxed' : '') + '"><div class="cw-row-main">' +
        '<span class="cw-name">' + esc(st.name) + ' <span class="cw-lvl">L' + lvl + '/' + st.maxLevel + '</span></span>' +
        '<span class="cw-sub">' + sub + '</span></div>' + control + '</div>';
    }).join('');
    var applause = (base.applause || 0) >= 1
      ? '<div class="cw-actionbar"><button class="cw-btn cw-primary cw-applause">📣 Crank Applause (15 Ink)</button><span class="cw-hint">Spend Ink for a burst of Audience Favor.</span></div>' : '';
    // Vault
    var slots = (state && state.vaultSlots) || 0;
    var vault = (state && state.vault) || [];
    var inv = (state && state.inventory) || [];
    var vaultItems = vault.length ? vault.map(function (v) {
      return '<div class="cw-row"><div class="cw-row-main"><span class="cw-name ' + rar(v.rarity) + '">' + esc(v.name) + '</span></div>' +
        '<button class="cw-btn cw-withdraw" data-index="' + v.index + '">Withdraw</button></div>';
    }).join('') : '<div class="cw-empty">Vault is empty.</div>';
    var storeItems = (slots > 0 && inv.length) ? ('<div class="cw-substore">' + inv.map(function (it) {
      return '<div class="cw-row"><div class="cw-row-main"><span class="cw-name ' + rar(it.rarity) + '">' + esc(it.name) + '</span></div>' +
        '<button class="cw-btn cw-store" data-id="' + esc(it.id) + '">&rarr; Vault</button></div>';
    }).join('') + '</div>') : '';
    var vaultBlock = slots > 0 ? ('<div class="cw-section-title">Prop Vault (' + vault.length + '/' + slots + ') — survives Cancellation</div>' +
      '<div class="cw-list">' + vaultItems + '</div>' + (storeItems ? ('<div class="cw-section-title">Stash from inventory</div>' + storeItems) : ''))
      : '<div class="cw-hint cw-note">Build a Prop Vault to store props across Episodes.</div>';
    return partsLedger() + '<div class="cw-section-title">Green Room</div><div class="cw-list">' + rows + '</div>' + applause + vaultBlock;
  }

  function render() {
    if (!refs) return;
    refs.tabs.querySelectorAll('.cw-tab').forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-tab') === activeTab);
    });
    var html = activeTab === 'salvage' ? renderSalvage()
      : activeTab === 'craft' ? renderCraft()
      : activeTab === 'build' ? renderBuild()
      : renderBase();
    refs.body.innerHTML = html;
  }

  // ---- delegated clicks inside the body ----
  function onBodyClick(e) {
    var t = e.target;
    if (t.classList.contains('cw-salvage')) act('/salvage', { thingId: t.getAttribute('data-id') });
    else if (t.classList.contains('cw-appraise')) act('/appraise', {});
    else if (t.classList.contains('cw-craft') && !t.disabled) act('/craft', { recipeId: t.getAttribute('data-id') });
    else if (t.classList.contains('cw-experiment')) act('/experiment', {});
    else if (t.classList.contains('cw-build') && !t.disabled) act('/build', { structureId: t.getAttribute('data-id') });
    else if (t.classList.contains('cw-upgrade')) act('/base/upgrade', { station: t.getAttribute('data-station') });
    else if (t.classList.contains('cw-applause')) act('/base/applause', {});
    else if (t.classList.contains('cw-restock')) act('/base/panic/restock', {});
    else if (t.classList.contains('cw-store')) act('/vault/store', { thingId: t.getAttribute('data-id') });
    else if (t.classList.contains('cw-withdraw')) act('/vault/withdraw', { index: Number(t.getAttribute('data-index')) });
  }

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'cw-backdrop';
    var modal = document.createElement('div'); modal.className = 'cw-modal';

    var header = document.createElement('div'); header.className = 'cw-header';
    var title = document.createElement('div'); title.className = 'cw-title'; title.textContent = '🔧 The Prop Department';
    var close = document.createElement('button'); close.className = 'cw-close'; close.type = 'button'; close.textContent = '✕';
    close.addEventListener('click', hide);
    header.appendChild(title); header.appendChild(close);

    var tabs = document.createElement('div'); tabs.className = 'cw-tabs';
    TABS.forEach(function (tb) {
      var b = document.createElement('button'); b.className = 'cw-tab'; b.type = 'button';
      b.setAttribute('data-tab', tb.id); b.textContent = tb.label;
      b.addEventListener('click', function () { activeTab = tb.id; render(); });
      tabs.appendChild(b);
    });

    var body = document.createElement('div'); body.className = 'cw-body';
    body.addEventListener('click', onBodyClick);

    modal.appendChild(header); modal.appendChild(tabs); modal.appendChild(body);
    overlay.appendChild(modal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) hide(); });
    document.addEventListener('keydown', function (e) { if (overlay && overlay.style.display !== 'none' && e.key === 'Escape') hide(); });
    document.body.appendChild(overlay);
    refs = { title: title, tabs: tabs, body: body };
  }

  function open() {
    if (!overlay) build();
    overlay.style.display = 'flex';
    refresh();
  }
  function hide() { if (overlay) overlay.style.display = 'none'; }

  function addButton() {
    if (document.getElementById('cwReopen')) return;
    var b = document.createElement('button');
    b.id = 'cwReopen'; b.className = 'cw-reopen'; b.type = 'button';
    b.textContent = '🔧 Prop Shop';
    b.addEventListener('click', open);
    document.body.appendChild(b);
  }

  function init() { addButton(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
