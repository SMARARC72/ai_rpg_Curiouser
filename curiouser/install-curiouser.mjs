#!/usr/bin/env node
/**
 * install-curiouser.mjs
 *
 * Milestone 1 (reskin as data) installer. Stages the Curiouser reskin assets
 * into the engine's runtime directories and enables the lorebook.
 *
 * What it does (idempotent):
 *   1. Copies curiouser/setting/curiouser.setting.json -> saves/settings/<name>_<id>.json
 *      (the dir SettingInfo.loadAll() and POST /api/settings/load read from).
 *   2. Copies curiouser/lorebooks/curiouser-wonderland.json -> lorebooks/.
 *   3. Merges the lorebook filename into lorebooks/lorebook-state.json {enabled:[...]}
 *      (lorebooks are disabled by default).
 *   4. Validates the Setting JSON by constructing a real SettingInfo (fails loudly).
 *
 * It does NOT talk to a running server. The engine does not auto-load
 * saves/settings at boot, so after staging you must register + apply the
 * setting once (printed at the end).
 *
 * Usage:  node curiouser/install-curiouser.mjs
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineRoot = path.resolve(__dirname, '..');

const settingSrc = path.join(__dirname, 'setting', 'curiouser.setting.json');
const lorebookSrc = path.join(__dirname, 'lorebooks', 'curiouser-wonderland.json');

const settingsDir = path.join(engineRoot, 'saves', 'settings');
const lorebooksDir = path.join(engineRoot, 'lorebooks');
const lorebookStateFile = path.join(lorebooksDir, 'lorebook-state.json');

function log(msg) { console.log(`[install-curiouser] ${msg}`); }

// --- 1 & 4. Validate the Setting JSON by constructing a real SettingInfo ---
const settingRaw = fs.readFileSync(settingSrc, 'utf8');
const settingData = JSON.parse(settingRaw);
const SettingInfo = require(path.join(engineRoot, 'SettingInfo.js'));
// Constructing validates required fields and normalizes lists; throws loudly on bad data.
const setting = new SettingInfo(settingData);
log(`Validated setting "${setting.name}" (id=${setting.id}); currency=${setting.currencyName}`);

// --- 1. Stage the setting into saves/settings/ (engine naming convention) ---
fs.mkdirSync(settingsDir, { recursive: true });
const settingFilename = `${setting.name.replace(/[^a-zA-Z0-9]/g, '_')}_${setting.id}.json`;
const settingDest = path.join(settingsDir, settingFilename);
fs.writeFileSync(settingDest, JSON.stringify(setting.toJSON(), null, 2));
log(`Staged setting -> ${path.relative(engineRoot, settingDest)}`);

// --- 2. Stage the lorebook ---
fs.mkdirSync(lorebooksDir, { recursive: true });
const lorebookFilename = path.basename(lorebookSrc);
const lorebookDest = path.join(lorebooksDir, lorebookFilename);
fs.copyFileSync(lorebookSrc, lorebookDest);
log(`Staged lorebook -> ${path.relative(engineRoot, lorebookDest)}`);

// --- 3. Enable the lorebook (merge, dedupe) ---
let state = { enabled: [] };
if (fs.existsSync(lorebookStateFile)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(lorebookStateFile, 'utf8'));
    if (parsed && Array.isArray(parsed.enabled)) state = parsed;
  } catch (err) {
    throw new Error(`Existing ${path.relative(engineRoot, lorebookStateFile)} is not valid JSON: ${err.message}`);
  }
}
if (!state.enabled.includes(lorebookFilename)) state.enabled.push(lorebookFilename);
fs.writeFileSync(lorebookStateFile, JSON.stringify(state, null, 2));
log(`Enabled lorebook in ${path.relative(engineRoot, lorebookStateFile)} (enabled: ${state.enabled.join(', ')})`);

// --- Next steps ---
console.log(`
Done staging. The engine does NOT auto-load settings at boot, so register +
apply the Curiouser setting ONCE (with the server running; default port 7777,
per config.yaml 'port'):

  # Load every JSON in saves/settings/ into the in-memory registry:
  curl -X POST http://localhost:7777/api/settings/load

  # Apply Curiouser as the active setting:
  curl -X POST http://localhost:7777/api/settings/${setting.id}/apply

Or, in the browser UI: open Settings, Load saved settings, then Apply "Curiouser".
Then start a New Game while Curiouser is applied — the full setting is embedded
in the save and rehydrated on load, so the reskin sticks to that playthrough.

The lorebook is already enabled and will inject on the next server start.
`);
