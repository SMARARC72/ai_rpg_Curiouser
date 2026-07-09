/**
 * Curiouser Economy Mod (Milestone 2)
 *
 * The gameshow stakes engine. The three live meters — Ratings, Audience Favor,
 * Legacy — ship as need bars (defs/need_bars.yaml) so the engine's built-in
 * per-turn need-bar event-check moves them from play and the Host SPEAKS their
 * threshold sentences (the Host is the HUD; the bars' UI is hidden by
 * public/css). Ink is the setting currency (player.currency), not a bar.
 *
 * This mod.js adds the deterministic, LLM-free stakes logic that a per-turn
 * need bar can't express: Episodes (Format = genre skin × Wonderland Rule +
 * House Rules + a Renewal Threshold), the Renewal / On-the-Bubble / Cancelled /
 * Reboot lifecycle (Cancellation burns Legacy), Curveballs, and Sponsors — all
 * exposed as namespaced HTTP routes under /api/mods/curiouser-economy/... and
 * narrated in the Host's voice.
 *
 * The Season arc closes the loop the bible calls "a novel, not a sketch pile":
 * Legacy tiers (slush → mid-card → headliner → legend), a Season Finale that
 * opens once you're a headliner with enough Renewals banked, and the Off-Air
 * prize for clearing it — Walk Off (the rare win, like Del) or Re-Sign for a
 * harder, richer season. The traveling pen — the one prop "not in the format" —
 * survives every Cancellation and reboot and can be uncapped once per Episode to
 * break that Episode's House Rule. Curveballs resolve with real audience agency:
 * spend Ink to bend the vote your way, or ride out whatever the crowd decides.
 *
 * There is no per-turn mod hook in this engine (see docs/CURIOUSER/ENGINE_MAP.md),
 * so these beats are triggered explicitly (a client button / the Host calling the
 * route), which is exactly the intended "panels/beats are gated" cadence.
 */

const fs = require('fs');
const path = require('path');

module.exports.meta = {
  name: 'Curiouser Economy',
  version: '1.1.0',
  description: 'Ratings / Legacy / Audience Favor meters + Episode stakes (Renewed/Cancelled), the Season arc (Legacy tiers → Finale → Off-Air walk/re-sign), the traveling pen, bendable Curveballs, and Sponsors.'
};

module.exports.configSchema = {
  renewalThresholdMin: { type: 'number', label: 'Renewal Threshold minimum (%)', description: 'Lowest Ratings bar an Episode can require.', default: 40 },
  renewalThresholdMax: { type: 'number', label: 'Renewal Threshold maximum (%)', description: 'Highest Ratings bar an Episode can require.', default: 60 }
};

// ---- Content tables (deterministic rolls; no LLM needed) --------------------
const FORMATS = [
  'noir city', 'sword-and-sorcery kingdom', 'giant-mecha frontline', 'pastel suburbia',
  'space-opera cruiser', 'cosmic-horror fishing town', 'cutthroat high-school', 'dustbowl western',
  'glittering heist crew', 'grim fairy-tale wood'
];
// House Rules. Some carry a `mechanic` that BITES deterministically off the
// player's own action text each turn (enforced in /houserule/enforce); all of
// them are narrated hard into context so the Host enforces the rest. `bite` is
// the plain-language summary of the mechanic, announced when the Episode opens.
const RULES = [
  { text: 'size is mood-based — confidence makes you bigger, shame shrinks you, and the guilty party is literally the largest thing in the room' },
  { text: 'objects negotiate — anything inanimate can be haggled with, and it drives a hard bargain' },
  { text: 'every door opens on the last place you lied about' },
  { text: 'questions are currency — you literally pay for things by asking, and answers cost extra',
    bite: 'every "?" in your action is billed in Ink (Ratings if you\'re broke)', mechanic: { type: 'question_tax', ink: 3 } },
  { text: 'gravity follows whoever in the room is most sincere' },
  { text: 'names are edible and taste exactly like their owner' },
  { text: 'shadows do the precise opposite of whoever casts them' },
  { text: 'the floor becomes whatever you last called someone out loud' },
  { text: 'time runs backward for one beat whenever anyone sincerely apologizes' },
  { text: 'anything you compliment grows fond of you; anything you insult becomes structural',
    bite: 'kind words win the crowd; cruelty spikes Ratings but costs their love', mechanic: { type: 'compliment_structural' } },
  { text: 'the Audience rewards the sly and punishes the loud — subtlety pays, shouting costs',
    bite: 'ALL-CAPS or "!!!" loses Audience Favor', mechanic: { type: 'shout_penalty' } },
  { text: 'brevity is the Format — the long-winded bore the crowd, the terse thrill it',
    bite: 'rambling actions lose Favor; punchy ones gain it', mechanic: { type: 'brevity' } }
];
const HOUSE_WILDCARDS = [
  'A prop "not in the format" can break the House Rule exactly once.',
  'The audience may overrule any single ruling by a two-thirds vote.',
  'Lying on-air is legal but the House Rule notices.',
  'The Host must honor one genuinely clever exploit per Episode.'
];
const CURVEBALLS = {
  audience_vote: [
    'AUDIENCE VOTE: should the nearest door become a crocodile? Voting now.',
    'AUDIENCE VOTE: rain — yes or no? The crowd already hates someone in the room.',
    'AUDIENCE VOTE: should the floor be lava, or merely disappointed in you?',
    'AUDIENCE VOTE: swap two characters\' voices for the rest of the scene?'
  ],
  wildcard: [
    'WILDCARD: someone in this room is you, from a Cancelled season.',
    'WILDCARD: the House Rule inverts for the next sixty seconds.',
    'WILDCARD: the traveling pen just rolled out of your pocket and under something important.',
    'WILDCARD: a rival contestant has been quietly re-cast as your biggest fan.'
  ]
};
const SPONSORS = [
  { name: 'Drink Me™', string: 'anyone who gets thirsty this Episode shrinks 10%', ink: 60 },
  { name: 'Cheshire Dental', string: 'you may not close your mouth for the rest of the Episode', ink: 50 },
  { name: 'Tick-Tock Timepieces', string: 'you must announce the time before every action', ink: 40 },
  { name: 'Painted Rose Cosmetics', string: 'everything you touch turns faintly, guiltily red', ink: 45 },
  { name: 'Mock Turtle Soup Co.', string: 'you well up with real tears at every goodbye', ink: 35 }
];

