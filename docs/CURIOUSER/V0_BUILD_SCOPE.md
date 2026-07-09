# Curiouser — v0 Build Scope

**Goal of v0:** the smallest playable slice that *feels* like Curiouser and proves the core promise — one playable episode, in the Host's voice, with working stakes, that mints one comic page. Build on the existing `ai_rpg` engine: reskin as data, extend via mods, avoid core surgery.

## Milestone 0 — Engine running (baseline)

- `npm install`; copy `config.default.yaml` → `config.yaml`.
- Set `ai.endpoint` / `ai.apiKey` / `ai.model` to an OpenAI-compatible provider with a capable model (GLM-4.x, Deepseek-V3.x, or Kimi — it must emit valid XML reliably; small models flake).
- `imagegen.enabled: true`, `engine: openai` (fast prototype path).
- `npm start`, then play a stock game to confirm the loop, saves, and image generation work.
- **Done when:** a stock adventure plays end-to-end with at least one generated scene image.

## Milestone 1 — Reskin as data (no engine code)

- Author a **Curiouser Setting**: `genre`/`tone` = the Dinniman × Wonderland gameshow voice; `currencyName: "Ink"`; `baseContextPreamble` = the Host framing (you are a contestant, the Host narrates, entertain or be cancelled).
- Author a **system-prompt preamble** installing the Host persona (euphoric-desperate MC; deadpan bureaucracy; the six comedy laws from the bible).
- Add **lorebook entries**: the Show, the Host, Del, the pen motif, and the House-Rules concept.
- **Done when:** play feels like Curiouser — Host voice, Ink currency, gameshow framing — with zero core-code changes.

## Milestone 2 — Economy mod (`mods/curiouser-economy`)

- New mod exporting `register(scope)`: track **Ratings** (per-episode), **Legacy** (per-season), and **Audience Favor**. Clone the `need-bar-*` + disposition patterns for variables and persistence.
- Hook the turn cycle so Ratings rise on bold/clever/rule-exploiting actions and bleed on stalling; surface all meters **through the Host as dialogue**.
- Episode end: **Renewal Threshold** check → Renewed / On-the-Bubble / Cancelled (Cancellation burns Legacy; Reboot at a lower tier).
- Add **Sponsors** and **Curveballs** as event types (Audience Vote, Sponsor Break, Wildcard).
- **Done when:** an episode has real stakes — you can be Renewed or Cancelled, meters move from play, and the Host narrates them.

## Milestone 3 — Comic-assembly mod (`mods/curiouser-comic`)

- Extend `mods/scene-illustration`: instead of one image per scene, mark **panel-worthy beats** (Host-gated), collect them, and composite a **multi-panel comic page** with caption boxes + speech bubbles using `sharp`.
- Export the episode as a comic page/chapter (PNG page(s) → CBZ or PDF).
- **Done when:** finishing an episode produces a shareable comic-page chapter.

## Milestone 4 — Later (not v0)

- **Character consistency:** swap `imagegen/*.njk` to a ComfyUI workflow with IP-Adapter FaceID + a character LoRA + ControlNet/InstantID.
- **Drift-proofing:** add a temporal memory (Graphiti/Zep) if scene-summarization proves insufficient over long seasons.
- Host name + fuller voice; the season/finale/Off-Air arc; multiplayer (the engine already supports party members).

## Guardrails (from the bible)

Lawful nonsense · real stakes · the Host is the HUD · panels are gated (the comic is the output).
