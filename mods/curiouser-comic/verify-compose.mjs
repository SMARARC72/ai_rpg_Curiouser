/**
 * LLM-free verification for Milestone 3 (comic assembly).
 * Builds placeholder panel images and runs the mod's real composePage +
 * exportChapterHtml to prove sharp compositing (frames + caption boxes + speech
 * bubbles) and HTML chapter export produce valid output with no image backend.
 *
 * Run: node mods/curiouser-comic/verify-compose.mjs
 * Outputs: tmp/comic-page.png, tmp/comic-chapter.html
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const sharp = require(path.join(root, 'node_modules', 'sharp'));
const comic = require(path.join(__dirname, 'mod.js'));

const colors = [
  { r: 60, g: 90, b: 150 }, { r: 150, g: 70, b: 80 },
  { r: 70, g: 130, b: 90 }, { r: 150, g: 120, b: 50 }
];
async function placeholder(i) {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: colors[i % colors.length] } }).png().toBuffer();
}

const beats = [
  { caption: 'Episode 1. The Green Room hums with too-bright light.', dialogue: [{ speaker: 'Host', text: "Morning. You're on the heist desk. Try not to die adorably." }] },
  { caption: 'The pen rolls off the table and under the vault.', dialogue: [{ speaker: 'You', text: 'That is not in the format.' }] },
  { caption: 'The audience leans in. Ratings twitch upward.', dialogue: [{ speaker: 'Host', text: "Ooh. THAT'S a panel." }] },
  { caption: 'Cut to black. Cliffhanger.', dialogue: [{ speaker: 'Host', text: 'Renewed. Barely. See you next Episode.' }] }
];

let ok = true;
function check(label, pass) { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`); if (!pass) ok = false; }

const panels = [];
for (let i = 0; i < beats.length; i++) panels.push({ image: await placeholder(i), caption: beats[i].caption, dialogue: beats[i].dialogue });

// Layout sanity
const layout = comic.computeLayout(4, { panelWidth: 512, panelHeight: 384 });
check('layout is 2x2 for 4 panels (4 cells)', layout.cells.length === 4);
check('wrapText splits long text', comic.wrapText('a '.repeat(40), 20, 5).length > 1);

// Compose the page
const pageBuf = await comic.composePage(panels, { panelWidth: 512, panelHeight: 384 });
const meta = await sharp(pageBuf).metadata();
check('composed page is PNG', meta.format === 'png');
check('page dimensions match layout', meta.width === layout.pageW && meta.height === layout.pageH);
check('page is non-trivial (>10KB)', pageBuf.length > 10000);

// Export HTML chapter
const html = comic.exportChapterHtml([pageBuf, pageBuf], { title: 'Curiouser — Verify', subtitle: 'placeholder panels' });
check('chapter HTML embeds PNG data URIs', html.includes('data:image/png;base64,'));
check('chapter HTML has 2 pages', (html.match(/<figure>/g) || []).length === 2);

// Write artifacts for inspection
const tmp = path.join(root, 'tmp');
if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'comic-page.png'), pageBuf);
fs.writeFileSync(path.join(tmp, 'comic-chapter.html'), html);
console.log(`\nWrote tmp/comic-page.png (${meta.width}x${meta.height}, ${(pageBuf.length / 1024).toFixed(0)}KB) and tmp/comic-chapter.html`);
console.log(`\nRESULT: ${ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
process.exit(ok ? 0 : 1);
