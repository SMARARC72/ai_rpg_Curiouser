# Curiouser — Engine Map (code-grounded extension points)

Verified against the `ai_rpg` source (fork at this repo) by a multi-agent read with an
adversarial verification pass. Every load-bearing claim below was checked against the
code; file:line citations are approximate but close. Read this before building a mod so
the plan uses only supported extension points and never hacks `server.js`.

> Status legend: **[verified]** confirmed in source · **[corrected]** a first-pass belief that verification overturned — the corrected fact is what's written · **[gotcha]** a trap that will silently bite.

---

## 1. Reskin as data (Milestone 1 — implemented)

- The active world is a single global `currentSetting` (a `SettingInfo`). Its fields are re-rendered into **every** prompt type because they all share `prompts/base-context.xml.njk`, which `{% include %}`s the per-turn logic by `promptType`. **[verified]** (`base-context.xml.njk:22` renders `setting.baseContextPreamble` as the first line of the generation prompt; `:11-15` put `genre`/`tone` in the system prompt; `:36-48` render the `<setting>` block incl. `currencyName`/`currencyNamePlural`/`currencyValueNotes`/`writingStyleNotes`.)
- Setting fields exposed to templates come from `buildSettingPromptContext()` (`server.js:~2120`): name, description, theme, genre, startingLocationType, magicLevel, techLevel, tone, difficulty, currencyName, currencyNamePlural, currencyValueNotes, writingStyleNotes, baseContextPreamble, characterGenInstructions, races. `imagePromptPrefix*` are consumed separately in the image-prompt path (`server.js:~22156`). **[verified]**
- **No boot-time auto-load of settings. [verified/gotcha]** `SettingInfo.loadAll()` runs only via `POST /api/settings/load`. A Setting JSON on disk does nothing until it is registered (`POST /api/settings` or `/load`) **and** applied (`POST /api/settings/:id/apply`), or embedded in a game save. Applying + starting a New Game embeds the full setting into the save and rehydrates it on load (`api.js:~29027`).
- Lorebooks: SillyTavern-format JSON in `./lorebooks`, loaded at boot; disabled by default; enable via `lorebooks/lorebook-state.json` `{ "enabled": [filenames] }`. Matched lore injects as `<additionalLore>` on the main player-action turn (`api.js:~13483`) and other paths. **[verified]** Matching is case-insensitive substring; `constant:true` always injects; ~2000-token budget → use distinctive keys, avoid bare common substrings (e.g. `"pen"` matches `open`, `"Del"` matches `model`).
- **[corrected]** A mod's own `prompts/` directory is a **separate** Nunjucks env (`ModLoader.js:141-146`); the main pipeline renders `base-context.xml.njk` from the **root** `promptEnv`. **A mod cannot override `base-context` or the core prompts.**
- **[corrected/gotcha]** A mod *can* add to core prompts by overlaying `defs/system_prompt_prefix_by_prompt.yaml` (merged by `DefinitionLoader.loadMergedDefinitionFile`; arrays **append**, base-first). But because arrays only append, a mod overlay **cannot remove/replace** the stock `player-action` prefix persona — it can only add another prefix beside it. The guaranteed, per-setting, zero-edit route for the Host voice is therefore the Setting's `baseContextPreamble` + `writingStyleNotes` (what Milestone 1 uses).

The Curiouser reskin ships as: `curiouser/setting/curiouser.setting.json` + `curiouser/lorebooks/curiouser-wonderland.json`, staged by `curiouser/install-curiouser.mjs`. See `curiouser/README.md`.

---

## 2. Mod system (the sanctioned surface)

`ModLoader` calls each mod's `register(scope)` **exactly once at startup**; the mod manifest is frozen thereafter. The four extension mechanisms:

1. **`defs/*.yaml` overlays** — deep-merged onto root defs by `DefinitionLoader` (objects merge by key; **arrays append**; alphabetically-later mod wins scalars). Overlay filename must match a root defs file exactly or startup fails loudly. **[verified]**
2. **`prompts/`** — a per-mod isolated Nunjucks env (rendered via `scope.renderModPrompt`). Does NOT touch core prompts. **[verified]**
3. **`public/`** — served static assets + client JS/CSS injected into the page. **[verified]** (Omitting these is how the economy mod stays "spoken, not rendered.")
4. **`registerModRoute(method, path, handler)`** — namespaced HTTP routes at `/api/mods/<modName>/...`. **[verified]** This is the only behavior-injection primitive.

`scope` = `Object.create(apiScope)` plus mod-local helpers. Reachable engine state/helpers include: `currentPlayer`, `players`, `Player`, `Events`, `chatHistory`, `pushChatEntry`, `normalizeChatEntry`, `promptEnv`, `nunjucks`, `realtimeHub`, `getActiveSettingSnapshot`, and the image pipeline (see §4), plus `modName`, `modDir`, `modLoader`. **[verified]**

**[verified/CRITICAL] There is NO per-turn / lifecycle hook for mods.** No `onTurn`/`addHook`/`emit` mod API. To react to a turn server-side you must either (a) ride the built-in need-bar / disposition LLM event-checks (the engine runs these — see §3), or (b) monkeypatch a shared `apiScope` function inside `register()` (brittle, unsanctioned — treat as a last resort), or (c) expose an HTTP route the client calls after a turn.

**[corrected/gotcha] `scope.modConfig` is always `{}` at `register()` time** — an ordering bug (`loadedMods.set` happens after `register()`). Read live config with `scope.modLoader.getModConfig(modName)` **at request time**, exactly as `scene-illustration` does — never cache `scope.modConfig`.

