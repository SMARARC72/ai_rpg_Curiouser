/**
 * Curiouser Comic-Assembly Mod (Milestone 3)
 *
 * Extends the one-image-per-scene idea into composited multi-panel COMIC PAGES.
 * Panel-worthy beats are collected (Host-gated — panels are chosen, occasional,
 * never one-per-turn), their images generated clean (no baked-in text) through
 * the engine's shared image-job queue, then composited with `sharp` into a page:
 * a grid of panels with black frames, yellow CAPTION BOXES (narration) and white
 * SPEECH BUBBLES (dialogue) drawn as SVG overlays. A finished Episode exports as a
 * self-contained HTML chapter (page PNGs embedded as data: URIs) — the comic is
 * the output.
 *
 * The pure compositing/export functions (composePage, exportChapterHtml) are
 * exported so they can be verified without an LLM/image backend
 * (see verify-compose.mjs). Panel image GENERATION needs a live image backend
 * (config.imagegen), which is the only part that can't run without credentials.
 *
 * See docs/CURIOUSER/ENGINE_MAP.md §4 for the verified pipeline facts
 * (serial queue, 2-min timeout, output must go to public/generated-images,
 * no PDF/CBZ dependency so v0 export is HTML).
 */

const fs = require('fs');
const path = require('path');

let sharpModule = null;
function getSharp() {
  if (!sharpModule) {
    try { sharpModule = require('sharp'); }
    catch (err) { throw new Error(`sharp is required for the comic mod but failed to load — run "npm install". (${err.message})`); }
  }
  return sharpModule;
}

module.exports.meta = {
  name: 'Curiouser Comic Assembly',
  version: '1.0.0',
  description: 'Composite panel-worthy beats into multi-panel comic pages (caption boxes + speech bubbles) and export a chapter.'
};

module.exports.configSchema = {
  panelWidth: { type: 'number', label: 'Panel width (px)', description: 'Width of a single panel cell.', default: 512 },
  panelHeight: { type: 'number', label: 'Panel height (px)', description: 'Height of a single panel cell.', default: 384 }
};

// ---- Pure layout / text helpers --------------------------------------------

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Greedy word-wrap into at most `maxLines` lines of roughly `maxChars` chars.
function wrapText(text, maxChars, maxLines = 5) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (!line) { line = w; }
    else if ((line + ' ' + w).length <= maxChars) { line += ' ' + w; }
    else { lines.push(line); line = w; }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(' ').length > lines.join(' ').length && lines.length) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\.*$/, '…');
  }
  return lines;
}

// Grid: 1 column for a single panel, otherwise 2 columns; a trailing odd panel
// spans the full content width. Returns page size and per-cell rects.
function computeLayout(n, opts = {}) {
  const cellW = opts.panelWidth || 512;
  const cellH = opts.panelHeight || 384;
  const gutter = opts.gutter || 16;
  const margin = opts.margin || 28;
  const cols = n <= 1 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const contentW = cols * cellW + (cols - 1) * gutter;
  const pageW = margin * 2 + contentW;
  const pageH = margin * 2 + rows * cellH + (rows - 1) * gutter;
  const cells = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const isLastOdd = (i === n - 1) && (n % cols === 1) && cols > 1;
    const x = margin + (isLastOdd ? 0 : col * (cellW + gutter));
    const y = margin + row * (cellH + gutter);
    const w = isLastOdd ? contentW : cellW;
    cells.push({ x, y, w, h: cellH });
  }
  return { pageW, pageH, cells, cellW, cellH };
}

