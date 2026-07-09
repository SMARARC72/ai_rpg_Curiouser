/**
 * LLM-free verification for Milestone 1 (reskin as data).
 * Loads the Curiouser Setting through the real SettingInfo class and renders
 * the engine's actual base-context.xml.njk to prove the Host framing + Ink
 * currency + tone surface in the generation prompt with zero core-code edits.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const nunjucks = require(path.join(root, 'node_modules', 'nunjucks'));
const SettingInfo = require(path.join(root, 'SettingInfo.js'));

const settingData = JSON.parse(fs.readFileSync(path.join(root, 'curiouser', 'setting', 'curiouser.setting.json'), 'utf8'));
const s = new SettingInfo(settingData);

// Mirror the subset the server's buildSettingPromptContext exposes to templates.
const setting = {
  name: s.name, description: s.description, theme: s.theme, genre: s.genre,
  startingLocationType: s.startingLocationType, magicLevel: s.magicLevel, techLevel: s.techLevel,
  tone: s.tone, difficulty: s.difficulty, currencyName: s.currencyName, currencyNamePlural: s.currencyNamePlural,
  currencyValueNotes: s.currencyValueNotes, writingStyleNotes: s.writingStyleNotes,
  baseContextPreamble: s.baseContextPreamble, races: s.availableRaces, attributes: [], skills: [],
};

const env = nunjucks.configure(path.join(root, 'prompts'), { autoescape: false });

const ctx = {
  setting,
  promptType: 'game-intro',
  config: { extra_system_instructions: '' },
  rarityDefinitions: [],
  worldOutline: { regions: [] },
  factions: [],
  currentRegion: { name: 'The Green Room', description: 'Backstage.', secrets: [], locations: [], connectedRegions: [] },
  currentLocation: null,
  npcs: [],
  party: [],
  currentPlayer: {
    name: 'Contestant', description: 'A nobody.', class: 'The Straight Man', race: 'Contestant (Human)',
    currency: 25, statusEffects: [], skills: [], abilities: [], inventory: [], needs: [], currentQuests: [],
  },
  worldTime: { dateLabel: 'Day 1', timeLabel: '9:00', segment: 'morning', season: 'n/a', lighting: 'bright', hasLocalWeather: false },
  recentGameHistory: '', gameHistory: '', additionalLore: '(lorebook entries inject here)',
};

const rendered = env.render('base-context.xml.njk', ctx);

const checks = [
  ['Host framing in preamble', rendered.includes('This world is CURIOUSER')],
  ['Host named as narrator', rendered.includes("narration is delivered in the Host's voice")],
  ['Ink currency tag', rendered.includes('<currencyName>Ink</currencyName>')],
  ['Genre surfaced', rendered.includes('surreal gameshow') || rendered.includes('Surreal psychedelic gameshow')],
  ['Tone surfaced (DCC x Wonderland)', rendered.includes('Dungeon Crawler Carl')],
  ['currencyValueNotes present', rendered.includes('one-episode plot armor')],
  ['game-intro task pulled in', rendered.includes('opening narration')],
];

let ok = true;
for (const [label, pass] of checks) { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`); if (!pass) ok = false; }

console.log('\n--- rendered generationPrompt (first ~1400 chars) ---');
const gp = rendered.split('<generationPrompt>')[1] || rendered;
console.log(gp.slice(0, 1400).trim());

console.log(`\nRESULT: ${ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
process.exit(ok ? 0 : 1);