**[corrected] Slash commands cannot be registered by a mod** — `SlashCommandRegistry` is not on `apiScope`. Use a chat-message button (client asset + route) or an HTTP route instead.

Conventions (`AGENTS.md`): fail loudly / no silent fallbacks; log new prompts via `LLMClient.logPrompt()`; prefer editing `.scss` and recompile CSS; temp files in `./tmp`; update docs after changes.

---

## 3. Economy substrate (Milestone 2 — implemented in `mods/curiouser-economy`)

- **Model the five meters as need bars** via a `defs/need_bars.yaml` overlay in `mods/curiouser-economy`. A need bar is fully declarative: `name`, `description`, audience booleans (`player`/`party`/`non_party`), `min`/`max`/`initial`, `change_per_minute`, per-bar `need_values{small,medium,large}`, trigger lists (`small_increase`…`fill_completely`…`large_decrease`), and `effect_thresholds` keyed by value, each `{name, sentence, effect}`. **[verified]** (Root global fallback magnitudes: `need_values{small:100,medium:250,large:700,all:1000}`.)
- **Meters surface as English sentences, not numbers.** `getNeedSentencePromptContext` emits each active bar's current `effect_thresholds[n].sentence` (with `%CHARACTER%` substituted) into the prompt `<needs>` block. **[verified]** Author threshold sentences in the Host's voice → satisfies "the Host is the HUD" for free. Ship **no** `public/` assets so nothing renders as a dashboard.
- **Two update paths:** (a) passive drift on world-clock advance (`Player.applyStatusEffectNeedBarsToAll`, floored per whole minute — set `change_per_minute: 0` for meters that must not leak over time like Ratings/Legacy); (b) a per-turn LLM classifier `Events._runNeedBarEventChecks` (promptType `need-bars`) that reads the turn against each bar's trigger lists and calls `Player.applyNeedBarChange({direction, magnitude})`. **[verified]** Put "clever/bold/rule-exploit" cues in `*_increase` lists and "stalling/flop" cues in `*_decrease`.
- **[corrected]** Dispositions mutate per-turn via `runDispositionCheckPrompt` (`api.js:~10518`, promptType `disposition-check`), **not** the inline `disposition_check` event entry, which is commented out (like `needbar_change`). The hardcoded check array is `EVENT_PROMPT_ORDER` / `EVENT_PROMPT_ORDER_FLAT` (`Events.js:15/226`), and it is **not** defs/config-driven — a mod **cannot add a bespoke LLM check** (e.g. "CurveballCheck") through the overlay system without editing engine source.
- **Curveballs & Sponsors are event-shaped, not gauge-shaped.** They fit poorly as need bars. Trigger them via a mod HTTP route the client calls (or a meter-threshold crossing), and voice them by appending a Host chat entry with `pushChatEntry`/`normalizeChatEntry`. **[verified as available]**
- Renewal/Cancellation/Reboot and Legacy tiers are episode/season state the mod must persist itself (mod-local JSON, like scene-illustration's data file), since there is no per-turn hook to compute them automatically.

---

## 4. Comic assembly (Milestone 3 — implemented in `mods/curiouser-comic`)

- One shared in-memory image queue: `generateImageId()` → `createImageJob(jobId, payload)` → `jobQueue.push(jobId)` → `processJobQueue()`. **Serial by default (`maxConcurrentJobs: 1`)**, so N panels run N×(30–90s); per-job timeout is **2 minutes**. **[verified/gotcha]** Handle partial failure (some panels may TIMEOUT).
- Images save to `public/generated-images/<imageId>.png` and return `{ imageId, images:[{url:'/generated-images/<file>'}] }`; `public` is served static, so composited pages written there are immediately fetchable. **[verified]** (Write output there, not the mod's own `public/`.)
- `scope.comfyUIClient` is polymorphic (ComfyUI / NanoGPT / OpenAI per `config.imagegen.engine`). A comic mod never calls it directly — it enqueues jobs and reads `job.result`. Completion is detected by **polling** `scope.imageJobs.get(jobId)` (no await helper); the scene mod uses `setInterval`. **[verified]**
- **`sharp@^0.34.5` is a declared dep and already used** (`LLMClient.js` WebP conversion) → compositing is in-stack. **[verified]** (`npm install` required; guard the require.) The scene prompt already forbids in-image text → generate clean panels, then composite caption boxes + speech bubbles as **SVG overlays** (`sharp({create}).composite([...])`). Wrap text manually (no auto-layout in sharp/librsvg).
- **Gate panels behind an explicit trigger, never per-turn.** Best fit: a chat-message button (like scene-illustration's 🎨) or an HTTP route; optionally an LLM "beat marker" tag that merely *highlights* the button — the human confirms. (Slash-command gating is NOT available to mods — see §2.)
- **Chapter export v0 = self-contained HTML** (page PNGs embedded as `data:` URIs). **[verified/gotcha]** No PDF or CBZ library is declared; sharp cannot emit either. PDF (`pdf-lib`/`pdfkit`) or CBZ (`jszip`/`archiver`) is a **new-dependency decision** deferred to v1. There is a file-export precedent in `slashcommands/export_history.js` (writes to `exports/`).
- **[gotcha]** The scene mod reads `config.imagegen.scene_settings`, which does **not** exist in `config.default.yaml` (only `location_settings`), so it silently falls back. The comic mod should define its own `panel_settings`.

---

## 5. Old repo (`Thefirstpercepti`)

Mined for reusable gameshow/economy/comic/host mechanics: it is effectively an **empty/scaffold** project with no design content to lift (matches the bible's Part V note). Nothing to reuse for Curiouser at this time.

---

*Generated during the Milestone 0/1 build. Update this map whenever the engine facts change.*
