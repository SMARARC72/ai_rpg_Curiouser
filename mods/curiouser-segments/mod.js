/*
 * Curiouser Segments — structured gameshow "rounds" per Episode.
 * ------------------------------------------------------------------------
 * Freeform play gets a spine: each Episode runs timed SEGMENTS with a clear
 * objective and an Ink/Ratings/Favor payoff, themed off the active Format and
 * House Rule (read from the economy mod's getActiveEpisode bridge). Objectives
 * are all meter-verifiable each turn, so completion/failure is deterministic —
 * no LLM adjudication:
 *
 *   ratings  — spike Ratings to a target by the deadline
 *   ink      — bank a chunk of Ink by the deadline
 *   favor    — win the Audience (raise Audience Favor) by the deadline
 *   hold     — keep Ratings above a floor for the whole segment (bomb = fail)
 *   survive  — just keep the scene alive to the cut
 *
 * Clear a segment for the reward; miss the deadline (or bomb a hold) for the
 * penalty. A new segment opens when the Episode rolls or after a short cooldown.
 * The Host announces and scores every segment; a Segment panel shows progress.
 *
 * Routes:  GET /state    active segment + progress
 *          POST /tick     advance one turn; returns beats
 */

const fs = require('fs');
const path = require('path');

module.exports.meta = {
  name: 'Curiouser Segments',
  version: '1.0.0',
  description: 'Timed per-Episode gameshow rounds with Ink/Ratings/Favor payoffs, verified from the meters.'
};

const SEGMENTS = [
  { id: 'primetime', type: 'ratings', name: 'Prime-Time Push', duration: 6, delta: 15,
    objective: 'Spike your Ratings — the network wants a moment.',
    reward: { ink: 30, ratings: 'medium' }, penalty: { ratings: 'small' } },
  { id: 'scramble', type: 'ink', name: 'Sponsorship Scramble', duration: 6, amount: 40,
    objective: 'Bank Ink before the break — hustle it however you can.',
    reward: { ratings: 'small', favor: 'small' }, penalty: { favor: 'small' } },
  { id: 'crowdwork', type: 'favor', name: 'Work the Crowd', duration: 5, delta: 15,
    objective: 'Win the Audience over — make them love you.',
    reward: { ink: 25, favor: 'medium' }, penalty: { favor: 'small' } },
  { id: 'holdframe', type: 'hold', name: 'Hold the Frame', duration: 6, floor: 40,
    objective: 'Keep your Ratings above the line — do not bomb.',
    reward: { ink: 30, ratings: 'small' }, penalty: { ratings: 'medium' } },
  { id: 'longtake', type: 'survive', name: 'The Long Take', duration: 5,
    objective: 'Just keep the scene alive — survive to the cut.',
    reward: { ink: 20, ratings: 'small' }, penalty: {} }
];

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

