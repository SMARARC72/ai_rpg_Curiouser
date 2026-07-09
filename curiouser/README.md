# Curiouser reskin assets (Milestone 1)

The **reskin-as-data** layer: the Host voice, gameshow framing, and `Ink` currency shipped
as Setting data + a lorebook, with **zero core-engine edits**. See
`docs/CURIOUSER/V0_BUILD_SCOPE.md` (Milestone 1) and `docs/CURIOUSER/ENGINE_MAP.md` §1.

## Contents

| File | What it is |
| --- | --- |
| `setting/curiouser.setting.json` | The Curiouser `SettingInfo` — Host framing in `baseContextPreamble`, the six comedy laws + voice in `writingStyleNotes`, `currencyName: "Ink"`, comic-book image prefixes, starting Green Room, contestant classes. |
| `lorebooks/curiouser-wonderland.json` | SillyTavern-format lorebook: The Show, the Host, Ink, the stakes engine (always-on `constant` entries) + keyword entries for the Audience, House Rules, Curveballs, Sponsors, Legacy, Ratings, Off-Air, Reboot, Del, the pen, the Format, Eliminations. |
| `install-curiouser.mjs` | Stages both into the engine's runtime dirs and enables the lorebook. |

## Install

```bash
npm install                      # once, if you haven't (installs sharp etc.)
node curiouser/install-curiouser.mjs
```

This validates the Setting through the real `SettingInfo` class, copies it to
`saves/settings/`, copies the lorebook to `lorebooks/`, and enables it in
`lorebooks/lorebook-state.json`. All three targets are gitignored runtime dirs — the
committed source of truth lives here under `curiouser/`.

## Apply (one-time, needs the server running)

The engine does **not** auto-load settings at boot, so register + apply once
(default port `7777`, from `config.yaml` `port`):

```bash
curl -X POST http://localhost:7777/api/settings/load
curl -X POST http://localhost:7777/api/settings/setting_curiouser_v0/apply
```

Or in the browser UI: **Settings → Load saved settings → Apply "Curiouser"**. Then start a
**New Game** while Curiouser is applied — the full setting is embedded in the save and
rehydrated on load, so the reskin sticks to that playthrough. The lorebook is already
enabled and injects on the next server start.

## Verify without an LLM

`curiouser/verify-reskin.mjs` renders the engine's real `base-context.xml.njk` with the
Curiouser Setting and asserts the Host framing, `<currencyName>Ink</currencyName>`, tone,
and Ink price list all surface in the generation prompt. Run: `node curiouser/verify-reskin.mjs`.

## Gotchas (verified against the engine)

1. **No boot auto-load** — staging the file is not enough; you must `load` + `apply` (or bake it into a save). See above.
2. **`baseContextPreamble` leads every prompt type** (including structured event/plausibility checks), so it is written as world+voice *context* and explicitly scopes the Host voice to *narration* — it must not corrupt utility prompts.
3. **The stock `player-action` system-prompt prefix persists.** A mod/defs overlay of `system_prompt_prefix_by_prompt.yaml` can only *append*, not replace it (arrays concatenate). The Host voice therefore rides the per-setting `baseContextPreamble`/`writingStyleNotes`, which is the guaranteed route.
4. **`currencyName` only labels the currency.** Whether the Host actually says "Ink" every turn depends on model adherence — it's reinforced in `baseContextPreamble`, `currencyValueNotes`, and the lorebook, not left to the `<currencyName>` tag alone.
5. **Lorebook keys are case-insensitive substrings** — `Del` uses `case_sensitive: true` and the pen uses phrase keys (`"the pen"`, not `"pen"`) to avoid matching `model`/`open`.