// Legacy tiers — the season climb (System 3). The Legacy need bar (0–100) maps
// to a status; crossing a threshold is a promotion the Host announces. Headliner
// is the gate: reach it (and clear enough Episodes) and the Season Finale opens.
const LEGACY_TIERS = [
  { min: 0,  key: 'slush',     label: 'the slush pile', blurb: 'a nobody the audience hasn\'t bothered to name yet' },
  { min: 25, key: 'midcard',   label: 'mid-card',       blurb: 'a working contestant with a face people half-remember' },
  { min: 55, key: 'headliner', label: 'headliner',      blurb: 'a draw — they tune in for YOU now' },
  { min: 82, key: 'legend',    label: 'legend',         blurb: 'the kind of name they teach the new contestants to fear' }
];
// How many Renewed Episodes in a season before the Finale can open (also gated on
// reaching at least headliner Legacy). Kept small so a season is a session-length arc.
const FINALE_AFTER = 3;

// Curveballs that RESOLVE with a mechanical nudge and can be bent with Ink.
// swing = the meter the audience is toying with; bendLine = what buying the bend does.
const LIVE_CURVEBALLS = [
  { id: 'crocodile_door', text: 'AUDIENCE VOTE: should the nearest door become a crocodile? The crowd is leaning yes, purely for the chaos.', bar: 'ratings', bendCost: 25, forLine: 'you talk the vote into a spectacle that flatters you — Ratings climb.', againstLine: 'the door grows teeth on a whim; you scramble and the crowd laughs AT you — Ratings dip.' },
  { id: 'rain_vote', text: 'AUDIENCE VOTE: rain, yes or no? They already hate someone in the room and rain feels like justice.', bar: 'audience_favor', bendCost: 20, forLine: 'you make the downpour YOUR moment — the crowd falls for it, Favor rises.', againstLine: 'the rain lands on you instead of your target; the crowd\'s sympathy drifts elsewhere — Favor dips.' },
  { id: 'voice_swap', text: 'AUDIENCE VOTE: swap two characters\' voices for the rest of the scene? The crowd loves a good humiliation.', bar: 'ratings', bendCost: 30, forLine: 'you weaponize the swap for a perfect bit — Ratings spike.', againstLine: 'you get swapped into a squeak mid-threat; the menace evaporates — Ratings dip.' },
  { id: 'floor_lava', text: 'AUDIENCE VOTE: should the floor be lava, or merely disappointed in you? It\'s neck and neck.', bar: 'audience_favor', bendCost: 22, forLine: 'you turn the hazard into a victory lap — the crowd adores it, Favor rises.', againstLine: 'the floor picks "disappointed," and somehow that stings more — Favor dips.' },
  { id: 'ex_contestant', text: 'WILDCARD: someone in this room is you, from a Cancelled season, and the audience just recognized them.', bar: 'ratings', bendCost: 28, forLine: 'you get ahead of the reveal and make it YOUR twist — Ratings surge.', againstLine: 'your dead-season double steals the scene; the crowd pivots to them — Ratings dip.' }
];

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
function legacyTierFor(value) {
  const v = Number.isFinite(value) ? value : 0;
  let tier = LEGACY_TIERS[0];
  for (const t of LEGACY_TIERS) { if (v >= t.min) tier = t; }
  return tier;
}

