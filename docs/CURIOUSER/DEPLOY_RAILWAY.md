# Deploying Curiouser on Railway (or any Node host)

The repo ships a cloud entrypoint, `scripts/railway-start.mjs`, that makes one deploy
fully playable: it materializes `config.yaml` from environment variables, enables the
Curiouser mods, stages the reskin (setting + lorebook), starts the server, and
auto-applies the Curiouser setting once it's up. `railway.json` and `Procfile` both point
Railway at that entrypoint.

## Why a wrapper is needed

The engine reads its config from `config.yaml` (gitignored — it holds secrets) and its
port from `config.server.port`, **not** `process.env.PORT` (which Railway injects). The
wrapper bridges both and injects your provider keys from the Railway environment.

## Steps

1. **Create a Railway project from the GitHub repo** (the GitHub app is already
   connected). Railway auto-detects Node (Nixpacks), runs `npm install`, and starts
   `node scripts/railway-start.mjs` (from `railway.json`).
2. **Set environment variables** (Railway → Variables):

   | Variable | Required | Purpose |
   | --- | --- | --- |
   | `AI_ENDPOINT` | yes | OpenAI-compatible base URL (e.g. `https://nano-gpt.com/api/v1`). |
   | `AI_API_KEY` | yes | Your LLM key. Without it the server boots but turns fail. |
   | `AI_MODEL` | yes | A capable, XML-reliable model (GLM-4.x / Deepseek-V3.x / Kimi). |
   | `IMAGE_ENGINE` | for images | Exactly one bare token — `openai`, `nanogpt`, or `comfyui` (use `openai` for the fast prototype). Do **not** include a description like "openai (fast prototype)". |
   | `IMAGE_API_KEY` | for images | Image provider key. |
   | `IMAGE_ENDPOINT` | optional | Override image endpoint. |
   | `IMAGE_MODEL` | optional | Override image model. |
   | `IMAGEGEN_ENABLED` | optional | `false` to run text-only (no images). |
   | `PORT` | auto | Railway sets this; the wrapper maps it to `config.server.port`. |
   | `CURIOUSER_AUTO_APPLY` | optional | `false` to skip auto-applying the setting. |

3. **Deploy.** On boot you should see, in the logs:
   `Wrote config.yaml ...` → `Server is running on http://0.0.0.0:<PORT>` →
   `Image generation ready (<engine>)` → `[railway-start] Applied the Curiouser setting.`
4. **Play.** Open the Railway URL, start a New Game (Curiouser is already the active
   setting), and play. The economy mod's routes live at
   `/api/mods/curiouser-economy/...` and the comic mod's at `/api/mods/curiouser-comic/...`.

## Persistence (important)

Railway's container filesystem is **ephemeral** — it resets on each redeploy/restart.
`saves/`, `saves/settings/`, `lorebooks/`, `public/generated-images/`, and `exports/`
live on disk. The reskin is re-staged on every boot (idempotent), so the setting and
lorebook always return, but **game saves and generated comic pages will be lost on
redeploy** unless you attach a **Railway Volume** mounted over those paths. For durable
play, mount a volume at the repo root (or specifically over `saves/` and
`public/generated-images/`).

## Local equivalent

```bash
npm install
PORT=7777 AI_ENDPOINT=... AI_API_KEY=... AI_MODEL=... \
  IMAGE_ENGINE=openai IMAGE_API_KEY=... node scripts/railway-start.mjs
```

## Notes

- The `openai` image engine required a one-line engine fix (`server.js` listen-callback
  log referenced a ComfyUI-only config path for every non-nanogpt engine and crashed on
  boot). That's fixed in this fork.
- No PDF/CBZ export dependency is bundled; comic chapters export as self-contained HTML
  (see `mods/curiouser-comic`).
