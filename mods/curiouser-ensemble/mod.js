/*
 * Curiouser Ensemble — "The Living Set" (a per-turn world tick).
 * ------------------------------------------------------------------------
 * The engine already has the NOUNS of a living world — NPCs carry goals,
 * memories, and a 6-axis disposition toward the player; they can relocate;
 * factions have relations — but almost nothing drives them autonomously; the
 * world only moves when an LLM call reacts to the player's turn. This mod adds
 * the missing VERBS as an autonomous per-turn tick (client handleChatComplete
 * -> POST /tick), covering four pillars:
 *
 *   1. Autonomous cast   — NPCs migrate between locations, scheme, chase goals.
 *   2. Personalized       — recurring rivals/allies remember the player, come
 *      continuity            BACK across scenes, escalate; a growing "legend".
 *   3. Faction shifts     — allegiances drift over time (net-new; factions are
 *                            static in the base engine).
 *   4. Time/place + ambient — periodic scene/time beats and occasional
 *                             passersby.
 *
 * Hybrid intensity: mostly deterministic (movement, goals, faction drift,
 * canned beats) so it adds no per-turn LLM cost; every few turns it may spawn
 * a genuinely LLM-authored passerby (generateNpcFromEvent). Because the mod
 * mutates real NPC/faction state and narrates via pushChatEntry, the engine's
 * OWN next-turn prose elaborates the changes in the Host's voice for free.
 *
 * Route: POST /api/mods/curiouser-ensemble/tick   (called once per turn)
 *        GET  /api/mods/curiouser-ensemble/state
 */

const fs = require('fs');
const path = require('path');

module.exports.meta = {
  name: 'Curiouser Ensemble',
  version: '1.0.0',
  description: 'The Living Set: NPCs move/scheme/recur, factions drift, ambient life — an autonomous per-turn world tick.'
};

module.exports.configSchema = {
  beatChance: { type: 'number', label: 'Beat chance / turn', description: 'Probability a visible world beat fires on a given turn (0-1).', default: 0.6 },
  factionInterval: { type: 'number', label: 'Faction-shift interval (turns)', description: 'Minimum turns between faction allegiance shifts.', default: 5 },
  ambientInterval: { type: 'number', label: 'Ambient/LLM interval (turns)', description: 'Turns between ambient beats that may spawn an LLM-authored passerby.', default: 4 }
};

// ---- Curiouser flavor tables -----------------------------------------------
const SCHEME_GOALS = [
  'Upstage the contestant on-air', 'Steal the format key before the climax',
  'Win the Audience away from the frontrunner', 'Sabotage the next segment',
  'Land a sponsor of their own', 'Expose a rival\'s edit', 'Survive to the reboot',
  'Turn the House Rule to their advantage', 'Get more screen time at any cost'
];
const MIGRATION_LINES = [
  'slipped out toward', 'was last seen heading for', 'made an exit toward',
  'got quietly re-blocked to', 'stormed off in the direction of'
];
const FACTION_SHIFTS = {
  allied: ['sealed a backstage alliance', 'are suddenly best friends for the cameras', 'merged their fan-blocs'],
  neutral: ['called an uneasy truce', 'stopped returning each other\'s calls', 'went cold on each other'],
  hostile: ['are openly feuding now', 'declared war over the ratings share', 'torched the alliance on-air'],
  rival: ['can\'t stand each other this week', 'are locked in a bitter subplot', 'started a very public rivalry']
};
const AMBIENT_FLAVOR = [
  'The Audience murmurs somewhere overhead — approving, or hungry, hard to say.',
  'A stagehand hurries through, muttering about the next segment.',
  'The lights breathe, dim then bright, like the show itself is thinking.',
  'Somewhere a laugh-track coughs to life, then thinks better of it.',
  'A camera on a boom drifts past, framing you for exactly no reason.',
  'The coffee machine in the wings dispenses something that is legally not coffee.'
];
const TIME_FLAVOR = [
  'A segment ends. The set exhales; the schedule ticks on without asking you.',
  'The show cuts to a break you can feel more than see. Time moves.',
  'The lighting shifts to its between-scenes wash — the day\'s getting on.',
  'Somewhere a countdown resets. The next beat is already loading.'
];
const RETURN_RIVAL = [
  'is back — still sore about last time, and this time they brought a plan.',
  'walks back into your scene wearing a grin that has your name on it.',
  'returns, and the temperature drops. Unfinished business, clearly.'
];
const RETURN_ALLY = [
  'is back — a familiar face, and on this show that counts for a lot.',
  'turns up again, and for once someone\'s glad to see you.',
  'circles back around; they remember what you did for them.'
];
const LEGEND_FLAVOR = [
  'has definitely heard of you', 'clocks you the second you walk in — you\'re somebody now',
  'has seen your Ratings; it shows in how they stand'
];

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
const RELATIONS = ['allied', 'neutral', 'hostile', 'rival'];

