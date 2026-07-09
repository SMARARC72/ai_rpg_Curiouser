#!/usr/bin/env node
/**
 * Railway / cloud entrypoint for Curiouser.
 *
 * The engine reads its config from config.yaml (gitignored) and its port from
 * config.server.port — NOT process.env.PORT, which Railway injects. This wrapper
 * bridges that: it materializes config.yaml from config.default.yaml + environment
 * variables, enables the Curiouser mods, stages the reskin, starts the server, and
 * (optionally) auto-applies the Curiouser setting once the server is up.
 *
 * Start command (railway.json / Procfile): node scripts/railway-start.mjs
 *
 * Environment variables:
 *   PORT              (Railway sets this) -> config.server.port
 *   HOST              default 0.0.0.0     -> config.server.host
 *   AI_ENDPOINT       -> config.ai.endpoint   (OpenAI-compatible base URL)
 *   AI_API_KEY        -> config.ai.apiKey
 *   AI_MODEL          -> config.ai.model
 *   IMAGE_ENGINE      -> config.imagegen.engine   (openai | nanogpt | comfyui)
 *   IMAGE_API_KEY     -> config.imagegen.apiKey
 *   IMAGE_ENDPOINT    -> config.imagegen.endpoint  (optional)
 *   IMAGE_MODEL       -> config.imagegen.model      (optional)
 *   IMAGEGEN_ENABLED  -> config.imagegen.enabled    ('false' to disable images)
 *   CURIOUSER_AUTO_APPLY  default 'true' — load + apply the Curiouser setting on boot
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const env = process.env;
const log = (m) => console.log(`[railway-start] ${m}`);

// 1. Materialize config.yaml. The engine REQUIRES config.yaml (config.default.yaml
// alone is not enough — server.js loads it with allowMissing:false), so on a fresh
// cloud container we must create it. Regenerate from config.default.yaml + env in
// deploy mode (Railway sets PORT) or when config.yaml is missing; otherwise preserve
// a hand-maintained local config.yaml (set FORCE_CONFIG_REGEN=1 to force a rewrite).
const configPath = path.join(root, 'config.yaml');
const deployMode = Boolean(
  env.PORT || env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID ||
  env.RAILWAY_SERVICE_ID || env.FORCE_CONFIG_REGEN
);
let effectivePort;
if (deployMode || !fs.existsSync(configPath)) {
  const config = yaml.load(fs.readFileSync(path.join(root, 'config.default.yaml'), 'utf8')) || {};
  config.server = config.server || {};
  config.server.port = Number(env.PORT) || config.server.port || 7777;
  config.server.host = env.HOST || '0.0.0.0';

  config.ai = config.ai || {};
  if (env.AI_ENDPOINT) config.ai.endpoint = env.AI_ENDPOINT;
  if (env.AI_API_KEY) config.ai.apiKey = env.AI_API_KEY;
  if (env.AI_MODEL) config.ai.model = env.AI_MODEL;

  config.imagegen = config.imagegen || {};
  // Normalize to the bare engine token so a value like "openai (fast prototype)"
  // (easy to paste from the docs) becomes "openai".
  if (env.IMAGE_ENGINE) config.imagegen.engine = env.IMAGE_ENGINE.trim().split(/\s+/)[0].toLowerCase();
  if (env.IMAGE_API_KEY) config.imagegen.apiKey = env.IMAGE_API_KEY;
  if (env.IMAGE_ENDPOINT) config.imagegen.endpoint = env.IMAGE_ENDPOINT;
  if (env.IMAGE_MODEL) config.imagegen.model = env.IMAGE_MODEL;
  if (env.IMAGEGEN_ENABLED) config.imagegen.enabled = env.IMAGEGEN_ENABLED !== 'false';

  // Ensure Curiouser mods are enabled.
  config.mods = config.mods || {};
  config.mods['curiouser-economy'] = { ...(config.mods['curiouser-economy'] || {}), enabled: true };
  config.mods['curiouser-comic'] = { ...(config.mods['curiouser-comic'] || {}), enabled: true };

  fs.writeFileSync(configPath, yaml.dump(config));
  effectivePort = config.server.port;
  log(`Wrote config.yaml (port=${config.server.port}, host=${config.server.host}, ai.model=${config.ai.model}, imagegen=${config.imagegen.engine}/${config.imagegen.enabled})`);
  if (!env.AI_API_KEY) log('WARNING: AI_API_KEY not set — the server will boot but turns will fail until you set it.');
} else {
  const existing = yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
  effectivePort = (existing.server && existing.server.port) || 7777;
  log(`Preserved existing config.yaml (port=${effectivePort}); set FORCE_CONFIG_REGEN=1 to regenerate from env.`);
}

// 2. Stage the Curiouser reskin (setting + lorebook), idempotent.
const install = spawnSync('node', [path.join(root, 'curiouser', 'install-curiouser.mjs')], { cwd: root, stdio: 'inherit' });
if (install.status !== 0) log('WARNING: reskin installer returned non-zero; continuing.');

// 3. Start the server (foreground; forward signals).
const server = spawn('node', ['server.js'], { cwd: root, stdio: 'inherit' });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.kill(sig));
server.on('exit', (code) => process.exit(code == null ? 0 : code));

// 4. Auto-apply the Curiouser setting once the server is ready.
if ((env.CURIOUSER_AUTO_APPLY || 'true') !== 'false') {
  const base = `http://127.0.0.1:${effectivePort}`;
  (async () => {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const ping = await fetch(`${base}/api/hello`).then((r) => r.ok).catch(() => false);
        if (!ping) continue;
        await fetch(`${base}/api/settings/load`, { method: 'POST' }).catch(() => {});
        const applied = await fetch(`${base}/api/settings/setting_curiouser_v0/apply`, { method: 'POST' })
          .then((r) => r.ok).catch(() => false);
        log(applied ? 'Applied the Curiouser setting.' : 'Could not auto-apply the Curiouser setting (apply it from the UI).');
        return;
      } catch { /* keep polling */ }
    }
    log('Server did not become ready in time for auto-apply; apply the setting from the UI.');
  })();
}
