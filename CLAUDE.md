# CLAUDE.md — Curiouser build handoff

This repository is a fork of `envy-ai/ai_rpg` (an AI-gamemaster solo-RPG engine; `package.json` declares MIT, but there is no LICENSE file yet) being reskinned and extended into **Curiouser**: a solo-author game where each playthrough compiles into a comic-book chapter, in the comedic tone of Matt Dinniman's *Dungeon Crawler Carl* crossed with a psychedelic, Alice-in-Wonderland **gameshow**. There is also another repo attached that is an old game that was built in the past that you can mine as you feel like it to pull working code or mechanics.

## Read first — source of truth

1. `docs/CURIOUSER/Design_Bible_and_Build_Plan.md` — the full design + build strategy. **The bible governs; this file is only a summary.**
2. `docs/CURIOUSER/V0_BUILD_SCOPE.md` — the concrete first milestone and task order. **Start here.**
3. `docs/CURIOUSER/ENGINE_MAP.md` — code-grounded, cited map of the engine's reskin / economy / comic / mod-API extension points (verified against the source). Read before building a mod.
4. `AGENTS.md` — the upstream engine's engineering conventions. **Follow them:** fail loudly; use the mod system; log prompts via `LLMClient.logPrompt()`; read `docs/developer_overview.md` before touching core; compile SCSS after SCSS edits; keep temp files in `./tmp`; don't touch git unless asked.

## What we're building

A **reskin + two mods** on top of the existing engine. Do **not** rewrite the engine or hack the ~26k-line `server.js` unless a mod genuinely cannot reach what you need.

- **Reskin as data:** the Host voice, gameshow framing, and `currencyName: "Ink"` via a Curiouser Setting + a system-prompt preamble + lorebooks. The base prompt already exposes `setting.genre`, `setting.tone`, `setting.theme`, `setting.currencyName`, and `setting.baseContextPreamble`.
- **Economy mod:** Ratings / Legacy / Audience Favor / Sponsors / Curveballs — clone the `mods/need-bar-*` and disposition patterns. Meters surface through the Host as dialogue, **never a rendered dashboard**.
- **Comic-assembly mod:** extend `mods/scene-illustration` from one-image-per-scene to composited multi-panel comic pages (caption boxes + speech bubbles via `sharp`) and export a chapter.

## Guardrails — do not drift

- **Lawful nonsense:** worlds are absurd but run on consistent, exploitable rules.
- **Real stakes:** Cancellation costs Legacy and the run; reward cleverness, not randomness.
- **The Host is the heart and the HUD:** meters are spoken by the Host, not shown as UI.
- **The comic is the output:** panels are gated — occasional, chosen beats, not one per turn.

## Build order

See `docs/CURIOUSER/V0_BUILD_SCOPE.md`. In short: (0) get the vanilla engine running → (1) reskin as data → (2) economy mod → (3) comic-assembly mod → (4) character consistency (ComfyUI + IP-Adapter) and drift-proofing later.

## Curiouser assets in this repo

- `curiouser/setting/curiouser.setting.json` — the Curiouser Setting (Host voice + Ink + gameshow framing as data).
- `curiouser/lorebooks/curiouser-wonderland.json` — the Wonderland/gameshow lorebook.
- `curiouser/install-curiouser.mjs` — installs the above into the engine's runtime dirs (`saves/settings/`, `lorebooks/`) and enables the lorebook.
- `curiouser/README.md` — how to install + apply the reskin, and the known gotchas.

## Open decisions (flagged, not resolved)

- **Image backend:** use `imagegen.engine: openai` for the fast prototype; move to ComfyUI + IP-Adapter for character consistency later.
- **License:** the engine declares MIT but ships no LICENSE file — confirm with the upstream author before any commercial use.
