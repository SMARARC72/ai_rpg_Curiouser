/*
 * Curiouser Workshop — "The Prop Department" (looting · crafting · building).
 * ------------------------------------------------------------------------
 * An integrated economy layered on top of the engine's Thing/craft systems,
 * built entirely through the mod scope API (no core changes):
 *
 *   LOOT  — salvage any inventory item into a ledger of crafting PARTS
 *           (deterministic yield by rarity) plus a little Ink; appraise loot.
 *   CRAFT — a data-driven RECIPE BOOK (parts + Ink + station -> a real gear
 *           Thing in your inventory) AND emergent EXPERIMENTS (spend parts ->
 *           a surprising Curiouser prop, with a chance to discover a recipe).
 *   BUILD — construct persistent in-world STRUCTURES (real scenery Things
 *           placed in the current location, some functional as stations) and
 *           build/upgrade a persistent GREEN ROOM base (workbench, prop vault
 *           that stores loot across Episodes, fabricator, applause sign) whose
 *           state survives between worlds.
 *
 * Deterministic and testable: parts/Ink/base/vault are mod-owned state
 * (data/workshop-state.json). Items are real engine Things, so they show up in
 * the normal inventory and interact with the rest of the game. The Host speaks
 * every result (the Host is the HUD).
 *
 * Routes (all under /api/mods/curiouser-workshop/...):
 *   GET  /state                current parts, Ink, base, recipe book, vault
 *   POST /salvage   {thingId}  break an inventory item into parts + Ink
 *   POST /appraise             total Ink value of your inventory
 *   POST /craft     {recipeId} spend parts+Ink at a station -> gear Thing
 *   POST /experiment           spend random parts -> emergent prop (+maybe a recipe)
 *   POST /build     {structureId}  build persistent scenery in the current room
 *   POST /base/upgrade {station}   build/upgrade a Green Room station
 *   POST /base/applause            spend Ink to crank Audience Favor
 *   POST /vault/store   {thingId}  stash an item in the cross-Episode Prop Vault
 *   POST /vault/withdraw {index}   pull an item back out of the vault
 */

const fs = require('fs');
const path = require('path');

module.exports.meta = {
  name: 'Curiouser Workshop',
  version: '1.0.0',
  description: 'The Prop Department: salvage loot into parts, craft gear from recipes or experiments, and build in-world structures + an upgradable Green Room base.'
};

// ---- Parts ledger ----------------------------------------------------------
const PARTS = ['scrap', 'spring', 'wire', 'lens', 'cog', 'spark', 'cloth', 'inkcell'];
const PART_LABEL = {
  scrap: 'Scrap', spring: 'Spring', wire: 'Wire', lens: 'Lens',
  cog: 'Cog', spark: 'Spark', cloth: 'Cloth', inkcell: 'Ink-Cell'
};

// Deterministic salvage yield + Ink refund by rarity tier.
const SALVAGE_YIELDS = {
  junk: { scrap: 1 },
  common: { scrap: 2 },
  uncommon: { scrap: 2, wire: 1 },
  rare: { scrap: 2, spring: 1, cog: 1 },
  epic: { scrap: 3, cog: 1, lens: 1, spark: 1 },
  legendary: { scrap: 4, cog: 2, lens: 1, spark: 2, inkcell: 1 },
  artifact: { scrap: 5, cog: 2, lens: 2, spark: 2, cloth: 1, inkcell: 2 }
};
const SALVAGE_INK = { junk: 1, common: 3, uncommon: 6, rare: 12, epic: 25, legendary: 50, artifact: 100 };

