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
    // Bias toward a rule that BITES mechanically so the Format actually matters.
    const mechanicalRules = RULES.filter(r => r.mechanic);
    const ruleObj = (mechanicalRules.length && Math.random() < 0.65) ? pick(mechanicalRules) : pick(RULES);
    const rule = ruleObj.text;
    const renewalThreshold = randInt(Math.min(tMin, tMax), Math.max(tMin, tMax));
    const houseRules = [rule, pick(HOUSE_WILDCARDS), `Renewal Threshold: ${renewalThreshold}% Ratings by the climax.`];

    state.episode += 1;
    state.format = { setting, rule, ruleBite: ruleObj.bite || null, houseRules, renewalThreshold };
    state.activeMechanic = ruleObj.mechanic || null;
    state.onTheBubble = false;
    state.activeSponsor = null;
    saveState(state);

    const host = hostSay(
      `Episode ${state.episode}. Format: ${setting}, and ${rule}. ` +
      `House Rules: ${houseRules.join(' · ')} ` +
      (ruleObj.bite ? `And this one BITES: ${ruleObj.bite}. ` : '') +
      `Hit ${renewalThreshold}% Ratings by the climax or you're on the bubble. Do something.`
    );
    res.json({ success: true, state, host });
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
    let outcome, host;

    if (ratings >= threshold) {
      outcome = 'renewed';
      player.applyNeedBarChange('legacy', { direction: 'increase', magnitude: 'small', reason: 'Episode renewed' });
      state.onTheBubble = false;
      host = hostSay(`Renewed. ${Math.round(ratings)}% against a ${threshold}% bar — the audience wants more of you. Your Legacy ticks up. Next Episode when you're ready.`);
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
        state.format = null;
        host = hostSay(`CANCELLED — and then the Panic Room kicks in. Reboot Insurance cashes out: a trapdoor of your own making drops you clear and you land, gasping, in one piece. ${Math.round(ratings)}% against a ${threshold}% bar — should've been the end, but your Legacy holds and the Vault's still yours. Do NOT waste the reprieve.`);
      } else {
        outcome = 'cancelled';
        player.applyNeedBarChange('legacy', { direction: 'decrease', magnitude: 'large', reason: 'Cancelled' });
        state.onTheBubble = false;
        state.format = null;
        state.cancelledCount += 1;
        host = hostSay(`Cancelled. ${Math.round(ratings)}% and the bar was ${threshold}%. You're written out live — gloriously, the crowd's on its feet, half of them crying. Your Legacy burns. You can be rebooted at a lower tier: same soul, new season.`);
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

  console.log(`      🎪 Curiouser Economy mod loaded (Ratings/Favor/Legacy + Episode stakes)`);
};
