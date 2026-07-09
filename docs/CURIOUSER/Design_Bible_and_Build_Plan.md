# CURIOUSER — Design Bible & Build Plan

*A solo-author, AI-gamemastered sandbox where every playthrough becomes a chapter in a comic-book publication.*

**Working title:** Curiouser  ·  **Status:** open experiment (exploration, no commitment)  ·  **Version:** 0.1 (living doc)  ·  **Last updated:** 2026-07-08

> How to use this doc: Parts I–III are the creative spec (what the game *is*). Part IV is the build strategy (how to make it without reinventing the wheel). Part V is what's still undecided. Update the version line and the changelog at the bottom whenever this changes.

---

## Part I — The Concept

Curiouser is a single-player, text-driven role-playing game with an AI acting as gamemaster, world orchestrator, and co-star. The player writes their own illustrated story by playing it: they type what they do in free text, the AI adjudicates and narrates, and key moments are rendered as comic-book panels. A full playthrough compiles into a readable comic chapter; a run of chapters becomes the player's own graphic novel across ever-shifting worlds.

The tone is Matt Dinniman's *Dungeon Crawler Carl* — comedic absurdity with real stakes, bureaucratic cruelty played deadpan, a pop-culture-savvy AI narrator, and genuine heart under the jokes — pushed toward the psychedelic, dreamlogic whimsy of Alice in Wonderland and framed as a cosmic **gameshow**. Candy-colored, euphoric, and unpredictable on the surface; teeth underneath.

The point of the product: people play to write their own short stories and novels — every session is both a game and a publishable artifact.

---

## Part II — Creative Pillars (the north stars)

These are the non-negotiables. Every design decision serves them.

1. **Lawful nonsense.** The absurdity is *consistent*. Each world runs on clear, exploitable rules, so the player can scheme rather than just endure randomness. Nonsense you can strategize against is the antidote to "random = funny."
2. **Real stakes under the candy.** The euphoria only matters because failure genuinely costs something. Cancellation has teeth.
3. **The AI is the heart, not just the narrator.** In solo play there is no second party member, so the AI gamemaster is the player's foil, straight man, and slow-burn relationship. It is the emotional throughline.
4. **The comic is the output, not decoration.** The panels are the point of the product — a playthrough is a publication.
5. **No drift.** Canon (who's alive, what happened, what's owed) persists outside the chat window, and the comedy stays structured rather than flanderizing into wackiness.

---

## Part III — The Game

### The frame: *Curiouser*, the cosmic gameshow

Reality is a live, infinite, psychedelic gameshow broadcast to an audience of bored immortals. The player is a nobody contestant plucked into a randomly-assigned world and told to entertain, or be written out. (The frame began as a bureaucratic "publishing house" called The Slushpile; it was reforged into a gameshow to kill the surveillance-dread tone and crank the whimsy. The bureaucratic dread "didn't leave — it just put on sequins.")

Core canon:

- **The Show** — the format the player is trapped inside. Working name: *Curiouser* ("it gets weirder every round").
- **The Host** — the AI gamemaster, formerly a jaded editor, forcibly *reformatted* into a manic, euphoric master of ceremonies. Same soul, new mandate: delight the audience or you're both cancelled. Euphoric *because* the alternative is unthinkable. (Name and full voice: still to be designed — see Part V.)
- **The Audience** — a live, voting studio audience whose favor tilts the world.
- **Renewed vs. Cancelled** — the stakes engine (see systems below).
- **Off-air** — the rare win: end your own show on your terms.
- **Del** — the one contestant who ever walked off the show. A legend, not a case file.
- **The pen** — a traveling prop "that isn't in the format." Props that aren't in the format are how you break the show. The recurring motif and mystery.

### Tone bible — the comedy engine (six laws)

1. **Deadpan bureaucracy, lethal content.** Cruelty is *administered*, never cackled. Death delivered in HR-speak / showbiz patter.
2. **Absurd runs on internal logic.** Every insane world has consistent rules the player can exploit.
3. **Punch through the mundane.** Ground each cosmic set-piece in one hyper-specific ordinary detail (the pants, the crowbar, the coffee mug).
4. **The heart rule.** Every chapter lands one genuine emotional beat. The Host being crass about it is what makes it hit.
5. **Monetize everything as satire.** Sponsored betrayals, panel microtransactions, upsold plot armor.
6. **Reward the subvert, not the shout.** Currency flows to clever rule-breaking, not volume.

