# Curiouser — Setup & Run

This repo is the `ai_rpg` engine (fork `SMARARC72/ai_rpg_Curiouser`) plus the Curiouser
design docs and reskin. Read `CLAUDE.md` → `docs/CURIOUSER/Design_Bible_and_Build_Plan.md`
→ `docs/CURIOUSER/V0_BUILD_SCOPE.md` → `docs/CURIOUSER/ENGINE_MAP.md`.

## Prerequisites

- Node.js 18+ and npm 9+ (developed against Node 22 / npm 10).
- An OpenAI-compatible LLM endpoint + a capable model that emits valid XML reliably
  (GLM-4.x / Deepseek-V3.x / Kimi — small models flake).
- (Optional) A running ComfyUI instance for later character-consistency work.

## Milestone 0 — run the engine

```bash
npm install                         # installs sharp, nunjucks, express, ...
cp config.default.yaml config.yaml  # config.yaml is gitignored (holds your keys)
```

Edit `config.yaml`:

- `ai.endpoint` / `ai.apiKey` / `ai.model` — your OpenAI-compatible provider + model.
- `imagegen.enabled: true`, `imagegen.engine: openai` (fast prototype path; the default is
  `nanogpt`). Set the matching image `apiKey`.

```bash
npm start        # serves on http://localhost:7777 (config.yaml `port`)
```

Open `http://localhost:7777`, start a stock game, and confirm the loop + saves + one
generated scene image. **Done when** a stock adventure plays end-to-end with an image.

> **Environment note.** Milestone 0's *end-to-end play* needs outbound access to your LLM/image
> provider and valid API keys. In a sandbox without those (or with provider egress blocked)
> you can still verify the install + boot: `npm install`, create `config.yaml`, `npm start`,
> and hit `GET /api/hello` (expect HTTP 200). Full play then happens on a host that has
> credentials + egress — e.g. the **Railway** deployment connected to this repo via the
> GitHub app.

## Milestone 1 — apply the Curiouser reskin

```bash
node curiouser/install-curiouser.mjs        # stage setting + lorebook, enable lorebook
# with the server running:
curl -X POST http://localhost:7777/api/settings/load
curl -X POST http://localhost:7777/api/settings/setting_curiouser_v0/apply
# then start a New Game while "Curiouser" is applied
```

See `curiouser/README.md` for details and gotchas, and
`node curiouser/verify-reskin.mjs` for an LLM-free check that the reskin surfaces in the
prompt.

## Engineering conventions

Follow `AGENTS.md`: fail loudly (no silent fallbacks); log new prompts via
`LLMClient.logPrompt()`; edit `.scss` and recompile CSS (`npm run scss:build`); keep temp
files in `./tmp`; update docs after changes. Build differentiated features as **mods**
(`docs/CURIOUSER/ENGINE_MAP.md` §2), not edits to the ~26k-line `server.js`.

## Git note

This environment's clone has valid git wiring; develop on the designated feature branch and
push there. (Some earlier handoff notes described a broken-git Cowork sandbox needing
`git init` / `git reset --hard` — that does **not** apply to a normally-cloned repo; do not
run those destructive steps here.)