// ---- Recipe book (data-driven crafting) ------------------------------------
// station: which base station is required. tier: required station level.
const RECIPES = [
  { id: 'grappling_line', name: 'Grappling Line', station: 'workbench', tier: 1, ink: 10,
    parts: { wire: 2, cog: 1 },
    out: { itemType: 'tool', rarity: 'common', description: 'Reach the unreachable. One good yank and you\'re somewhere you shouldn\'t be.' } },
  { id: 'smoke_prop', name: 'Smoke Bomb (Prop)', station: 'workbench', tier: 1, ink: 8,
    parts: { scrap: 1, spark: 1, cloth: 1 },
    out: { itemType: 'consumable', rarity: 'common', description: 'Exit, stage left. A theatrical puff that buys you one clean getaway.' } },
  { id: 'stun_baton', name: 'Stun Baton', station: 'workbench', tier: 1, ink: 15,
    parts: { scrap: 2, spark: 2, spring: 1 },
    out: { itemType: 'weapon', rarity: 'uncommon', attributeBonuses: [{ attribute: 'strength', bonus: 1 }],
      description: 'Politely ends arguments. Sponsored, probably.' } },
  { id: 'prop_toolbelt', name: 'Prop Toolbelt', station: 'workbench', tier: 1, ink: 12,
    parts: { cloth: 2, scrap: 2, spring: 1 },
    out: { itemType: 'armor', slot: 'waist', rarity: 'uncommon', attributeBonuses: [{ attribute: 'dexterity', bonus: 1 }],
      description: 'Everything a contestant needs, jangling at the hip.' } },
  { id: 'pocket_understudy', name: 'Pocket Understudy', station: 'workbench', tier: 2, ink: 18,
    parts: { cloth: 2, wire: 1, cog: 1 },
    out: { itemType: 'consumable', rarity: 'rare', description: 'A tiny stand-in who takes exactly one hit for you, then bows out.' } },
  { id: 'audience_horn', name: 'Audience Horn', station: 'workbench', tier: 2, ink: 20,
    parts: { scrap: 2, spring: 1, inkcell: 1 },
    out: { itemType: 'tool', rarity: 'rare', description: 'Crank the applause. The crowd loves a loud prop and hates a quiet contestant.' } },
  { id: 'lucky_lens', name: 'Lucky Lens', station: 'fabricator', tier: 1, ink: 25,
    parts: { lens: 2, cog: 1, inkcell: 1 },
    out: { itemType: 'accessory', slot: 'eyes', rarity: 'epic', attributeBonuses: [{ attribute: 'wisdom', bonus: 2 }],
      description: 'See the House Rule for what it is — a loophole with good lighting.' } },
  { id: 'format_key', name: 'Format Key', station: 'fabricator', tier: 1, ink: 60,
    parts: { lens: 2, cog: 2, spark: 2, inkcell: 2 },
    out: { itemType: 'tool', rarity: 'legendary', description: 'Nudges the Episode\'s House Rule exactly once. Do NOT lose this before you mean it.' } }
];
// Secret recipes discoverable only via experiments.
const SECRET_RECIPES = [
  { id: 'crocodile_whistle', name: 'Crocodile Whistle', station: 'workbench', tier: 1, ink: 14,
    parts: { spring: 1, spark: 1, inkcell: 1 }, secret: true,
    out: { itemType: 'tool', rarity: 'rare', description: 'The Audience voted the door into a crocodile once. This calls it back.' } }
];

// ---- Experiment outcome pool (emergent) ------------------------------------
const EXPERIMENT_ITEMS = [
  { name: 'Card That Cuts Once', rarity: 'uncommon', itemType: 'weapon', description: 'A playing card with exactly one lethal edge. Choose your moment.' },
  { name: 'Bottled Groan', rarity: 'common', itemType: 'consumable', description: 'The Audience\'s disappointment, corked. Uncork near a rival.' },
  { name: 'Left Shoe of Certainty', rarity: 'uncommon', itemType: 'armor', slot: 'feet', description: 'You cannot be talked out of anything while wearing it. Only the left.' },
  { name: 'Applause In A Can', rarity: 'rare', itemType: 'consumable', description: 'Instant, canned, slightly stale approval. The crowd can\'t tell.' },
  { name: 'Honest Mirror', rarity: 'rare', itemType: 'accessory', slot: 'eyes', description: 'Shows the House Rule\'s reflection. Unflattering. Useful.' },
  { name: 'Pocket Gravity', rarity: 'epic', itemType: 'tool', description: 'A jar of the room\'s sincerity. Pour where you need to fall — or not.' }
];