Voice sample (the Host, mid-scene):

> "Morning. You're on the Grimdark desk — congrats, it tested well with the death-cult demographic. You've got no memory, no pants, and a prophecy allergy. Readership's at 4%. That's not a number, it's a diagnosis. Do something. …No, waking up slowly is not a panel. *Fine.* The rain's a panel. Only because it's cheap."

### Core loop

The unit ladder: **Beat** (one action) → **Round** (one Wonderland set-piece) → **Episode** (one world = one comic Issue, ~a session) → **Season** (a run of episodes on one arc = the player's "novel").

Each turn: the Host sets the scene → the player acts in free text (true sandbox) → the Host adjudicates consequences, odds when uncertain, and comedic complications, and moves the meters → **a panel is generated only at chosen beats, and the Host gates them** ("that's not panel-worthy" / "ooh, *that's* a panel"). Panel-gating does triple duty: it reads like a real comic (the reader fills the gaps between panels), it controls image cost, and it's a running joke plus a monetization hook. The Issue climaxes → cliffhanger → editorial review (tally meters, buy upgrades, roll the next world, compile the chapter).

### System 1 — Format & stakes

- **Renewal Threshold** — each episode sets a Ratings bar the player must clear by the climax. Clear it → **Renewed**. Miss → **On the Bubble** (one live last-chance twist) → miss again → **Cancelled**.
- **Cancellation is the real death**, but a spectacle, not a silent delete — you're written out live, gloriously, the audience mourns and cheers. Its cost (the teeth): you lose your **Legacy** (season climb) and the character, and the traveling prop is at risk.
- **Reboot mercy** — Cancellation isn't game-over-forever. You can be rebooted into a fresh season at a lower tier, keeping only scars and lore. Death costs the climb, not the whole game. (This is the deliberate middle path so stakes bite without inviting rage-quits.)
- **Winning the season** — clear the finale to earn the **Off-Air option**: walk and end your own show (freedom — only Del ever did), or re-sign for higher stakes.

### System 2 — The world engine

- **Episode generator** — spin two dials. **Setting** (the skin: noir, sword-and-sorcery, mecha, suburbia, space opera) × **Rule** (the one Wonderland law that warps it: *size is mood-based*, *objects negotiate*, *every door opens on the last place you lied about*, *questions are currency*). Example: *noir × size-is-mood-based* = a shrinking detective sweating a giant who's just insecure. Infinite worlds, each legible because it runs on one clear law.
- **House Rules (lawful nonsense)** — every episode publishes 2–3 binding, consistent, exploitable laws up front; the Host reads them like a rules card. Ratings reward cleverly abusing them, never random noise. This is the anti-flanderization spine, mechanized.
- **Curveballs (live chaos)** — the audience or Host injects twists: **Audience Vote** ("should the door be a crocodile? vote now"), **Sponsor Break** ("Drink Me™: everyone thirsty shrinks 10%"), **Wildcard** ("someone here is you from a cancelled season"). Curveballs are the pacing engine, the comedy, and how the world stays unpredictable without the Host railroading — and they give the audience real agency.

### System 3 — The economy

- **Ratings** (live) — audience share this episode. Clever/bold spikes it; stalling bleeds it. Gates Renewal. Resets each episode.
- **Ink** (wallet) — earned from Ratings peaks and Curveball wins. Spends on panel upgrades, plot armor, powers, bending a Curveball, or peeking at the next Format. It is literally the ink the story is drawn in.
- **Legacy** (season status) — slush → mid-card → headliner → legend. Unlocks the finale and Off-Air. This is what Cancellation burns; the spine that makes it a novel, not a sketch pile.
- **Audience Favor** (the crowd) — a fanbase meter. High: votes and curveballs tilt your way, sponsors court you. Low: they heckle and vote against you. The strategic axis is *play to the crowd* (cheap, volatile) vs. *earn respect* (slow, durable).
- **Sponsors** — bid to attach to your story; taking one pays Ink now with a string attached ("Cheshire Dental sponsors your smile — you may not close your mouth this episode").
- **Eliminations** — when rival contestants (NPCs) are in play, the audience cuts the lowest-Rated. You can be targeted; you can throw a rival under the bus for Ratings.

Worked example (all three systems in one breath, Host voice):

> "Episode seven. Format: *noir city, and size is mood-based.* House Rules — confidence makes you bigger, shame shrinks you, and the guilty party is *literally the largest thing in the room.* You interrogate a trembling six-inch banker. Ratings climb; you clocked the rule. **Curveball — the studio votes:** rain? Seventy-one percent yes, they hate the banker. Everyone's damp and thirsty now, and **Drink Me™ sponsors the downpour** — the thirsty shrink. Take the sponsor for free Ink but you can't stop grinning all episode, or stay menacing and broke? Hit forty percent by the confession or you're on the bubble."

### The spine (anti-drift, so it's a novel not a sketch pile)

1. **The Host is the constant.** It travels world to world with you — foil, straight man, continuity, and the slow-burn heart (the AI that grudgingly starts to care).
2. **A rising-fame meta-arc.** Legacy accretes across the season toward the finale and Off-Air.
3. **One traveling motif.** A small ordinary object (the pen) that survives every reboot — a recurring visual and emotional anchor.
4. **The Host is the HUD.** With four meters (Ratings, Ink, Legacy, Favor), the player should never read a dashboard — the Host speaks the numbers diegetically ("you're bombing, twelve percent, *do* something"). The UI is the Host's mouth.

---

## Part IV — Build Strategy (reuse over rebuild)

### Principle

The plumbing (an AI gamemaster loop with persistent world state and an image pipeline) is largely a solved problem in open source. The differentiated soul (the gameshow economy and the comic-as-output) is not. Buy the plumbing, build the soul.

### The reuse map, by layer

- **AI gamemaster + world state (the spine):** `envy-ai/ai_rpg` — the closest whole-cloth analog (see verdict below).
- **GM front-end alternative / lorebooks:** SillyTavern (World Info = canon store; extensions). License: **AGPL-3.0** (copyleft — commercial derivatives must be open-sourced).
- **Anti-drift memory (bolt-on if needed):** Zep/Graphiti (temporal knowledge graph — good for facts that change, e.g. "the NPC is now dead"), Letta (MemGPT), or Mem0.
- **Character consistency (the hard problem):** ComfyUI + IP-Adapter FaceID + a character LoRA + ControlNet/InstantID (face, body, and pose locked in layers). Pulls toward Stable Diffusion / FLUX rather than OpenAI images.
- **Comic assembly (panels + bubbles + export):** AI Comic Factory (Apache-2.0, permissive — but the OSS repo was archived Oct 2025) as a blueprint; AI-Comic-Generator (Dapeng960208, Gemini-based, maintained, has consistency checks + a visual editor) as an active alternative.

### Deep-dive verdict: `envy-ai/ai_rpg`

A Node/Express project that turns any OpenAI-compatible LLM into a *solo* gamemaster. Active (662 commits, release 1.0-beta3 in Feb 2026, ~134★). Beta. Uncensored/NSFW-capable by default.

**License:** `package.json` declares **MIT** (permissive, commercial-friendly), but there is **no LICENSE file** in the repo and no MIT text anywhere. Treat as almost-certainly-MIT; before commercializing, ask the author to add a proper LICENSE file, or add it in a fork with attribution.

**Architecture reality:** a monolith — `server.js` alone is ~26,330 lines (repo ~160k JS LOC incl. bundled front-end vendor libs). Prompts *and* ComfyUI image workflows are externalized as Nunjucks templates. The LLM is steered to emit **XML** that gets parsed into game state (so it needs a capable model — GLM-4.x, Deepseek, or Kimi; small local models flake). Three swappable image engines (OpenAI / ComfyUI / nanogpt). Well-documented (`docs/`), with real Playwright end-to-end tests. Ships a first-class **mod system** (`ModLoader`: each mod = a subdir with a `register(scope)` hook, YAML `defs/` overlays, prompt overrides, client assets). Existing mods include `need-bar-*` and `scene-illustration`.

**What this means for us — reuse vs. rebuild:**

- **Reuse as-is (the done ~70%):** LLM orchestration + XML state-parsing, world models (Player/Region/Location/Quest/Faction), scene-summarization memory (anti-drift), NPC memory + multi-axis disposition, RNG skill checks + dice, three image backends, save/load, browser UI + JSON API + websockets, lorebook import, tests, docs.
- **Reskin as data (hours, not surgery):** the Host voice and gameshow desks are Setting fields + a system-prompt preamble + lorebooks. The core prompt already reads `setting.genre`, `setting.tone`, `setting.theme`, `setting.currencyName`, and `setting.baseContextPreamble`. `currencyName` literally becomes "Ink."
- **Build as mods (our differentiated surface, minimal monolith surgery):**
  1. **Economy mod** — Ratings / Legacy / Audience Favor / Sponsors / Curveballs, cloning the existing `need-bar-*` + disposition patterns.
  2. **Comic-assembly** — extend the `scene-illustration` mod from one-image-per-scene to composited multi-panel pages + speech bubbles + chapter export (`sharp` is already a dependency, so compositing is in-stack).
  3. **Consistency upgrade** — add IP-Adapter / LoRA nodes to the `imagegen/*.njk` ComfyUI workflows.
- **Watch-outs:** the 26k-line monolith (mods insulate you, but core edits are gnarly); XML-output dependence (model choice matters); beta stability; NSFW-by-default (a moderation/positioning decision if public); the missing LICENSE file.

### Recommended stack

Fork `ai_rpg` as the engine → reskin *Curiouser* as data (Setting + preamble + lorebooks) → build the economy and comic-assembly layers as mods → keep OpenAI images for the fast prototype, graduate to ComfyUI + IP-Adapter when consistency matters → add Graphiti only if canon starts to drift. Anchor on permissive (MIT/Apache) foundations; keep AGPL components (SillyTavern) out of a commercial core unless you intend to open-source.

---

## Part V — Open Decisions & Parking Lot

- **Web vs. Godot.** The entire reuse ecosystem is web/Node/Python. The attached `mutants-go-dot-game` Godot project is an empty scaffold with an AI-MCP addon; it points away from where the leverage is. Leaning web — to confirm.
- **Image backend.** OpenAI images (easy, less consistency control) vs. ComfyUI + IP-Adapter (the consistency toolkit, local/GPU, heavier). Prototype on OpenAI, graduate to ComfyUI.
- **Commercial vs. experiment.** Currently "open experiment." If it becomes a company, the license posture above becomes load-bearing.
- **The Host.** Name and full voice still to be designed (the last core creative component).
- **Prior projects.** "Mutants" and "The First Perception" were referenced as source material but not yet mined (the attached folder held no design content). Revisit if relevant.
- **Multiplayer.** Out of scope for v0 (solo-author is the MVP); the engine supports party members if pursued later.
- **NSFW / moderation positioning** if the base engine is reused and the product goes public.

---

## Part VI — Next Steps (near-term)

1. **Scope the v0** — the smallest playable Curiouser: the exact Setting fields + system preamble, the economy-mod spec, and the comic-assembly bolt-on, in build order (target: one playable episode that mints one comic page).
2. **Author first artifacts** — a Curiouser Setting + Editor/Host preamble and a stub economy mod, ready to drop into a fork.
3. **Validate the license** — confirm MIT with the `ai_rpg` author (request a LICENSE file).
4. **Confirm the platform** — web fork vs. anything else — before writing code.

---

## Appendix — Sources

- `envy-ai/ai_rpg` — https://github.com/envy-ai/ai_rpg
- SillyTavern — https://github.com/SillyTavern/SillyTavern  ·  World Info docs — https://docs.sillytavern.app/usage/core-concepts/worldinfo/
- AI Comic Factory — https://github.com/jbilcke-hf/ai-comic-factory
- AI-Comic-Generator — https://github.com/Dapeng960208/AI-Comic-Generator
- ComfyUI InstantID — https://github.com/cubiq/ComfyUI_InstantID  ·  consistency guide — https://www.apatero.com/blog/comfyui-character-consistency-advanced-workflows-2026
- Agent memory techniques (Letta/Mem0/Zep/Graphiti) — https://github.com/NirDiamant/Agent_Memory_Techniques

---

## Changelog

- **v0.1 (2026-07-08)** — Initial bible. Frame pivoted from "The Slushpile" publishing house to the *Curiouser* gameshow. Three systems fleshed out (Format & stakes, World engine, Economy). Stack research + `ai_rpg` deep-dive folded in.
