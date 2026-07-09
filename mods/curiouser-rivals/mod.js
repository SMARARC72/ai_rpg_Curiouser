/*
 * Curiouser Rivals — rival contestants + Season Standings.
 * ------------------------------------------------------------------------
 * The design promised "rival contestants with their own Ratings and edits."
 * This mod runs a self-contained competitive sim: a roster of named rivals,
 * each with their own Ratings/Legacy and an archetype "edit" (Hero/Heel/Sob
 * Story/Schemer/Crowd-Pleaser/Wildcard). Each turn their Ratings drift, they
 * scheme against the frontrunner, and periodically the standings shake up —
 * a bottom rival gets Cancelled and a new challenger arrives.
 *
 * The player is ranked against them by reading the economy mod's live Ratings
 * meter (player.getNeedBarValue('ratings')), so YOU appear in the leaderboard
 * without any coupling beyond that read. Turns the living cast into a real
 * competitive ladder with a season shape. The Host narrates the shake-ups;
 * a Season Standings panel shows the board.
 *
 * Routes (under /api/mods/curiouser-rivals/...):
 *   GET  /standings   the leaderboard (rivals + you), ranked
 *   POST /tick        advance the sim one turn; returns any beats
 */

const fs = require('fs');
const path = require('path');

module.exports.meta = {
  name: 'Curiouser Rivals',
  version: '1.0.0',
  description: 'Rival contestants with their own Ratings/Legacy + a live Season Standings ladder.'
};

const ARCHETYPES = [
  { key: 'hero', label: 'The Hero', drift: 0.6 },
  { key: 'heel', label: 'The Heel', drift: 0.9, aggressive: true },
  { key: 'sob', label: 'The Sob Story', drift: -0.2 },
  { key: 'schemer', label: 'The Schemer', drift: 0.4, aggressive: true },
  { key: 'crowd', label: 'The Crowd-Pleaser', drift: 0.7 },
  { key: 'wildcard', label: 'The Wildcard', drift: 0.0, swingy: true }
];
const RIVAL_NAMES = [
  'Mock Turtle', 'The Cheshire', 'March Hare', 'The Duchess', 'Bandersnatch', 'Jubjub',
  'Tweedle', 'The Gryphon', 'Dodo', 'Caterpillar', 'The Walrus', 'The Carpenter',
  'Knave of Hearts', 'White Rabbit', 'Dormouse'
];
const SCHEME_LINES = [
  'is cutting a promo at your expense', 'just poached one of your Audience blocs',
  'leaked a bad edit of your last scene', 'is angling for your sponsor',
  'called you out on-air', 'is quietly gunning for the frontrunner'
];

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

