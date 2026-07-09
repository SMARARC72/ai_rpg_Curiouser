# Curiouser Theme — Comic-book / Ink

A pure-CSS reskin of the stock `ai_rpg` UI into a comic page: cream paper with a
halftone wash, heavy black ink borders + hard offset shadows, a comic display
face (Bangers) for headings/labels and a readable comic body face (Comic Neue),
and speech-bubble-style chat panels (the Host's lines in yellow, the player's in
blue). The app ends up looking like the comic it produces.

## How it works

The engine's mod loader injects every enabled mod's `public/css/*.css` into the
page after `main.css` (`getModClientStyles()`), so this file overrides the base
dark theme with no DOM changes. Disable the mod (`config.mods.curiouser-theme.enabled: false`)
to revert instantly.

- `public/css/curiouser-theme.css` — the whole theme (palette in `:root`,
  then paper background, display type, ink-bordered panels/cards, comic buttons,
  bubble chat, inputs, modals, scrollbars).

Fonts load from Google Fonts via `@import` in the browser (client-side, so it
works regardless of server egress); the stack falls back to Comic Sans / system
fonts if that's blocked.

## Tuning

- Palette and ink/shadow are CSS variables at the top of the file
  (`--cur-paper`, `--cur-ink`, `--cur-red`, `--cur-hard`, …) — change those to
  re-tone the whole UI.
- Host-vs-player bubble colors are under the `.message` rules; they target
  `.message.assistant` / `.message.user` (and `data-role`) — adjust if the base
  UI tags message roles differently.