// Build a full-page SVG overlay: panel frames + caption boxes + speech bubbles.
function buildOverlaySvg(panels, layout) {
  const { pageW, pageH, cells } = layout;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}" height="${pageH}" viewBox="0 0 ${pageW} ${pageH}">`];
  parts.push(`<style>
    .frame{fill:none;stroke:#111;stroke-width:5}
    .capbox{fill:#fdf3c7;stroke:#111;stroke-width:2}
    .captxt{font-family:Georgia,'Times New Roman',serif;font-size:17px;fill:#111}
    .bubble{fill:#ffffff;stroke:#111;stroke-width:2}
    .bubtxt{font-family:'Comic Sans MS','Segoe UI',sans-serif;font-size:16px;font-weight:600;fill:#111;text-anchor:middle}
    .speaker{font-family:'Comic Sans MS','Segoe UI',sans-serif;font-size:12px;font-weight:700;fill:#b00020;text-anchor:middle}
  </style>`);

  panels.forEach((panel, i) => {
    const cell = cells[i];
    if (!cell) return;
    // Panel frame
    parts.push(`<rect class="frame" x="${cell.x}" y="${cell.y}" width="${cell.w}" height="${cell.h}"/>`);

    // Caption box (narration) — top-left of the panel
    const caption = (panel.caption || '').trim();
    if (caption) {
      const boxW = Math.min(cell.w - 24, Math.max(160, Math.round(cell.w * 0.62)));
      const maxChars = Math.max(14, Math.floor(boxW / 8.5));
      const lines = wrapText(caption, maxChars, 3);
      const lineH = 21;
      const boxH = 12 + lines.length * lineH;
      const bx = cell.x + 10, by = cell.y + 10;
      parts.push(`<rect class="capbox" x="${bx}" y="${by}" width="${boxW}" height="${boxH}" rx="3"/>`);
      parts.push(`<text class="captxt" x="${bx + 10}" y="${by + 22}">` +
        lines.map((ln, k) => `<tspan x="${bx + 10}" dy="${k === 0 ? 0 : lineH}">${escapeXml(ln)}</tspan>`).join('') +
        `</text>`);
    }

    // Speech bubbles (dialogue) — stacked from the bottom of the panel upward
    const dialogue = Array.isArray(panel.dialogue) ? panel.dialogue.slice(0, 2) : [];
    let bubbleBottom = cell.y + cell.h - 14;
    for (let d = dialogue.length - 1; d >= 0; d--) {
      const { speaker, text } = dialogue[d] || {};
      const bubW = Math.min(cell.w - 40, Math.max(150, Math.round(cell.w * 0.6)));
      const maxChars = Math.max(14, Math.floor(bubW / 8.5));
      const lines = wrapText(text, maxChars, 3);
      const lineH = 20;
      const hasSpeaker = speaker && String(speaker).trim();
      const bubH = 14 + (hasSpeaker ? 14 : 0) + lines.length * lineH;
      const bx = cell.x + (cell.w - bubW) / 2;
      const by = bubbleBottom - bubH;
      const cx = bx + bubW / 2;
      // tail
      parts.push(`<polygon class="bubble" points="${cx - 10},${by + bubH - 2} ${cx + 10},${by + bubH - 2} ${cx - 2},${by + bubH + 14}"/>`);
      parts.push(`<rect class="bubble" x="${bx}" y="${by}" width="${bubW}" height="${bubH}" rx="14"/>`);
      let ty = by + 20;
      if (hasSpeaker) { parts.push(`<text class="speaker" x="${cx}" y="${ty}">${escapeXml(String(speaker).toUpperCase())}</text>`); ty += 16; }
      parts.push(`<text class="bubtxt" x="${cx}" y="${ty}">` +
        lines.map((ln, k) => `<tspan x="${cx}" dy="${k === 0 ? 0 : lineH}">${escapeXml(ln)}</tspan>`).join('') +
        `</text>`);
      bubbleBottom = by - 12;
    }
  });

  parts.push(`</svg>`);
  return parts.join('\n');
}

/**
 * Composite panels into a single comic page PNG buffer.
 * @param {Array} panels - [{ image: Buffer|string(filepath), caption, dialogue:[{speaker,text}] }]
 * @param {Object} opts - { panelWidth, panelHeight, gutter, margin, background }
 * @returns {Promise<Buffer>} PNG buffer
 */
async function composePage(panels, opts = {}) {
  const sharp = getSharp();
  if (!Array.isArray(panels) || panels.length === 0) throw new Error('composePage requires at least one panel');
  const n = Math.min(panels.length, 6);
  const layout = computeLayout(n, opts);
  const bg = opts.background || { r: 255, g: 252, b: 244, alpha: 1 };

  // Resize each panel image to its cell and place it.
  const composites = [];
  for (let i = 0; i < n; i++) {
    const cell = layout.cells[i];
    const src = panels[i].image;
    if (!src) throw new Error(`panel ${i} has no image`);
    const buf = await sharp(src).resize(cell.w, cell.h, { fit: 'cover' }).toBuffer();
    composites.push({ input: buf, left: Math.round(cell.x), top: Math.round(cell.y) });
  }

  const base = await sharp({ create: { width: layout.pageW, height: layout.pageH, channels: 4, background: bg } })
    .composite(composites)
    .png()
    .toBuffer();

  const overlaySvg = buildOverlaySvg(panels.slice(0, n), layout);
  return sharp(base).composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }]).png().toBuffer();
}