module.exports.register = function register(scope) {
  const { modDir, modName, registerModRoute } = scope;
  const dataDir = path.join(modDir, 'data');
  const stateFile = path.join(dataDir, 'segments-state.json');

  function defaultState() { return { turn: 0, active: null, cooldownUntil: 0, lastEpisode: 0 }; }
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
  function meter(p, id, dflt) { try { const v = p.getNeedBarValue(id); return Number.isFinite(v) ? v : dflt; } catch (e) { return dflt; } }
  function currencyOf(p) { return typeof p.getCurrency === 'function' ? (p.getCurrency() || 0) : (typeof p.currency === 'number' ? p.currency : 0); }
  function bar(p, id, dir, mag, reason) { try { if (typeof p.applyNeedBarChange === 'function') p.applyNeedBarChange(id, { direction: dir, magnitude: mag, reason }); } catch (e) {} }
  function activeEpisode() { try { return (global.CURIOUSER_HOOKS && typeof global.CURIOUSER_HOOKS.getActiveEpisode === 'function') ? global.CURIOUSER_HOOKS.getActiveEpisode() : null; } catch (e) { return null; } }

  function applyReward(p, reward) {
    if (!reward) return;
    if (reward.ink && typeof p.adjustCurrency === 'function') p.adjustCurrency(reward.ink);
    if (reward.ratings) bar(p, 'ratings', 'increase', reward.ratings, 'Segment cleared');
    if (reward.favor) bar(p, 'audience_favor', 'increase', reward.favor, 'Segment cleared');
  }
  function applyPenalty(p, penalty) {
    if (!penalty) return;
    if (penalty.ratings) bar(p, 'ratings', 'decrease', penalty.ratings, 'Segment failed');
    if (penalty.favor) bar(p, 'audience_favor', 'decrease', penalty.favor, 'Segment failed');
  }
  function rewardStr(reward) {
    const bits = [];
    if (reward.ink) bits.push(`${reward.ink} Ink`);
    if (reward.ratings) bits.push('Ratings');
    if (reward.favor) bits.push('Audience Favor');
    return bits.join(' + ') || 'bragging rights';
  }

  function startSegment(p) {
    const tmpl = pick(SEGMENTS);
    const ratings = meter(p, 'ratings', 50);
    const favor = meter(p, 'audience_favor', 50);
    const seg = {
      id: tmpl.id, type: tmpl.type, name: tmpl.name, objective: tmpl.objective,
      startTurn: state.turn, deadline: state.turn + tmpl.duration,
      reward: tmpl.reward, penalty: tmpl.penalty
    };
    if (tmpl.type === 'ratings') { seg.baseline = ratings; seg.target = Math.min(100, ratings + tmpl.delta); }
    else if (tmpl.type === 'favor') { seg.baseline = favor; seg.target = Math.min(100, favor + tmpl.delta); }
    else if (tmpl.type === 'ink') { seg.baselineCurrency = currencyOf(p); seg.amount = tmpl.amount; }
    else if (tmpl.type === 'hold') { seg.floor = tmpl.floor; }
    state.active = seg;
    const ep = activeEpisode();
    const format = ep && ep.format && ep.format.setting ? ` (${ep.format.setting})` : '';
    return hostSay(`🎬 SEGMENT${format}: "${seg.name}." ${seg.objective} You've got ${tmpl.duration} beats. Payoff: ${rewardStr(seg.reward)}. Go.`);
  }

  function progressOf(seg, p) {
    const cur = currencyOf(p);
    if (seg.type === 'ratings') return clamp01((meter(p, 'ratings', 0) - seg.baseline) / Math.max(1, seg.target - seg.baseline));
    if (seg.type === 'favor') return clamp01((meter(p, 'audience_favor', 0) - seg.baseline) / Math.max(1, seg.target - seg.baseline));
    if (seg.type === 'ink') return clamp01((cur - seg.baselineCurrency) / Math.max(1, seg.amount));
    // hold / survive are time-based
    return clamp01((state.turn - seg.startTurn) / Math.max(1, seg.deadline - seg.startTurn));
  }
  function isCleared(seg, p) {
    if (seg.type === 'ratings') return meter(p, 'ratings', 0) >= seg.target;
    if (seg.type === 'favor') return meter(p, 'audience_favor', 0) >= seg.target;
    if (seg.type === 'ink') return (currencyOf(p) - seg.baselineCurrency) >= seg.amount;
    if (seg.type === 'hold' || seg.type === 'survive') return state.turn >= seg.deadline;
    return false;
  }

  registerModRoute('get', '/state', (req, res) => {
    const p = player();
    let progress = null;
    if (state.active && p) progress = Math.round(progressOf(state.active, p) * 100);
    res.json({
      success: true, turn: state.turn,
      segment: state.active ? {
        name: state.active.name, objective: state.active.objective, type: state.active.type,
        turnsLeft: Math.max(0, state.active.deadline - state.turn), progress,
        reward: rewardStr(state.active.reward)
      } : null
    });
  });

  registerModRoute('post', '/tick', (req, res) => {
    const p = player();
    if (!p) return res.json({ success: true, beats: [] });
    state.turn += 1;
    const beats = [];

    if (state.active) {
      const seg = state.active;
      // Hold segments bomb the instant Ratings drop below the floor.
      if (seg.type === 'hold' && meter(p, 'ratings', 100) < seg.floor) {
        applyPenalty(p, seg.penalty);
        beats.push(hostSay(`🎬 SEGMENT FAILED: "${seg.name}." You dropped below the line and bombed on-air. ${seg.penalty.ratings ? 'Ratings take the hit.' : ''}`));
        state.active = null; state.cooldownUntil = state.turn + 2;
      } else if (isCleared(seg, p)) {
        applyReward(p, seg.reward);
        beats.push(hostSay(`🎬 SEGMENT CLEARED: "${seg.name}"! The crowd eats it up — you bank ${rewardStr(seg.reward)}. Milk the applause.`));
        state.active = null; state.cooldownUntil = state.turn + 2;
      } else if (state.turn >= seg.deadline) {
        applyPenalty(p, seg.penalty);
        beats.push(hostSay(`🎬 SEGMENT MISSED: "${seg.name}." Time's up and you didn't land it. ${seg.penalty && (seg.penalty.ratings || seg.penalty.favor) ? 'That costs you.' : 'No harm, but no payoff.'}`));
        state.active = null; state.cooldownUntil = state.turn + 2;
      }
    }

    // Start a new segment on an Episode change or after the cooldown.
    if (!state.active) {
      const ep = activeEpisode();
      const epNum = ep && Number.isFinite(ep.episode) ? ep.episode : null;
      const episodeChanged = epNum !== null && epNum !== state.lastEpisode;
      if (episodeChanged) state.lastEpisode = epNum;
      const hasEpisode = ep && ep.format;
      if ((episodeChanged || state.turn >= state.cooldownUntil) && (hasEpisode || epNum === null)) {
        beats.push(startSegment(p));
      }
    }

    saveState();
    res.json({ success: true, turn: state.turn, beats });
  });

  console.log('      🎬 Curiouser Segments mod loaded (gameshow rounds)');
};