module.exports.register = function register(scope) {
  const { modDir, modName, registerModRoute } = scope;
  const dataDir = path.join(modDir, 'data');
  const stateFile = path.join(dataDir, 'rivals-state.json');

  function defaultState() { return { turn: 0, rivals: [], nextId: 1, lastShakeup: 0, lastPlayerRank: null }; }
  function loadState() {
    try { if (fs.existsSync(stateFile)) return Object.assign(defaultState(), JSON.parse(fs.readFileSync(stateFile, 'utf8')) || {}); }
    catch (e) { console.warn(`[${modName}] state reset:`, e.message); }
    return defaultState();
  }
  function saveState() {
    try { if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); }
    catch (e) { console.warn(`[${modName}] save failed:`, e.message); }
  }
  let state = loadState();

  function player() { return scope.currentPlayer || null; }
  function hostSay(text) {
    const p = player(); const locationId = p && p.currentLocation;
    if (typeof scope.pushChatEntry === 'function' && locationId) {
      try { scope.pushChatEntry({ role: 'assistant', type: 'event-summary', content: text }, null, locationId); } catch (e) {}
    }
    return text;
  }
  function usedNames() { return new Set(state.rivals.map(r => r.name)); }
  function makeRival() {
    const used = usedNames();
    const pool = RIVAL_NAMES.filter(n => !used.has(n));
    const name = pool.length ? pick(pool) : `Contestant ${state.nextId}`;
    const arch = pick(ARCHETYPES);
    return { id: 'rv' + (state.nextId++), name, archetype: arch.key, archetypeLabel: arch.label, ratings: randInt(30, 60), legacy: randInt(5, 25), status: 'active' };
  }
  function ensureRoster() {
    if (!state.rivals.length) { for (let i = 0; i < 5; i++) state.rivals.push(makeRival()); saveState(); }
  }
  function archOf(key) { return ARCHETYPES.find(a => a.key === key) || ARCHETYPES[0]; }

  function playerMeters() {
    const p = player();
    let ratings = 50, legacy = 0;
    if (p && typeof p.getNeedBarValue === 'function') {
      try { const r = p.getNeedBarValue('ratings'); if (Number.isFinite(r)) ratings = r; } catch (e) {}
      try { const l = p.getNeedBarValue('legacy'); if (Number.isFinite(l)) legacy = l; } catch (e) {}
    }
    return { ratings, legacy };
  }

  function board() {
    const pm = playerMeters();
    const rows = state.rivals.filter(r => r.status === 'active').map(r => ({ name: r.name, edit: r.archetypeLabel, ratings: Math.round(r.ratings), legacy: Math.round(r.legacy), isPlayer: false, status: r.status }));
    rows.push({ name: 'YOU', edit: 'Contestant', ratings: Math.round(pm.ratings), legacy: Math.round(pm.legacy), isPlayer: true, status: 'active' });
    rows.sort((a, b) => b.ratings - a.ratings || b.legacy - a.legacy);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  }
  function playerRank() { const b = board(); const me = b.find(r => r.isPlayer); return me ? me.rank : null; }

  registerModRoute('get', '/standings', (req, res) => {
    ensureRoster();
    res.json({ success: true, turn: state.turn, standings: board() });
  });

  registerModRoute('post', '/tick', (req, res) => {
    if (!player()) return res.json({ success: true, beats: [], reason: 'no_active_game' });
    ensureRoster();
    state.turn += 1;
    const beats = [];

    // 1. Every active rival's Ratings drift by their archetype bias + noise.
    for (const r of state.rivals) {
      if (r.status !== 'active') continue;
      const a = archOf(r.archetype);
      const noise = a.swingy ? (Math.random() * 10 - 5) : (Math.random() * 5 - 2.5);
      r.ratings = clamp(r.ratings + a.drift + noise, 0, 100);
    }

    const rankBefore = state.lastPlayerRank;
    const rankNow = playerRank();

    // 2. Standings shake-up on a cadence: cancel a flagging rival, add a challenger.
    if (state.turn - state.lastShakeup >= 8) {
      state.lastShakeup = state.turn;
      const active = state.rivals.filter(r => r.status === 'active').sort((a, b) => a.ratings - b.ratings);
      const bottom = active[0];
      if (bottom && bottom.ratings < 28) {
        bottom.status = 'cancelled';
        const challenger = makeRival();
        state.rivals.push(challenger);
        beats.push(hostSay(`Standings shake-up: ${bottom.name} (${bottom.archetypeLabel}) is Cancelled — written out live. A new face, ${challenger.name} (${challenger.archetypeLabel}), is shoved on-air to replace them.`));
      }
      // Frontrunner banks Legacy.
      const top = active[active.length - 1];
      if (top) { top.legacy = clamp(top.legacy + 3, 0, 100); }
    }

    // 3. A rival schemes (against the frontrunner, often you).
    if (!beats.length && Math.random() < 0.35) {
      const active = state.rivals.filter(r => r.status === 'active');
      if (active.length) {
        const schemer = pick(active);
        const targetIsYou = rankNow === 1;
        beats.push(hostSay(`Backstage: ${schemer.name} ${pick(SCHEME_LINES)}${targetIsYou ? " — and the frontrunner is YOU." : '.'}`));
      }
    }

    // 4. Rank change beat.
    if (!beats.length && rankBefore && rankNow && rankNow !== rankBefore) {
      const b = board();
      const ahead = b.find(r => r.rank === rankNow - 1);
      if (rankNow > rankBefore) beats.push(hostSay(`You slip to #${rankNow} in the Season Standings${ahead ? ` — ${ahead.name} is ahead of you now` : ''}. Do something about it.`));
      else beats.push(hostSay(`You climb to #${rankNow} in the Season Standings. The Audience notices a mover.`));
    }

    state.lastPlayerRank = rankNow;
    saveState();
    res.json({ success: true, turn: state.turn, rank: rankNow, beats });
  });

  console.log('      📺 Curiouser Rivals mod loaded (season standings)');
};