// ---- In-world structures (persistent scenery placed in the location) -------
const STRUCTURES = [
  { id: 'field_workbench', name: 'Field Workbench', ink: 10, parts: { scrap: 3, cog: 1 },
    isCraftingStation: true, description: 'A rickety bench of salvage and spite. Good enough to build on, right here.' },
  { id: 'barricade', name: 'Barricade', ink: 8, parts: { scrap: 3, spring: 1 },
    description: 'Blocks the way. Mostly. The Audience respects a good chokepoint.' },
  { id: 'trap_door', name: 'Trap Door', ink: 15, parts: { scrap: 2, spring: 2, cog: 1 },
    description: 'For rivals who overstay their scene. One dramatic drop.' },
  { id: 'signal_tower', name: 'Signal Tower', ink: 20, parts: { scrap: 4, wire: 2, spark: 1 },
    description: 'Call the Audience down on this exact spot. Ratings weather permitting.' },
  { id: 'prop_recycler', name: 'Prop Recycler', ink: 18, parts: { scrap: 3, cog: 1, wire: 1 },
    isHarvestable: true, description: 'Feed it junk, harvest parts. The show is nothing if not sustainable.' }
];

// ---- Green Room base stations ---------------------------------------------
const BASE_STATIONS = {
  workbench: { name: 'Workbench', maxLevel: 3, base: { ink: 20, scrap: 4 },
    blurb: 'Raises the tier of gear you can fabricate.' },
  vault: { name: 'Prop Vault', maxLevel: 3, base: { ink: 25, scrap: 3, cloth: 1 },
    blurb: 'Stores props across Episodes. +4 slots per level.' },
  fabricator: { name: 'Fabricator', maxLevel: 1, base: { ink: 80, cog: 3, lens: 2, inkcell: 2 },
    blurb: 'Unlocks advanced (fabricator-tier) recipes.' },
  applause: { name: 'Applause Sign', maxLevel: 3, base: { ink: 30, wire: 2, spark: 1 },
    blurb: 'Lets you crank Audience Favor on demand (stronger per level).' },
  panic: { name: 'Panic Room', maxLevel: 1, base: { ink: 120, scrap: 6, cog: 3, inkcell: 3 },
    blurb: 'Holds one Reboot Insurance — a soft landing if you\'re Cancelled.' }
};

const RARITIES = ['junk', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'artifact'];
function normRarity(r) {
  const v = typeof r === 'string' ? r.trim().toLowerCase() : '';
  return RARITIES.indexOf(v) >= 0 ? v : 'common';
}
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

