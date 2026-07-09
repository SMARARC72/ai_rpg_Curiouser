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
 * There is no per-turn mod hook in this engine (see docs/CURIOUSER/ENGINE_MAP.md),
 * so these beats are triggered explicitly (a client button / the Host calling the
 * route), which is exactly the intended "panels/beats are gated" cadence.
 */

const fs = require('fs');
const path = require('path');

module.exports.meta = {
  name: 'Curiouser Economy',
  version: '1.0.0',
  description: 'Ratings / Legacy / Audience Favor meters + Episode stakes (Renewed/Cancelled), Curveballs, and Sponsors.'
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
const RULES = [
  'size is mood-based — confidence makes you bigger, shame shrinks you, and the guilty party is literally the largest thing in the room',
  'objects negotiate — anything inanimate can be haggled with, and it drives a hard bargain',
  'every door opens on the last place you lied about',
  'questions are currency — you literally pay for things by asking, and answers cost extra',
  'gravity follows whoever in the room is most sincere',
  'names are edible and taste exactly like their owner',
  'shadows do the precise opposite of whoever casts them',
  'the floor becomes whatever you last called someone out loud',
  'time runs backward for one beat whenever anyone sincerely apologizes',
  'anything you compliment grows fond of you; anything you insult becomes structural'
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

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

module.exports.register = function register(scope) {
  const { modDir, modName, registerModRoute } = scope;

  const dataDir = path.join(modDir, 'data');
  const stateFile = path.join(dataDir, 'curiouser-state.json');

  function defaultState() {
    return { season: 1, episode: 0, format: null, onTheBubble: false, activeSponsor: null, cancelledCount: 0 };
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

  // GET /state — current season/episode/format/meters
  registerModRoute('get', '/state', (req, res) => {
    const player = activePlayer();
    const meters = player ? {
      ratings: meterValue(player, 'ratings'),
      audienceFavor: meterValue(player, 'audience_favor'),
      legacy: meterValue(player, 'legacy'),
      ink: typeof player.currency === 'number' ? player.currency : null
    } : null;
    res.json({ success: true, state, meters });
  });

  // POST /episode/roll — spin the Format dials and open a new Episode
  registerModRoute('post', '/episode/roll', (req, res) => {
    if (!requireGame(res)) return;
    const cfg = scope.modLoader.getModConfig(modName) || {};
    const tMin = Number.isFinite(cfg.renewalThresholdMin) ? cfg.renewalThresholdMin : 40;
    const tMax = Number.isFinite(cfg.renewalThresholdMax) ? cfg.renewalThresholdMax : 60;

    const setting = pick(FORMATS);
    const rule = pick(RULES);
    const renewalThreshold = randInt(Math.min(tMin, tMax), Math.max(tMin, tMax));
    const houseRules = [rule, pick(HOUSE_WILDCARDS), `Renewal Threshold: ${renewalThreshold}% Ratings by the climax.`];

    state.episode += 1;
    state.format = { setting, rule, houseRules, renewalThreshold };
    state.onTheBubble = false;
    state.activeSponsor = null;
    saveState(state);

    const host = hostSay(
      `Episode ${state.episode}. Format: ${setting}, and ${rule}. ` +
      `House Rules: ${houseRules.join(' · ')} ` +
      `Hit ${renewalThreshold}% Ratings by the climax or you're on the bubble. Do something.`
    );
    res.json({ success: true, state, host });
  });

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
    let outcome, host;

    if (ratings >= threshold) {
      outcome = 'renewed';
      player.applyNeedBarChange('legacy', { direction: 'increase', magnitude: 'small', reason: 'Episode renewed' });
      state.onTheBubble = false;
      host = hostSay(`Renewed. ${Math.round(ratings)}% against a ${threshold}% bar — the audience wants more of you. Your Legacy ticks up. Next Episode when you're ready.`);
    } else if (state.onTheBubble) {
      outcome = 'cancelled';
      player.applyNeedBarChange('legacy', { direction: 'decrease', magnitude: 'large', reason: 'Cancelled' });
      state.onTheBubble = false;
      state.format = null;
      state.cancelledCount += 1;
      host = hostSay(`Cancelled. ${Math.round(ratings)}% and the bar was ${threshold}%. You're written out live — gloriously, the crowd's on its feet, half of them crying. Your Legacy burns. You can be rebooted at a lower tier: same soul, new season.`);
    } else {
      outcome = 'on_the_bubble';
      state.onTheBubble = true;
      const twist = pick(CURVEBALLS.audience_vote);
      host = hostSay(`On the bubble. ${Math.round(ratings)}% against ${threshold}% — one last-chance twist and then we decide. ${twist}`);
    }
    saveState(state);
    res.json({ success: true, outcome, ratings, threshold, state, host });
  });

  // POST /curveball — roll live chaos (audience vote or wildcard)
  registerModRoute('post', '/curveball', (req, res) => {
    if (!requireGame(res)) return;
    const type = Math.random() < 0.5 ? 'audience_vote' : 'wildcard';
    const line = pick(CURVEBALLS[type]);
    const host = hostSay(line);
    res.json({ success: true, type, host });
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
    if (typeof player.adjustCurrency === 'function') player.adjustCurrency(sponsor.ink);
    state.activeSponsor = sponsor;
    state.pendingSponsor = null;
    saveState(state);
    const balance = typeof player.currency === 'number' ? player.currency : null;
    const host = hostSay(`Sold. ${sponsor.name} pays out ${sponsor.ink} Ink${balance !== null ? ` (you're holding ${balance} now)` : ''}. The catch is live: ${sponsor.string}.`);
    res.json({ success: true, sponsor, inkBalance: balance, host });
  });

  console.log(`      🎪 Curiouser Economy mod loaded (Ratings/Favor/Legacy + Episode stakes)`);
};