/** Assemble page PNGs into one self-contained HTML chapter (images inlined). */
function exportChapterHtml(pages, meta = {}) {
  const title = escapeXml(meta.title || 'Curiouser — Chapter');
  const subtitle = escapeXml(meta.subtitle || '');
  const imgs = pages.map((p, i) => {
    const b64 = Buffer.isBuffer(p) ? p.toString('base64') : (p.base64 || (p.buffer && p.buffer.toString('base64')));
    return `<figure><img alt="Page ${i + 1}" src="data:image/png;base64,${b64}"/><figcaption>Page ${i + 1}</figcaption></figure>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{margin:0;background:#1b1b1f;color:#eee;font-family:Georgia,serif;text-align:center}
  header{padding:28px 16px 8px}
  h1{margin:0;font-size:26px} .sub{opacity:.75;font-size:15px}
  main{display:flex;flex-direction:column;align-items:center;gap:28px;padding:24px 12px 60px}
  figure{margin:0;max-width:900px;width:100%}
  img{width:100%;height:auto;border:1px solid #000;box-shadow:0 6px 24px rgba(0,0,0,.5);background:#fff}
  figcaption{opacity:.6;font-size:13px;margin-top:6px}
</style></head><body>
<header><h1>${title}</h1>${subtitle ? `<div class="sub">${subtitle}</div>` : ''}</header>
<main>${imgs}</main></body></html>`;
}

module.exports.composePage = composePage;
module.exports.exportChapterHtml = exportChapterHtml;
module.exports.computeLayout = computeLayout;
module.exports.wrapText = wrapText;

// ---- Mod registration (routes + image-backed panel generation) -------------

module.exports.register = function register(scope) {
  const { modDir, modName, registerModRoute } = scope;
  const baseDir = scope.modLoader && scope.modLoader.baseDir ? scope.modLoader.baseDir : path.resolve(modDir, '..', '..');
  const dataDir = path.join(modDir, 'data');
  const stateFile = path.join(dataDir, 'comic-state.json');
  const generatedDir = path.join(baseDir, 'public', 'generated-images');
  const exportsDir = path.join(baseDir, 'exports');

  function loadState() {
    try { if (fs.existsSync(stateFile)) return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
    catch (err) { console.warn(`[${modName}] state read failed, resetting:`, err.message); }
    return { pendingBeats: [], pages: [] };
  }
  function saveState(state) {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }
  let state = loadState();

  // Resolve a public image URL ('/generated-images/x.png') to a filesystem path.
  function urlToPath(url) {
    if (typeof url !== 'string') return null;
    const clean = url.replace(/^\//, '');
    return path.join(baseDir, 'public', clean);
  }

  function panelSettings() {
    const cfg = (scope.modLoader.getModConfig(modName)) || {};
    return { panelWidth: cfg.panelWidth || 512, panelHeight: cfg.panelHeight || 384 };
  }

  // Generate one clean panel image via the shared job queue; resolve to its file path.
  function generatePanelImage(prompt) {
    return new Promise((resolve, reject) => {
      if (!scope.config || !scope.config.imagegen || !scope.config.imagegen.enabled) {
        return reject(new Error('Image generation is not enabled (config.imagegen.enabled).'));
      }
      const jobId = scope.generateImageId();
      const ps = panelSettings();
      const payload = {
        prompt,
        width: ps.panelWidth * 2,
        height: ps.panelHeight * 2,
        negative_prompt: 'text, speech bubble, caption, letters, words, watermark, signature, panel border, gutter',
        entityType: 'comic_panel',
        entityId: `panel_${jobId}`
      };
      scope.createImageJob(jobId, payload);
      scope.jobQueue.push(jobId);
      setTimeout(() => scope.processJobQueue(), 0);
      const started = Date.now();
      const timer = setInterval(() => {
        const job = scope.imageJobs && scope.imageJobs.get(jobId);
        if (job && job.status === 'completed' && job.result) {
          clearInterval(timer);
          const url = job.result.images && job.result.images[0] && job.result.images[0].url;
          const fp = urlToPath(url);
          if (fp && fs.existsSync(fp)) resolve(fp);
          else reject(new Error('panel image completed but file not found'));
        } else if (job && (job.status === 'failed' || job.status === 'timeout')) {
          clearInterval(timer);
          reject(new Error(`panel image ${job.status}: ${job.error || ''}`));
        } else if (Date.now() - started > 150000) {
          clearInterval(timer);
          reject(new Error('panel image generation timed out'));
        }
      }, 1000);
    });
  }

  function requireGame(res) {
    if (!scope.currentPlayer) { res.status(409).json({ success: false, error: 'No active game.' }); return false; }
    return true;
  }

  // GET /state — pending beats + composed pages
  registerModRoute('get', '/state', (req, res) => {
    res.json({ success: true, pendingBeats: state.pendingBeats, pages: state.pages.map(p => ({ id: p.id, url: p.url, panelCount: p.panelCount })) });
  });

  // POST /panel — mark a panel-worthy beat (Host-gated). Body: {caption, dialogue, imagePrompt?, imageUrl?}
  registerModRoute('post', '/panel', (req, res) => {
    if (!requireGame(res)) return;
    const { caption = '', dialogue = [], imagePrompt = '', imageUrl = '' } = req.body || {};
    if (!imagePrompt && !imageUrl) return res.status(400).json({ success: false, error: 'panel needs an imagePrompt or an imageUrl' });
    const beat = { id: `beat_${state.pendingBeats.length + 1}_${Math.floor(Date.now() / 1000)}`, caption, dialogue, imagePrompt, imageUrl };
    state.pendingBeats.push(beat);
    saveState(state);
    res.json({ success: true, beat, pendingCount: state.pendingBeats.length });
  });

  // POST /page/compose — turn the pending beats into a composited comic page
  registerModRoute('post', '/page/compose', async (req, res) => {
    if (!requireGame(res)) return;
    const beats = state.pendingBeats.slice(0, 6);
    if (!beats.length) return res.status(409).json({ success: false, error: 'No pending panel beats — POST /panel first.' });
    try {
      const panels = [];
      for (const beat of beats) {
        let imgPath = beat.imageUrl ? urlToPath(beat.imageUrl) : null;
        if ((!imgPath || !fs.existsSync(imgPath)) && beat.imagePrompt) imgPath = await generatePanelImage(beat.imagePrompt);
        if (!imgPath || !fs.existsSync(imgPath)) throw new Error(`beat ${beat.id} has no usable image`);
        panels.push({ image: imgPath, caption: beat.caption, dialogue: beat.dialogue });
      }
      const pageBuf = await composePage(panels, panelSettings());
      if (!fs.existsSync(generatedDir)) fs.mkdirSync(generatedDir, { recursive: true });
      const pageId = scope.generateImageId ? scope.generateImageId() : `page_${Math.floor(Date.now() / 1000)}`;
      const filename = `comic_${pageId}.png`;
      fs.writeFileSync(path.join(generatedDir, filename), pageBuf);
      const url = `/generated-images/${filename}`;
      state.pages.push({ id: pageId, url, panelCount: panels.length, beats });
      state.pendingBeats = [];
      saveState(state);
      res.json({ success: true, page: { id: pageId, url, panelCount: panels.length } });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /chapter/export — assemble all pages into a self-contained HTML chapter
  registerModRoute('post', '/chapter/export', (req, res) => {
    if (!state.pages.length) return res.status(409).json({ success: false, error: 'No composed pages yet — POST /page/compose first.' });
    try {
      const pageBufs = state.pages.map(p => fs.readFileSync(path.join(generatedDir, path.basename(p.url))));
      const title = (req.body && req.body.title) || 'Curiouser — Chapter';
      const html = exportChapterHtml(pageBufs, { title, subtitle: (req.body && req.body.subtitle) || '' });
      if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
      const fname = `chapter_${Math.floor(Date.now() / 1000)}.html`;
      const outPath = path.join(exportsDir, fname);
      fs.writeFileSync(outPath, html);
      res.json({ success: true, path: outPath, pages: state.pages.length });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // DELETE /reset — clear pending beats and pages (does not delete files)
  registerModRoute('delete', '/reset', (req, res) => {
    state = { pendingBeats: [], pages: [] };
    saveState(state);
    res.json({ success: true });
  });

  console.log(`      📚 Curiouser Comic Assembly mod loaded (panels → pages → chapter)`);
};