module.exports.register = function register(scope) {
  const { modDir, modName, registerModRoute, Thing, Location, things, gameLocations, sanitizeMetadataObject } = scope;

  const dataDir = path.join(modDir, 'data');
  const stateFile = path.join(dataDir, 'workshop-state.json');

  function defaultState() {
    const parts = {};
    PARTS.forEach(p => { parts[p] = 0; });
    return {
      parts,
      base: { stations: { workbench: 1, vault: 0, fabricator: 0, applause: 0, panic: 0 } },
      discoveredRecipes: [],
      vault: []
    };
  }
  function loadState() {
    try {
      if (fs.existsSync(stateFile)) {
        const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        const s = defaultState();
        if (parsed && typeof parsed === 'object') {
          if (parsed.parts) PARTS.forEach(p => { if (Number.isFinite(parsed.parts[p])) s.parts[p] = parsed.parts[p]; });
          if (parsed.base && parsed.base.stations) Object.keys(s.base.stations).forEach(k => {
            if (Number.isFinite(parsed.base.stations[k])) s.base.stations[k] = parsed.base.stations[k];
          });
          if (Array.isArray(parsed.discoveredRecipes)) s.discoveredRecipes = parsed.discoveredRecipes.slice(0);
          if (Array.isArray(parsed.vault)) s.vault = parsed.vault.slice(0);
        }
        return s;
      }
    } catch (err) {
      console.warn(`[${modName}] Failed to read state, resetting:`, err.message);
    }
    return defaultState();
  }
  function saveState() {
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch (err) {
      console.warn(`[${modName}] Failed to save state:`, err.message);
    }
  }

  let state = loadState();

  // ---- helpers -------------------------------------------------------------
  function activePlayer() { return scope.currentPlayer || null; }
  function requireGame(res) {
    const p = activePlayer();
    if (!p) { res.status(409).json({ success: false, error: 'No active game — start or load a Curiouser game first.' }); return null; }
    return p;
  }
  function hostSay(text) {
    const p = activePlayer();
    const locationId = p && p.currentLocation;
    if (typeof scope.pushChatEntry === 'function' && locationId) {
      try { scope.pushChatEntry({ role: 'assistant', type: 'event-summary', content: text }, null, locationId); }
      catch (err) { console.warn(`[${modName}] Could not push Host line:`, err.message); }
    }
    return text;
  }
  function inkOf(p) { return typeof p.getCurrency === 'function' ? (p.getCurrency() || 0) : (typeof p.currency === 'number' ? p.currency : 0); }
  function partsCan(cost) { return Object.keys(cost || {}).every(k => (state.parts[k] || 0) >= cost[k]); }
  function partsSpend(cost) { Object.keys(cost || {}).forEach(k => { state.parts[k] = (state.parts[k] || 0) - cost[k]; }); }
  function partsAdd(gain) { Object.keys(gain || {}).forEach(k => { if (PARTS.indexOf(k) >= 0) state.parts[k] = (state.parts[k] || 0) + gain[k]; }); }
  function fmtCost(cost, ink) {
    const bits = Object.keys(cost || {}).map(k => `${cost[k]} ${PART_LABEL[k] || k}`);
    if (ink) bits.unshift(`${ink} Ink`);
    return bits.join(' + ') || 'nothing';
  }
  function inventoryItems(p) {
    if (typeof p.getInventoryItems === 'function') return p.getInventoryItems() || [];
    return [];
  }
  function invItemById(p, id) { return inventoryItems(p).find(t => t && t.id === id) || null; }
  function itemValue(t) { const m = t && t.metadata; return m && Number.isFinite(m.value) ? m.value : 0; }
  function itemRarity(t) { return normRarity(t && (t.rarity || (t.metadata && t.metadata.rarity))); }
  function currentLocation(p) {
    const id = p && p.currentLocation;
    if (!id) return null;
    if (gameLocations && typeof gameLocations.get === 'function' && gameLocations.get(id)) return gameLocations.get(id);
    if (Location && typeof Location.get === 'function') return Location.get(id) || null;
    return null;
  }

  // Build a real engine Thing from a compact blueprint and register it.
  function makeThing(bp, ownerId, locationId) {
    const attributeBonuses = Array.isArray(bp.attributeBonuses) && bp.attributeBonuses.length ? bp.attributeBonuses : null;
    const meta = (typeof sanitizeMetadataObject === 'function' ? sanitizeMetadataObject : (x) => x)({
      rarity: bp.rarity || null,
      itemType: bp.itemType || null,
      value: Number.isFinite(bp.value) ? bp.value : null,
      properties: bp.properties || null,
      attributeBonuses: attributeBonuses || undefined,
      ownerId: ownerId || undefined,
      locationId: locationId || undefined
    });
    const thing = new Thing({
      name: bp.name,
      description: bp.description || '',
      shortDescription: bp.shortDescription || null,
      thingType: bp.thingType || 'item',
      rarity: bp.rarity || null,
      itemTypeDetail: bp.itemType || null,
      slot: bp.slot || null,
      attributeBonuses: attributeBonuses,
      level: Number.isFinite(bp.level) ? bp.level : null,
      metadata: meta,
      isCraftingStation: !!bp.isCraftingStation,
      isProcessingStation: !!bp.isProcessingStation,
      isHarvestable: !!bp.isHarvestable,
      isSalvageable: bp.isSalvageable !== false
    });
    if (things && typeof things.set === 'function') things.set(thing.id, thing);
    return thing;
  }

  function stationLevel(station) { return (state.base && state.base.stations && state.base.stations[station]) || 0; }
  function allRecipes() { return RECIPES.concat(SECRET_RECIPES.filter(r => state.discoveredRecipes.indexOf(r.id) >= 0)); }
  function recipeCraftable(r) {
    if (stationLevel(r.station) < r.tier) return false;
    if (inkForRecipe(r) > 0 && activePlayer() && inkOf(activePlayer()) < r.ink) return false;
    return partsCan(r.parts);
  }
  function inkForRecipe(r) { return Number.isFinite(r.ink) ? r.ink : 0; }

  function serializeState(p) {
    const recipes = allRecipes().map(r => ({
      id: r.id, name: r.name, station: r.station, tier: r.tier, ink: r.ink, parts: r.parts,
      rarity: r.out && r.out.rarity, itemType: r.out && r.out.itemType,
      description: r.out && r.out.description,
      craftable: p ? recipeCraftable(r) : false
    }));
    return {
      success: true,
      parts: state.parts,
      partOrder: PARTS,
      partLabels: PART_LABEL,
      ink: p ? inkOf(p) : null,
      base: state.base,
      stationInfo: BASE_STATIONS,
      recipes,
      structures: STRUCTURES.map(s => ({ id: s.id, name: s.name, ink: s.ink, parts: s.parts, description: s.description,
        buildable: p ? (inkOf(p) >= s.ink && partsCan(s.parts)) : false })),
      vault: state.vault.map((v, i) => ({ index: i, name: v.name, rarity: v.rarity || (v.metadata && v.metadata.rarity) || 'common' })),
      vaultSlots: stationLevel('vault') * 4
    };
  }

  // ---- routes --------------------------------------------------------------

  // GET /state
  registerModRoute('get', '/state', (req, res) => {
    res.json(serializeState(activePlayer()));
  });

  // POST /appraise — total Ink value of inventory
  registerModRoute('post', '/appraise', (req, res) => {
    const p = requireGame(res); if (!p) return;
    const items = inventoryItems(p);
    const total = items.reduce((sum, t) => sum + itemValue(t), 0);
    const host = hostSay(`Appraisal: ${items.length} prop${items.length === 1 ? '' : 's'} on you, worth about ${total} Ink at the door. Salvage the dead weight into parts.`);
    res.json({ success: true, count: items.length, totalValue: total, host });
  });

  // POST /salvage {thingId} — break an item into parts + Ink
  registerModRoute('post', '/salvage', (req, res) => {
    const p = requireGame(res); if (!p) return;
    const thingId = req.body && req.body.thingId;
    const item = thingId ? invItemById(p, thingId) : null;
    if (!item) return res.status(404).json({ success: false, error: 'That prop is not in your inventory.' });

    const rarity = itemRarity(item);
    const yields = SALVAGE_YIELDS[rarity] || SALVAGE_YIELDS.common;
    const ink = SALVAGE_INK[rarity] || 0;
    partsAdd(yields);
    if (ink && typeof p.adjustCurrency === 'function') p.adjustCurrency(ink);

    const name = item.name || 'the prop';
    try { Thing.removeFromWorldById(item.id); } catch (e) {}
    if (typeof p.removeInventoryItem === 'function') { try { p.removeInventoryItem(item); } catch (e) {} }
    if (things && typeof things.delete === 'function') things.delete(item.id);
    saveState();

    const gained = Object.keys(yields).map(k => `${yields[k]} ${PART_LABEL[k]}`).join(', ');
    const host = hostSay(`Into the recycler goes ${name} — ${rarity}. Out comes ${gained}${ink ? ` and ${ink} Ink` : ''}. Nothing is wasted on this show. Nothing.`);
    res.json({ success: true, salvaged: name, rarity, parts: yields, ink, state: serializeState(p), host });
  });

  // POST /craft {recipeId} — spend parts+Ink at a station -> gear Thing
  registerModRoute('post', '/craft', (req, res) => {
    const p = requireGame(res); if (!p) return;
    const recipeId = req.body && req.body.recipeId;
    const recipe = allRecipes().find(r => r.id === recipeId);
    if (!recipe) return res.status(404).json({ success: false, error: 'No such recipe (or it isn\'t discovered yet).' });
    if (stationLevel(recipe.station) < recipe.tier) {
      const st = BASE_STATIONS[recipe.station];
      return res.status(409).json({ success: false, error: `Needs ${st ? st.name : recipe.station} level ${recipe.tier}. Build it in your Green Room first.` });
    }
    if (inkForRecipe(recipe) > 0 && inkOf(p) < recipe.ink) {
      return res.status(409).json({ success: false, error: `Not enough Ink — ${recipe.name} costs ${recipe.ink}.` });
    }
    if (!partsCan(recipe.parts)) {
      return res.status(409).json({ success: false, error: `Short on parts for ${recipe.name}: needs ${fmtCost(recipe.parts)}.` });
    }
    partsSpend(recipe.parts);
    if (recipe.ink && typeof p.adjustCurrency === 'function') p.adjustCurrency(-recipe.ink);
    saveState();

    const bp = Object.assign({ name: recipe.name, thingType: 'item', level: p.level || 1 }, recipe.out);
    const thing = makeThing(bp, p.id, null);
    if (typeof p.addInventoryItem === 'function') p.addInventoryItem(thing, { suppressNpcEquip: true });

    const host = hostSay(`Fabricated: ${recipe.name}. Cost you ${fmtCost(recipe.parts, recipe.ink)}. It\'s in your hands — try to look like you meant to make it.`);
    res.json({ success: true, crafted: { id: thing.id, name: recipe.name, rarity: bp.rarity }, state: serializeState(p), host });
  });

  // POST /experiment — spend random parts -> emergent prop (+maybe a recipe)
  registerModRoute('post', '/experiment', (req, res) => {
    const p = requireGame(res); if (!p) return;
    const owned = PARTS.filter(k => (state.parts[k] || 0) > 0);
    if (owned.length < 2) {
      return res.status(409).json({ success: false, error: 'Need at least two kinds of parts to experiment — go salvage some props.' });
    }
    // Spend 2-3 random owned parts.
    const spendCount = Math.min(owned.length, 2 + Math.floor(Math.random() * 2));
    const spent = {};
    const shuffled = owned.slice();
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t; }
    for (let i = 0; i < spendCount; i++) { spent[shuffled[i]] = 1; }
    partsSpend(spent);

    const roll = Math.random();
    let host, result = null, discovered = null;
    if (roll < 0.15) {
      // Backfire — parts gone, a laugh.
      host = hostSay(`The bench sparks, sulks, and produces… smoke and a faint smell of regret. ${fmtCost(spent)} gone. The Audience adored it.`);
    } else {
      const bp = Object.assign({ thingType: 'item', level: p.level || 1 }, pick(EXPERIMENT_ITEMS));
      const thing = makeThing(bp, p.id, null);
      if (typeof p.addInventoryItem === 'function') p.addInventoryItem(thing, { suppressNpcEquip: true });
      result = { id: thing.id, name: bp.name, rarity: bp.rarity };
      // Chance to discover a secret recipe.
      const undiscovered = SECRET_RECIPES.filter(r => state.discoveredRecipes.indexOf(r.id) < 0);
      if (undiscovered.length && Math.random() < 0.25) {
        discovered = pick(undiscovered);
        state.discoveredRecipes.push(discovered.id);
        host = hostSay(`Experiment yields: ${bp.name}! And — hello — you\'ve worked out how to make a ${discovered.name}. New recipe, on the house.`);
      } else {
        host = hostSay(`Experiment yields: ${bp.name}. Nobody knows how. That\'s showbusiness. Cost: ${fmtCost(spent)}.`);
      }
    }
    saveState();
    res.json({ success: true, spent, result, discovered: discovered ? { id: discovered.id, name: discovered.name } : null, state: serializeState(p), host });
  });

  // POST /build {structureId} — persistent scenery in the current room
  registerModRoute('post', '/build', (req, res) => {
    const p = requireGame(res); if (!p) return;
    const structureId = req.body && req.body.structureId;
    const s = STRUCTURES.find(x => x.id === structureId);
    if (!s) return res.status(404).json({ success: false, error: 'No such structure.' });
    const loc = currentLocation(p);
    if (!loc || typeof loc.addThingId !== 'function') {
      return res.status(409).json({ success: false, error: 'No buildable location right now — you need to be somewhere on-set.' });
    }
    if (inkOf(p) < s.ink) return res.status(409).json({ success: false, error: `Not enough Ink — ${s.name} costs ${s.ink}.` });
    if (!partsCan(s.parts)) return res.status(409).json({ success: false, error: `Short on parts for ${s.name}: needs ${fmtCost(s.parts)}.` });

    partsSpend(s.parts);
    if (typeof p.adjustCurrency === 'function') p.adjustCurrency(-s.ink);
    saveState();

    const thing = makeThing({
      name: s.name, description: s.description, thingType: 'scenery', rarity: 'common',
      isCraftingStation: s.isCraftingStation, isProcessingStation: s.isProcessingStation, isHarvestable: s.isHarvestable,
      isSalvageable: false
    }, null, loc.id);
    try { loc.addThingId(thing.id); } catch (e) {}

    const host = hostSay(`Built on-set: ${s.name}. ${s.description} It stays right here — the set remembers. Cost: ${fmtCost(s.parts, s.ink)}.`);
    res.json({ success: true, built: { id: thing.id, name: s.name, locationId: loc.id }, state: serializeState(p), host });
  });

  // POST /base/upgrade {station} — build/upgrade a Green Room station
  registerModRoute('post', '/base/upgrade', (req, res) => {
    const p = requireGame(res); if (!p) return;
    const station = req.body && req.body.station;
    const info = BASE_STATIONS[station];
    if (!info) return res.status(404).json({ success: false, error: 'No such Green Room station.' });
    const current = stationLevel(station);
    if (current >= info.maxLevel) return res.status(409).json({ success: false, error: `${info.name} is already maxed (level ${current}).` });

    const target = current + 1;
    const inkCost = info.base.ink * target;
    const partsCost = {};
    Object.keys(info.base).forEach(k => { if (k !== 'ink') partsCost[k] = info.base[k] * target; });
    if (inkOf(p) < inkCost) return res.status(409).json({ success: false, error: `Not enough Ink — that upgrade costs ${inkCost}.` });
    if (!partsCan(partsCost)) return res.status(409).json({ success: false, error: `Short on parts: needs ${fmtCost(partsCost)}.` });

    partsSpend(partsCost);
    if (typeof p.adjustCurrency === 'function') p.adjustCurrency(-inkCost);
    state.base.stations[station] = target;
    saveState();

    const host = hostSay(`Green Room upgrade: ${info.name} is now level ${target}. ${info.blurb} The trailer\'s looking almost respectable.`);
    res.json({ success: true, station, level: target, state: serializeState(p), host });
  });

  // POST /base/applause — spend Ink to crank Audience Favor (needs Applause Sign)
  registerModRoute('post', '/base/applause', (req, res) => {
    const p = requireGame(res); if (!p) return;
    const lvl = stationLevel('applause');
    if (lvl < 1) return res.status(409).json({ success: false, error: 'Build an Applause Sign in your Green Room first.' });
    const cost = 15;
    if (inkOf(p) < cost) return res.status(409).json({ success: false, error: `Cranking the sign costs ${cost} Ink.` });
    if (typeof p.adjustCurrency === 'function') p.adjustCurrency(-cost);
    const magnitude = lvl >= 3 ? 'large' : (lvl >= 2 ? 'medium' : 'small');
    let applied = false;
    if (typeof p.applyNeedBarChange === 'function') {
      try { p.applyNeedBarChange('audience_favor', { direction: 'increase', magnitude, reason: 'Applause Sign' }); applied = true; } catch (e) {}
    }
    saveState();
    const host = hostSay(`You crank the Applause Sign. The crowd obliges — ${magnitude} swell of love, ${cost} Ink well spent. Milk it.`);
    res.json({ success: true, applied, magnitude, host });
  });

  // POST /vault/store {thingId} — stash an item across Episodes
  registerModRoute('post', '/vault/store', (req, res) => {
    const p = requireGame(res); if (!p) return;
    const slots = stationLevel('vault') * 4;
    if (slots <= 0) return res.status(409).json({ success: false, error: 'Build a Prop Vault in your Green Room first.' });
    if (state.vault.length >= slots) return res.status(409).json({ success: false, error: `Vault is full (${slots} slots). Upgrade it or withdraw something.` });
    const thingId = req.body && req.body.thingId;
    const item = thingId ? invItemById(p, thingId) : null;
    if (!item) return res.status(404).json({ success: false, error: 'That prop is not in your inventory.' });

    const snapshot = typeof item.toJSON === 'function' ? item.toJSON() : { name: item.name };
    state.vault.push(snapshot);
    try { Thing.removeFromWorldById(item.id); } catch (e) {}
    if (typeof p.removeInventoryItem === 'function') { try { p.removeInventoryItem(item); } catch (e) {} }
    if (things && typeof things.delete === 'function') things.delete(item.id);
    saveState();

    const host = hostSay(`Into the Prop Vault: ${item.name}. Safe across Episodes — even a Cancellation can\'t take what\'s in the vault. ${state.vault.length}/${slots} slots.`);
    res.json({ success: true, stored: item.name, state: serializeState(p), host });
  });

  // POST /vault/withdraw {index} — pull an item back out
  registerModRoute('post', '/vault/withdraw', (req, res) => {
    const p = requireGame(res); if (!p) return;
    const index = req.body && Number(req.body.index);
    if (!Number.isInteger(index) || index < 0 || index >= state.vault.length) {
      return res.status(404).json({ success: false, error: 'No prop in that vault slot.' });
    }
    const snapshot = state.vault[index];
    let thing;
    try { thing = new Thing(snapshot); } catch (e) { return res.status(500).json({ success: false, error: 'That prop got tangled on the way out of the vault.' }); }
    if (snapshot && snapshot.metadata) { try { thing.metadata = Object.assign({}, snapshot.metadata, { ownerId: p.id, locationId: undefined }); } catch (e) {} }
    if (things && typeof things.set === 'function') things.set(thing.id, thing);
    if (typeof p.addInventoryItem === 'function') p.addInventoryItem(thing, { suppressNpcEquip: true });
    state.vault.splice(index, 1);
    saveState();

    const host = hostSay(`Back out of the vault: ${thing.name || 'your prop'}. Try not to lose it on-air this time.`);
    res.json({ success: true, withdrawn: thing.name, state: serializeState(p), host });
  });

  console.log('      🔧 Curiouser Workshop mod loaded (loot · craft · build)');
};