module.exports.register = function register(scope) {
  const { modDir, modName, registerModRoute, Player, factions, gameLocations } = scope;

  const dataDir = path.join(modDir, 'data');
  const stateFile = path.join(dataDir, 'ensemble-state.json');

  function defaultState() {
    return { turn: 0, lastFactionTurn: 0, lastAmbientTurn: 0, legend: 0, cast: {} };
  }
  function loadState() {
    try {
      if (fs.existsSync(stateFile)) {
        const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        return Object.assign(defaultState(), parsed && typeof parsed === 'object' ? parsed : {});
      }
    } catch (err) { console.warn(`[${modName}] Failed to read state, resetting:`, err.message); }
    return defaultState();
  }
  function saveState() {
    try { if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); }
    catch (err) { console.warn(`[${modName}] Failed to save state:`, err.message); }
  }
  let state = loadState();

  function cfg(key, dflt) {
    try { const c = scope.modLoader.getModConfig(modName) || {}; return Number.isFinite(c[key]) ? c[key] : dflt; }
    catch (e) { return dflt; }
  }

  function player() { return scope.currentPlayer || null; }
  function hostSay(text) {
    const p = player(); const locationId = p && p.currentLocation;
    if (typeof scope.pushChatEntry === 'function' && locationId) {
      try { scope.pushChatEntry({ role: 'assistant', type: 'event-summary', content: text }, null, locationId); }
      catch (err) { console.warn(`[${modName}] pushChatEntry failed:`, err.message); }
    }
    return text;
  }
  function locOf(id) { return id && gameLocations && typeof gameLocations.get === 'function' ? (gameLocations.get(id) || null) : null; }
  function npcCurrentLoc(npc) { try { return locOf(npc.currentLocation); } catch (e) { return null; } }
  function allNpcs(pid) {
    const out = [];
    if (scope.players && typeof scope.players.values === 'function') {
      for (const n of scope.players.values()) { if (n && n.isNPC && n.id !== pid && !n.isDead) out.push(n); }
    }
    return out;
  }
  function presentNpcs(loc, pid) {
    if (!loc || typeof loc.getNPCs !== 'function') return [];
    try { return loc.getNPCs().filter(n => n && n.isNPC && n.id !== pid && !n.isDead); } catch (e) { return []; }
  }
  function dispScore(npc, pid) {
    const g = (t) => { try { const v = npc.getDisposition(pid, t); return Number.isFinite(v) ? v : 0; } catch (e) { return 0; } };
    return { ally: g('platonic') + g('respect') + g('trust'), fear: g('comfort_fear') };
  }

  // ---- pillar actions (deterministic) --------------------------------------

  function actMigrate(pid) {
    const npcs = allNpcs(pid);
    if (!npcs.length) return null;
    const npc = pick(npcs);
    const origin = npcCurrentLoc(npc);
    // Choose a destination: prefer an exit of the NPC's current location, else any other location.
    let dest = null;
    try {
      const exits = origin && typeof origin.exits !== 'undefined' ? origin.exits : null;
      const exitList = exits ? (Array.isArray(exits) ? exits : Object.values(exits)) : [];
      const dests = exitList.map(e => e && e.destination).filter(Boolean);
      if (dests.length) dest = locOf(pick(dests));
    } catch (e) { /* fall through */ }
    if (!dest && gameLocations && typeof gameLocations.values === 'function') {
      const others = [...gameLocations.values()].filter(l => l && (!origin || l.id !== origin.id));
      if (others.length) dest = pick(others);
    }
    if (!dest) return null;
    try {
      if (origin && typeof origin.removeNpcId === 'function') origin.removeNpcId(npc.id);
      if (typeof dest.addNpcId === 'function') dest.addNpcId(npc.id);
      if (typeof npc.setLocation === 'function') npc.setLocation(dest.id);
      if (typeof npc.addImportantMemory === 'function') npc.addImportantMemory(`Moved to ${dest.name || 'a new part of the set'}.`);
    } catch (e) { return null; }
    return hostSay(`Word reaches you: ${npc.name} ${pick(MIGRATION_LINES)} ${dest.name || 'somewhere off-set'}.`);
  }

  function actScheme(pid, present) {
    const npcs = present && present.length ? present : allNpcs(pid);
    if (!npcs.length) return null;
    const npc = pick(npcs);
    const goal = pick(SCHEME_GOALS);
    try { if (typeof npc.addGoal === 'function') npc.addGoal(goal); } catch (e) {}
    try { if (typeof npc.addImportantMemory === 'function') npc.addImportantMemory(`New angle: ${goal.toLowerCase()}.`); } catch (e) {}
    return hostSay(`Backstage whisper: ${npc.name} is scheming to ${goal.toLowerCase()}.`);
  }

  function actFaction() {
    if (!factions || typeof factions.values !== 'function') return null;
    const list = [...factions.values()].filter(Boolean);
    if (list.length < 2) return null;
    const a = pick(list); let b = pick(list); let guard = 0;
    while (b.id === a.id && guard++ < 5) b = pick(list);
    if (b.id === a.id) return null;
    const status = pick(RELATIONS);
    const gossip = pick(FACTION_SHIFTS[status] || FACTION_SHIFTS.neutral);
    const notes = `${a.name} and ${b.name} ${gossip}.`;
    try { if (typeof a.setRelation === 'function') a.setRelation(b.id, { status, notes }); } catch (e) { return null; }
    try { if (typeof b.setRelation === 'function') b.setRelation(a.id, { status, notes }); } catch (e) {}
    state.lastFactionTurn = state.turn;
    return hostSay(`Off-air, the industry shifts: ${a.name} and ${b.name} ${gossip}.`);
  }

  function actCastReturn(pid, loc) {
    if (!loc) return null;
    const presentIds = new Set(presentNpcs(loc, pid).map(n => n.id));
    const candidates = Object.values(state.cast).filter(c => c && !presentIds.has(c.id) && (state.turn - (c.lastTurn || 0)) >= 3);
    if (!candidates.length) return null;
    const entry = pick(candidates);
    let npc = null;
    try { npc = Player.get ? Player.get(entry.id) : null; } catch (e) { npc = null; }
    if (!npc) { delete state.cast[entry.id]; return null; }
    const origin = npcCurrentLoc(npc);
    try {
      if (origin && typeof origin.removeNpcId === 'function' && origin.id !== loc.id) origin.removeNpcId(npc.id);
      if (typeof loc.addNpcId === 'function') loc.addNpcId(npc.id);
      if (typeof npc.setLocation === 'function') npc.setLocation(loc.id);
      const pname = (player() && player().name) || 'the contestant';
      if (typeof npc.addImportantMemory === 'function') npc.addImportantMemory(`Sought out ${pname} again — unfinished business.`);
      if (entry.role === 'rival') { if (typeof npc.decreaseDisposition === 'function') npc.decreaseDisposition(pid, 'respect', 8); }
      else if (entry.role === 'ally') { if (typeof npc.increaseDisposition === 'function') npc.increaseDisposition(pid, 'trust', 6); }
    } catch (e) { return null; }
    entry.lastTurn = state.turn;
    const line = entry.role === 'rival' ? pick(RETURN_RIVAL) : (entry.role === 'ally' ? pick(RETURN_ALLY) : 'is back, and the story remembers them.');
    return hostSay(`${npc.name} ${line}`);
  }

  async function actAmbient(pid, loc) {
    // ~every ambientInterval turns; sometimes spawn a real (LLM-authored) passerby.
    if (loc && Math.random() < 0.4 && typeof scope.generateNpcFromEvent === 'function') {
      try {
        const region = typeof scope.findRegionByLocationId === 'function' ? scope.findRegionByLocationId(loc.id) : null;
        const npc = await scope.generateNpcFromEvent({
          location: loc, region: region || null,
          additionalInstructions: 'A brief ambient passerby for a live cosmic gameshow scene — a crew member, a Format-native, a rival contestant\'s hanger-on, or an Audience plant. Give them a quick comedic angle. They are minor colour, not a major character.'
        });
        if (npc && npc.id) {
          if (typeof loc.addNpcId === 'function') loc.addNpcId(npc.id);
          if (typeof npc.setLocation === 'function') npc.setLocation(loc.id);
          if ((state.legend || 0) >= 2 && typeof npc.addImportantMemory === 'function') {
            const pname = (player() && player().name) || 'the contestant';
            npc.addImportantMemory(`${pname} ${pick(LEGEND_FLAVOR)}.`);
          }
          state.lastAmbientTurn = state.turn;
          return hostSay(`Someone new drifts into frame: ${npc.name}.`);
        }
      } catch (e) { /* fall back to canned ambient */ }
    }
    state.lastAmbientTurn = state.turn;
    return hostSay(pick(AMBIENT_FLAVOR));
  }

  // ---- personalization upkeep ----------------------------------------------
  function updateCastAndLegend(pid, present) {
    // Promote strongly-felt present NPCs to recurring cast.
    for (const npc of present) {
      const s = dispScore(npc, pid);
      const strong = Math.abs(s.ally) >= 40 || s.fear >= 40;
      if (strong) {
        const role = s.ally >= 40 ? 'ally' : (s.fear >= 40 || s.ally <= -40 ? 'rival' : 'wildcard');
        state.cast[npc.id] = { id: npc.id, name: npc.name, role, lastTurn: state.turn, intensity: Math.round(Math.max(Math.abs(s.ally), s.fear)) };
      } else if (state.cast[npc.id]) {
        state.cast[npc.id].lastTurn = state.turn;
      }
    }
    // Legend from the gameshow meters (economy mod need bars), 0-5.
    const p = player();
    let ratings = 0, legacy = 0;
    if (p && typeof p.getNeedBarValue === 'function') {
      try { ratings = p.getNeedBarValue('ratings') || 0; } catch (e) {}
      try { legacy = p.getNeedBarValue('legacy') || 0; } catch (e) {}
    }
    state.legend = Math.max(0, Math.min(5, Math.round((ratings + legacy) / 40)));
  }

  // ---- routes --------------------------------------------------------------

  registerModRoute('get', '/state', (req, res) => {
    res.json({ success: true, turn: state.turn, legend: state.legend, cast: Object.values(state.cast) });
  });

  registerModRoute('post', '/tick', async (req, res) => {
    const p = player();
    if (!p) return res.json({ success: true, beats: [], reason: 'no_active_game' });

    state.turn += 1;
    const loc = locOf(p.currentLocation);
    const present = presentNpcs(loc, p.id);
    updateCastAndLegend(p.id, present);

    const beats = [];
    const beatChance = cfg('beatChance', 0.6);
    const factionInterval = cfg('factionInterval', 5);
    const ambientInterval = cfg('ambientInterval', 4);

    try {
      // Faction shift takes priority when due.
      if (state.turn - state.lastFactionTurn >= factionInterval && Math.random() < 0.7) {
        const b = actFaction(); if (b) beats.push(b);
      }
      if (!beats.length && Math.random() < beatChance) {
        // Weighted choice among the living-world beats.
        const options = [];
        const returnable = Object.values(state.cast).some(c => c && (state.turn - (c.lastTurn || 0)) >= 3);
        if (returnable && loc) options.push('return', 'return');
        if (loc && (state.turn - state.lastAmbientTurn) >= ambientInterval) options.push('ambient', 'ambient');
        options.push('migrate', 'scheme', 'migrate');
        const choice = pick(options);
        let b = null;
        if (choice === 'return') b = actCastReturn(p.id, loc);
        else if (choice === 'ambient') b = await actAmbient(p.id, loc);
        else if (choice === 'scheme') b = actScheme(p.id, present);
        else b = actMigrate(p.id);
        // Fallbacks so a chosen turn still produces something sensible.
        if (!b) b = actScheme(p.id, present) || actMigrate(p.id);
        if (b) beats.push(b);
      }
    } catch (e) {
      console.warn(`[${modName}] tick error:`, e.message);
    }

    saveState();
    res.json({ success: true, turn: state.turn, legend: state.legend, beats });
  });

  console.log('      🎭 Curiouser Ensemble mod loaded (the living set)');
};
