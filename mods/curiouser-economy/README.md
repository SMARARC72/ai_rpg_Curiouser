# Curiouser Economy Mod (Milestone 2)

The gameshow stakes engine: **Ratings**, **Audience Favor**, and **Legacy** as
Host-spoken meters, plus **Episodes** with a **Renewal Threshold** and the
**Renewed / On-the-Bubble / Cancelled / Reboot** lifecycle, **Curveballs**, and
**Sponsors**. **Ink** is the setting currency (`player.currency`), not a meter here.

## How it honors the guardrails

- **The Host is the HUD.** The three meters are need bars (`defs/need_bars.yaml`),
  so the engine's built-in per-turn need-bar event-check moves them from play and
  injects their **threshold sentences** (Host voice) into the prompt. Their visual
  bars are hidden by `public/css/curiouser-economy.css` (targeting `data-bar-id`),
  so they are spoken, never shown. **Survival bars are left visible and untouched.**
- **Real stakes.** `renewal-check` compares live Ratings to the Episode's threshold;
  missing twice is Cancellation, which **burns Legacy** (a `large` decrease). Reboot
  is a fresh season at a lower tier (`cancelledCount` tracked).
- **Reward cleverness, not randomness.** The meters' `*_increase` trigger lists cue
  the LLM to reward clever/bold/rule-exploiting play and bleed Ratings on stalling.
- **Beats are gated.** There is no per-turn mod hook in this engine
  (`docs/CURIOUSER/ENGINE_MAP.md`), so Episodes/Curveballs/Sponsors are triggered
  explicitly via routes (a client button or the Host calling them) — the intended
  "chosen beats" cadence.

## Routes (`/api/mods/curiouser-economy/...`)

| Method + path | What it does |
| --- | --- |
| `GET /state` | Current season / episode / Format and the live meter values. |
| `POST /episode/roll` | Spin the Format dials (genre skin × Wonderland Rule), publish 2–3 House Rules + a Renewal Threshold, open a new Episode. |
| `POST /episode/renewal-check` | Compare Ratings to the threshold → **renewed** / **on_the_bubble** / **cancelled** (Cancellation burns Legacy). |
| `POST /curveball` | Roll live chaos (Audience Vote or Wildcard). |
| `POST /sponsor` | Offer a Sponsor (Ink now, string attached). |
| `POST /sponsor/accept` | Take the pending Sponsor's Ink; attach the string. |

Every route requires an active game (returns `409` otherwise) and returns a `host`
string — the Host's spoken line — which it also pushes into chat history so the next
turn's Host knows what happened.

## Config

`config.mods.curiouser-economy.enabled` (default `true` in `config.default.yaml`), and
`renewalThresholdMin` / `renewalThresholdMax` (default 40 / 60).

## Notes / follow-ups

- Ratings currently carry across Episodes; the bible calls for a per-Episode reset.
  A precise reset needs an absolute need-bar setter (the engine's `applyNeedBarChange`
  is bucketed small/medium/large/all) — deferred.
- Rival-contestant Ratings and audience Eliminations are narrative for v0 (the meters
  are player-only).
