# Curiouser Comic-Assembly Mod (Milestone 3)

Turns **panel-worthy beats** into composited **multi-panel comic pages** (black
frames + yellow caption boxes + white speech bubbles via `sharp`) and exports a
finished Episode as a **self-contained HTML chapter**. The comic is the output.

## Flow

1. **Gate a beat** — `POST /panel` with a `caption` (narration), `dialogue`
   (`[{speaker, text}]`), and either an `imagePrompt` (generated clean, text-free,
   through the shared image-job queue) or an `imageUrl` (an existing image, e.g. a
   scene illustration). Panels are chosen, occasional beats — the Host gates them
   ("that's not panel-worthy" / "ooh, THAT's a panel"), never one per turn.
2. **Compose a page** — `POST /page/compose` lays the pending beats into a grid
   (1 panel = full page; 2–6 panels = 2 columns, a trailing odd panel spans full
   width), draws frames + caption boxes + speech bubbles as an SVG overlay, and
   writes `public/generated-images/comic_<id>.png`.
3. **Export the chapter** — `POST /chapter/export` inlines every page PNG as a
   `data:` URI into one self-contained HTML file in `exports/`.

## Routes (`/api/mods/curiouser-comic/...`)

| Method + path | What it does |
| --- | --- |
| `GET /state` | Pending beats + composed pages. |
| `POST /panel` | Record a panel-worthy beat (`caption`, `dialogue`, `imagePrompt` or `imageUrl`). |
| `POST /page/compose` | Composite the pending beats into a comic page PNG. |
| `POST /chapter/export` | Assemble all pages into a self-contained HTML chapter (`{title, subtitle}`). |
| `DELETE /reset` | Clear pending beats and pages. |

## Verify without a backend

`node mods/curiouser-comic/verify-compose.mjs` builds placeholder panels and runs the
real `composePage` + `exportChapterHtml`, writing `tmp/comic-page.png` and
`tmp/comic-chapter.html`. (The pure functions `composePage`, `exportChapterHtml`,
`computeLayout`, `wrapText` are exported for exactly this.)

## Design notes (from `docs/CURIOUSER/ENGINE_MAP.md` §4)

- **Text is never baked into the diffusion image** — panels are generated with a
  negative prompt excluding text/bubbles; all lettering is composited by `sharp`, so
  it's crisp and editable. `wrapText` wraps manually (sharp/librsvg has no auto-layout).
- **Output goes to `public/generated-images`** (the proven statically-served path).
- **v0 export is HTML**, not PDF/CBZ — neither dependency exists in the tree and
  `sharp` can't emit those containers (a v1 decision: add `pdf-lib` or `jszip`).
- The image queue is **serial** (`maxConcurrentJobs: 1`) with a **2-min per-job
  timeout**, so pages are capped at 6 panels and generation of missing panels is
  awaited sequentially. Requires an image backend (`config.imagegen`) for real panels.
- **Consistency across panels** (same character face/costume) is the Milestone 4
  problem (ComfyUI + IP-Adapter); v0 uses independent text-to-image per panel.