module.exports.register = function register(scope) {
  const { modDir, modName, registerModRoute } = scope;

  const dataDir = path.join(modDir, 'data');
  const stateFile = path.join(dataDir, 'curiouser-state.json');

  function defaultState() {
    return {
      season: 1, episode: 0, format: null, onTheBubble: false, activeSponsor: null, cancelledCount: 0,
      // Season arc
      renewedThisSeason: 0, isFinale: false, awaitingOffAir: false, offAirCount: 0, legacyTierKey: null,
      stakesTier: 0, // bumps each re-sign; raises Renewal Thresholds
      // The traveling pen — the one prop "not in the format" that survives every
      // reboot. Owned from the first Episode; uncap it once per Episode to break
      // the House Rule. seasonsSurvived is the emotional odometer.
      pen: { owned: true, uncappedThisEpisode: false, seasonsSurvived: 0, brokeRuleCount: 0 },
      pendingCurveball: null
    };
  }
  function loadState() {
    try {
      if (fs.existsSync(stateFile)) return { ...defaultState(), ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
    } catch (err) {
      console.warn(`[${modName}] Failed to read state, resetting:`, err.message);
    }
    return defaultState();
  }
  function saveState(state) {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }

  let state = loadState();

  // Require an active game; return the player or null.
  function activePlayer() {
    return scope.currentPlayer || null;
  }

  // Inject a Host-voiced line into chat history (so the next turn's Host knows),
  // best-effort — the route's returned `host` string is the primary contract.
  function hostSay(text) {
    const player = activePlayer();
    const locationId = player && player.currentLocation;
    if (typeof scope.pushChatEntry === 'function' && locationId) {
      try {
        scope.pushChatEntry({ role: 'assistant', type: 'event-summary', content: text }, null, locationId);
      } catch (err) {
        console.warn(`[${modName}] Could not push Host line to chat:`, err.message);
      }
    }
    return text;
  }

  function requireGame(res) {
    const player = activePlayer();
    if (!player) {
      res.status(409).json({ success: false, error: 'No active game — start or load a Curiouser game first.' });
      return null;
    }
    return player;
  }

  function meterValue(player, id) {
    const v = player.getNeedBarValue(id);
    return Number.isFinite(v) ? v : null;
  }

  function currentThreshold() {
    return state.format && Number.isFinite(state.format.renewalThreshold) ? state.format.renewalThreshold : 50;
  }

  // ---- Routes --------------------------------------------------------------

  // Detect and announce a Legacy promotion/demotion since we last checked.
  // Returns a Host line to append, or null. Mutates state.legacyTierKey.
  function checkLegacyTier(player) {
    const legacy = meterValue(player, 'legacy');
    if (legacy === null) return null;
    const tier = legacyTierFor(legacy);
    const prevKey = state.legacyTierKey;
    if (prevKey === tier.key) return null;
    const prevIdx = LEGACY_TIERS.findIndex(t => t.key === prevKey);
    const nextIdx = LEGACY_TIERS.findIndex(t => t.key === tier.key);
    state.legacyTierKey = tier.key;
    if (prevKey === null) return null; // first observation, no announcement
    if (nextIdx > prevIdx) {
      return `Get up here — you've climbed to ${tier.label}. ${tier.blurb[0].toUpperCase() + tier.blurb.slice(1)}. Legacy like that unlocks doors, contestant.`;
    }
    return `Ouch. That slide drops you back to ${tier.label} — ${tier.blurb}. The climb only counts if you hold the height.`;
  }

  function finaleEligible(player) {
    if (state.isFinale || state.awaitingOffAir) return false;
    const legacy = meterValue(player, 'legacy');
    const tier = legacyTierFor(legacy);
    const tierIdx = LEGACY_TIERS.findIndex(t => t.key === tier.key);
    const headlinerIdx = LEGACY_TIERS.findIndex(t => t.key === 'headliner');
    return state.renewedThisSeason >= FINALE_AFTER && tierIdx >= headlinerIdx;
  }

  function seasonSummary(player) {
    const legacy = player ? meterValue(player, 'legacy') : null;
    const tier = legacyTierFor(legacy);
    return {
      season: state.season,
      renewedThisSeason: state.renewedThisSeason,
      finaleAfter: FINALE_AFTER,
      finaleEligible: player ? finaleEligible(player) : false,
      isFinale: state.isFinale,
      awaitingOffAir: state.awaitingOffAir,
      offAirCount: state.offAirCount,
      stakesTier: state.stakesTier,
      legacyTier: { key: tier.key, label: tier.label },
      pen: state.pen
    };
  }

  // GET /state — current season/episode/format/meters
  registerModRoute('get', '/state', (req, res) => {
    const player = activePlayer();
    const meters = player ? {
      ratings: meterValue(player, 'ratings'),
      audienceFavor: meterValue(player, 'audience_favor'),
      legacy: meterValue(player, 'legacy'),
      ink: typeof player.currency === 'number' ? player.currency : null
    } : null;
    res.json({ success: true, state, meters, season: player ? seasonSummary(player) : null });
  });

  // GET /season/state — the season arc at a glance (tiers, finale, off-air, pen)
  registerModRoute('get', '/season/state', (req, res) => {
    const player = activePlayer();
    res.json({ success: true, season: player ? seasonSummary(player) : null });
  });

  // POST /episode/roll — spin the Format dials and open a new Episode. When the
  // season has earned it (enough Renewals + headliner Legacy), this opens the
  // SEASON FINALE instead: a harder bar, all-or-nothing, clearing it earns Off-Air.
  registerModRoute('post', '/episode/roll', (req, res) => {
    const player = requireGame(res);
    if (!player) return;
    const cfg = scope.modLoader.getModConfig(modName) || {};
    const tMin = Number.isFinite(cfg.renewalThresholdMin) ? cfg.renewalThresholdMin : 40;
    const tMax = Number.isFinite(cfg.renewalThresholdMax) ? cfg.renewalThresholdMax : 60;
    // Each re-sign (stakesTier) raises the whole band; the Finale raises it more.
    const tierBump = (state.stakesTier || 0) * 6;

    const isFinale = finaleEligible(player);
    const setting = pick(FORMATS);
    // Bias toward a rule that BITES mechanically so the Format actually matters.
    const mechanicalRules = RULES.filter(r => r.mechanic);
    const ruleObj = (mechanicalRules.length && Math.random() < 0.65) ? pick(mechanicalRules) : pick(RULES);
    const rule = ruleObj.text;
    let renewalThreshold = randInt(Math.min(tMin, tMax), Math.max(tMin, tMax)) + tierBump;
    if (isFinale) renewalThreshold = Math.min(92, renewalThreshold + 20);
    const houseRules = [rule, pick(HOUSE_WILDCARDS), `Renewal Threshold: ${renewalThreshold}% Ratings by the climax.`];

    state.episode += 1;
    state.isFinale = isFinale;
    state.format = { setting, rule, ruleBite: ruleObj.bite || null, houseRules, renewalThreshold, isFinale };
    state.activeMechanic = ruleObj.mechanic || null;
    state.onTheBubble = false;
    state.activeSponsor = null;
    if (state.pen) state.pen.uncappedThisEpisode = false; // the pen re-caps between Episodes
    // Seed the tier label the first time so the next promotion can be announced.
    if (state.legacyTierKey === null) state.legacyTierKey = legacyTierFor(meterValue(player, 'legacy')).key;
    saveState(state);

    const host = hostSay(
      (isFinale
        ? `SEASON ${state.season} FINALE. This is the one they'll remember you by. Format: ${setting}, and ${rule}. `
        : `Episode ${state.episode}. Format: ${setting}, and ${rule}. `) +
      `House Rules: ${houseRules.join(' · ')} ` +
      (ruleObj.bite ? `And this one BITES: ${ruleObj.bite}. ` : '') +
      (isFinale
        ? `Clear ${renewalThreshold}% and you earn the Off-Air option — walk, or re-sign for higher stakes. Miss it and the whole climb burns. No pressure.`
        : `Hit ${renewalThreshold}% Ratings by the climax or you're on the bubble. Do something.`)
    );
    res.json({ success: true, state, host, isFinale });
  });

  // Deterministic House-Rule enforcement, off the player's own action text.
  function enforceHouseRule(player, message) {
    const m = state.activeMechanic;
    if (!m || typeof message !== 'string' || !message.trim()) return null;
    const text = message;
    const inkOf = () => (typeof player.getCurrency === 'function' ? (player.getCurrency() || 0) : (typeof player.currency === 'number' ? player.currency : 0));
    const bar = (id, dir, mag, reason) => { try { if (typeof player.applyNeedBarChange === 'function') player.applyNeedBarChange(id, { direction: dir, magnitude: mag, reason }); } catch (e) {} };
    if (m.type === 'question_tax') {
      const q = (text.match(/\?/g) || []).length;
      if (q <= 0) return null;
      const cost = (m.ink || 3) * q;
      const have = inkOf();
      if (have >= cost) { if (typeof player.adjustCurrency === 'function') player.adjustCurrency(-cost); return `The Format bills you: ${q} question${q > 1 ? 's' : ''}, ${cost} Ink. Answers cost extra.`; }
      if (typeof player.adjustCurrency === 'function' && have > 0) player.adjustCurrency(-have);
      bar('ratings', 'decrease', 'small', 'Unpaid questions');
      return `${q} question${q > 1 ? 's' : ''} and you couldn't cover it — ${have} Ink gone, the shortfall billed to your Ratings. Answers cost extra.`;
    }
    if (m.type === 'compliment_structural') {
      const lc = ' ' + text.toLowerCase() + ' ';
      const insult = /\b(idiot|stupid|ugly|hate|worst|fool|pathetic|useless|moron|loser|trash)\b/.test(lc);
      const compliment = /\b(love|nice|great|wonderful|beautiful|brilliant|amazing|kind|thank|thanks|please|lovely|clever)\b/.test(lc);
      if (insult) { bar('ratings', 'increase', 'small', 'On-air cruelty'); bar('audience_favor', 'decrease', 'small', 'Cruelty'); return `Cruel — and on this Format it becomes structural. Ratings tick up; the crowd's love ticks down.`; }
      if (compliment) { bar('audience_favor', 'increase', 'small', 'Kind words'); return `Kind words grow fond of you here. Audience Favor swells a little.`; }
      return null;
    }
    if (m.type === 'shout_penalty') {
      const letters = (text.match(/[a-zA-Z]/g) || []).length;
      const caps = (text.match(/[A-Z]/g) || []).length;
      const bangs = (text.match(/!/g) || []).length;
      const loud = (letters >= 8 && caps / letters > 0.6) || bangs >= 3;
      if (!loud) return null;
      bar('audience_favor', 'decrease', 'small', 'Too loud');
      return `The Audience came for sly, not loud. That bellow costs you a sliver of their love — subvert, don't shout.`;
    }
    if (m.type === 'brevity') {
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      if (words >= 40) { bar('audience_favor', 'decrease', 'small', 'Long-winded'); return `${words} words? The Format prizes brevity — the crowd drifts. Tighten it up.`; }
      if (words >= 1 && words <= 5) { bar('audience_favor', 'increase', 'small', 'Punchy'); return `Punchy. The Format rewards the terse — the crowd leans in.`; }
      return null;
    }
    return null;
  }

  // POST /houserule/enforce — apply this Episode's House Rule to the last action
  registerModRoute('post', '/houserule/enforce', (req, res) => {
    const player = requireGame(res);
    if (!player) return;
    const message = req.body && typeof req.body.playerMessage === 'string' ? req.body.playerMessage : '';
    let host = null;
    try { const line = enforceHouseRule(player, message); if (line) host = hostSay(line); }
    catch (e) { console.warn(`[${modName}] house-rule enforce failed:`, e.message); }
    res.json({ success: true, applied: Boolean(host), host });
  });

  // Cross-mod bridge: expose the active Episode/Format/House Rule so other mods
  // (e.g. segments) can theme and gate off it. No-op safe if never read.
  global.CURIOUSER_HOOKS = global.CURIOUSER_HOOKS || {};
  global.CURIOUSER_HOOKS.getActiveEpisode = function getActiveEpisode() {
    return { episode: state.episode, format: state.format || null, activeMechanic: state.activeMechanic || null };
  };

  // POST /episode/renewal-check — Renewed / On the Bubble / Cancelled
  registerModRoute('post', '/episode/renewal-check', (req, res) => {
    const player = requireGame(res);
    if (!player) return;
    if (!state.format) {
      return res.status(409).json({ success: false, error: 'No Episode in progress — roll one first (POST /episode/roll).' });
    }
    const ratings = meterValue(player, 'ratings');
    if (ratings === null) {
      return res.status(409).json({ success: false, error: 'Ratings meter is not active on this character — confirm the Curiouser setting + economy mod are applied.' });
    }
    const threshold = currentThreshold();
    const wasFinale = state.isFinale;
    let outcome, host;

    if (ratings >= threshold) {
      // Clearing a Finale doesn't just renew — it earns the Off-Air option.
      player.applyNeedBarChange('legacy', { direction: 'increase', magnitude: wasFinale ? 'large' : 'small', reason: wasFinale ? 'Season finale cleared' : 'Episode renewed' });
      state.onTheBubble = false;
      state.renewedThisSeason += 1;
      const promo = checkLegacyTier(player);
      if (wasFinale) {
        outcome = 'offair_unlocked';
        state.isFinale = false;
        state.awaitingOffAir = true;
        state.format = null;
        host = hostSay(`YOU CLEARED THE FINALE. ${Math.round(ratings)}% against a ${threshold}% bar and the whole studio is on its feet. ${promo ? promo + ' ' : ''}Here's the prize almost nobody gets: the Off-Air option. Walk — end your own show, on your terms, like Del did — or re-sign for a harder, richer season. Your call, and only you get to make it.`);
      } else {
        outcome = 'renewed';
        host = hostSay(`Renewed. ${Math.round(ratings)}% against a ${threshold}% bar — the audience wants more of you. Your Legacy ticks up${state.renewedThisSeason >= FINALE_AFTER ? ', and you\'re knocking on the Finale' : ''}. ${promo ? promo + ' ' : ''}Next Episode when you're ready.`);
      }
    } else if (state.onTheBubble) {
      // The Prop Department's Panic Room (curiouser-workshop) can spend one
      // Reboot Insurance to soften a Cancellation. Cross-mod, same process;
      // no-ops if the workshop mod isn't loaded / has no insurance armed.
      const panic = (typeof global !== 'undefined' && global.CURIOUSER_HOOKS && typeof global.CURIOUSER_HOOKS.tryConsumeRebootInsurance === 'function')
        ? global.CURIOUSER_HOOKS.tryConsumeRebootInsurance()
        : { saved: false };
      if (panic && panic.saved) {
        outcome = 'reboot_insurance';
        state.onTheBubble = false;
        state.isFinale = false;
        state.format = null;
        host = hostSay(`CANCELLED — and then the Panic Room kicks in. Reboot Insurance cashes out: a trapdoor of your own making drops you clear and you land, gasping, in one piece. ${Math.round(ratings)}% against a ${threshold}% bar — should've been the end, but your Legacy holds and the Vault's still yours. The pen's still in your pocket. Do NOT waste the reprieve.`);
      } else {
        outcome = 'cancelled';
        player.applyNeedBarChange('legacy', { direction: 'decrease', magnitude: 'large', reason: 'Cancelled' });
        state.onTheBubble = false;
        state.isFinale = false;
        state.format = null;
        state.cancelledCount += 1;
        state.renewedThisSeason = 0; // the season's climb is broken
        const demo = checkLegacyTier(player);
        host = hostSay(`Cancelled. ${Math.round(ratings)}% and the bar was ${threshold}%. You're written out live — gloriously, the crowd's on its feet, half of them crying. Your Legacy burns and the season's climb resets. ${demo ? demo + ' ' : ''}One thing they can't take: the pen's still yours. You can be rebooted at a lower tier — same soul, new season.`);
      }
    } else {
      outcome = 'on_the_bubble';
      state.onTheBubble = true;
      const twist = pick(CURVEBALLS.audience_vote);
      host = hostSay(`On the bubble. ${Math.round(ratings)}% against ${threshold}% — one last-chance twist and then we decide. ${twist}`);
    }
    saveState(state);
    res.json({ success: true, outcome, ratings, threshold, state, host });
  });

  function inkOf(player) {
    return typeof player.getCurrency === 'function' ? (player.getCurrency() || 0)
      : (typeof player.currency === 'number' ? player.currency : 0);
  }

  // POST /curveball — throw live chaos the audience actually decides. Returns a
  // resolvable curveball with a bend cost; the player answers via /curveball/resolve
  // (spend Ink to bend it your way, or ride out whatever the crowd wants).
  registerModRoute('post', '/curveball', (req, res) => {
    const player = requireGame(res);
    if (!player) return;
    const cb = pick(LIVE_CURVEBALLS);
    state.pendingCurveball = { id: cb.id, bar: cb.bar, bendCost: cb.bendCost, forLine: cb.forLine, againstLine: cb.againstLine };
    saveState(state);
    const host = hostSay(`${cb.text} You can spend ${cb.bendCost} Ink to bend it your way, or ride out whatever they vote.`);
    res.json({ success: true, curveball: { id: cb.id, text: cb.text, bendCost: cb.bendCost, canAfford: inkOf(player) >= cb.bendCost }, host });
  });

  // POST /curveball/resolve — { bend: bool }. Bend spends Ink for a favorable
  // swing; otherwise the audience's whim lands (a coin-flip nudge, usually against).
  registerModRoute('post', '/curveball/resolve', (req, res) => {
    const player = requireGame(res);
    if (!player) return;
    const cb = state.pendingCurveball;
    if (!cb) return res.status(409).json({ success: false, error: 'No curveball in play — POST /curveball first.' });
    const wantBend = !!(req.body && req.body.bend);
    const bar = (id, dir, mag, reason) => { try { player.applyNeedBarChange(id, { direction: dir, magnitude: mag, reason }); } catch (e) {} };
    let host, bent = false;
    if (wantBend) {
      const have = inkOf(player);
      if (have < cb.bendCost) {
        // Can't cover it — the bend fizzles and the crowd smells desperation.
        bar(cb.bar, 'decrease', 'small', 'Curveball bend failed');
        host = hostSay(`You reach for the Ink to bend it — and you're ${cb.bendCost - have} short. The crowd SEES the flinch. ${cb.againstLine}`);
      } else {
        if (typeof player.adjustCurrency === 'function') player.adjustCurrency(-cb.bendCost);
        bar(cb.bar, 'increase', 'small', 'Curveball bent');
        bent = true;
        host = hostSay(`You spend ${cb.bendCost} Ink and bend the vote — ${cb.forLine} Money well burned.`);
      }
    } else {
      // Ride it out: the audience does what it wants. Slight house edge against you.
      const favorsYou = Math.random() < 0.35;
      if (favorsYou) { bar(cb.bar, 'increase', 'small', 'Curveball rode out well'); host = hostSay(`You ride it out — and the vote breaks YOUR way, free of charge. ${cb.forLine}`); }
      else { bar(cb.bar, 'decrease', 'small', 'Curveball rode out badly'); host = hostSay(`You let the crowd decide. Bold. ${cb.againstLine}`); }
    }
    state.pendingCurveball = null;
    saveState(state);
    res.json({ success: true, bent, host });
  });

  // POST /sponsor — offer a sponsor (string attached)
  registerModRoute('post', '/sponsor', (req, res) => {
    if (!requireGame(res)) return;
    const sponsor = pick(SPONSORS);
    state.pendingSponsor = sponsor;
    saveState(state);
    const host = hostSay(`Sponsor break. ${sponsor.name} wants to attach: ${sponsor.ink} Ink now, but ${sponsor.string}. Take it (POST /sponsor/accept) or stay pure and broke.`);
    res.json({ success: true, sponsor, host });
  });

  // POST /sponsor/accept — take the pending sponsor's Ink, attach the string
  registerModRoute('post', '/sponsor/accept', (req, res) => {
    const player = requireGame(res);
    if (!player) return;
    const sponsor = state.pendingSponsor;
    if (!sponsor) {
      return res.status(409).json({ success: false, error: 'No sponsor on offer — POST /sponsor first.' });
    }
    // If the client names a specific offer, make sure it's still the one on the
    // table (a newer Sponsor break may have replaced it before they clicked).
    const requested = req.body && typeof req.body.sponsor === 'string' ? req.body.sponsor.trim() : null;
    if (requested && sponsor.name !== requested) {
      return res.status(409).json({
        success: false,
        error: 'That offer has expired.',
        host: hostSay(`Too slow — ${requested} walked. ${sponsor.name}'s the one holding the pen now.`)
      });
    }
    if (typeof player.adjustCurrency === 'function') player.adjustCurrency(sponsor.ink);
    state.activeSponsor = sponsor;
    state.pendingSponsor = null;
    saveState(state);
    const balance = typeof player.currency === 'number' ? player.currency : null;
    const host = hostSay(`Sold. ${sponsor.name} pays out ${sponsor.ink} Ink${balance !== null ? ` (you're holding ${balance} now)` : ''}. The catch is live: ${sponsor.string}.`);
    res.json({ success: true, sponsor, inkBalance: balance, host });
  });

  // POST /sponsor/decline — turn down the pending sponsor, stay pure and broke
  registerModRoute('post', '/sponsor/decline', (req, res) => {
    if (!requireGame(res)) return;
    const sponsor = state.pendingSponsor;
    state.pendingSponsor = null;
    saveState(state);
    const host = hostSay(sponsor
      ? `${sponsor.name} pulls the offer, wounded. Pure and broke it is — the audience respects that. Mostly.`
      : `Nothing on the table to turn down.`);
    res.json({ success: true, declined: sponsor ? sponsor.name : null, host });
  });

  // ---- Off-Air: the finale prize (walk, or re-sign for higher stakes) --------

  // POST /offair/walk — the rare win. End your own show, on your terms.
  registerModRoute('post', '/offair/walk', (req, res) => {
    const player = requireGame(res);
    if (!player) return;
    if (!state.awaitingOffAir) {
      return res.status(409).json({ success: false, error: 'The Off-Air option isn\'t on the table — clear a Season Finale first.' });
    }
    state.awaitingOffAir = false;
    state.offAirCount += 1;
    state.format = null;
    state.isFinale = false;
    // Walking off ends this show. If play continues, it's a fresh climb — reset
    // the season's progress (but not the stakesTier; that's the re-sign's bargain).
    state.season += 1;
    state.renewedThisSeason = 0;
    if (state.pen) state.pen.seasonsSurvived += 1;
    saveState(state);
    const host = hostSay(
      `You walk. You actually WALK. The lights follow you to the edge of the stage and then — nothing, no format, no bar, no bit. Just you, the pen, and a door that opens onto somewhere the show can't broadcast. The audience is silent, then it's ROARING, because almost nobody does this. Del did. Now you. Season ${state.season}: yours. Off-Air. Credits roll. Whatever's next, you chose it.`
    );
    res.json({ success: true, outcome: 'walked_off', season: seasonSummary(player), host });
  });

  // POST /offair/resign — re-sign for a new, harder, richer season.
  registerModRoute('post', '/offair/resign', (req, res) => {
    const player = requireGame(res);
    if (!player) return;
    if (!state.awaitingOffAir) {
      return res.status(409).json({ success: false, error: 'Nothing to re-sign for — clear a Season Finale first.' });
    }
    state.awaitingOffAir = false;
    state.season += 1;
    state.renewedThisSeason = 0;
    state.stakesTier += 1;
    state.isFinale = false;
    state.format = null;
    if (state.pen) state.pen.seasonsSurvived += 1;
    // A re-sign bonus: the network pays to keep a proven draw.
    if (typeof player.adjustCurrency === 'function') player.adjustCurrency(75 + state.stakesTier * 25);
    saveState(state);
    const host = hostSay(
      `You re-sign. Of course you do — the pen's not done with you yet. Season ${state.season}, and the network's raised the bar to match your name: bigger Ink up front, meaner Renewal Thresholds, sharper Curveballs. The slush pile is a rumor now. Let's give them a season they'll syndicate. Roll the first Episode when you're ready.`
    );
    res.json({ success: true, outcome: 'resigned', season: seasonSummary(player), host });
  });

  // ---- The traveling pen — the prop "not in the format" ----------------------

  // GET /pen/state — is the pen capped, and how much has it survived?
  registerModRoute('get', '/pen/state', (req, res) => {
    res.json({ success: true, pen: state.pen, hasEpisode: !!state.format });
  });

  // POST /pen/uncap — break THIS Episode's House Rule, once. The pen is the one
  // prop that isn't in the format; uncapping it voids the active mechanical bite
  // for the rest of the Episode.
  registerModRoute('post', '/pen/uncap', (req, res) => {
    const player = requireGame(res);
    if (!player) return;
    if (!state.pen || !state.pen.owned) {
      return res.status(409).json({ success: false, error: 'You\'re not holding the pen.' });
    }
    if (!state.format) {
      return res.status(409).json({ success: false, error: 'No Episode in progress — there\'s no rule to break yet.' });
    }
    if (state.pen.uncappedThisEpisode) {
      return res.status(409).json({ success: false, error: 'The pen\'s already run dry this Episode — it re-caps between Episodes.', host: hostSay(`The pen sputters — you already spent it this Episode. It only breaks the format once, and you already did. It'll be ready next Episode.`) });
    }
    const hadBite = !!state.activeMechanic;
    state.activeMechanic = null; // the format's mechanical bite is voided for the rest of the Episode
    state.pen.uncappedThisEpisode = true;
    state.pen.brokeRuleCount += 1;
    saveState(state);
    const host = hostSay(
      hadBite
        ? `You uncap the pen. It isn't in the format — that's the whole point of it — and the House Rule just... stops applying to you. The Host's eye twitches. "That's cheating." Yeah. It is. The bite's off for the rest of the Episode. Spend the reprieve well.`
        : `You uncap the pen and press it to the air. There's no mechanical rule biting this Episode, so it's mostly theater — but the audience LOVES the gesture, and the Host pretends not to notice you carrying a prop that shouldn't exist.`
    );
    res.json({ success: true, brokeRule: hadBite, pen: state.pen, host });
  });

  console.log(`      🎪 Curiouser Economy mod loaded (Ratings/Favor/Legacy + Episode stakes + Season arc + the pen)`);
};
