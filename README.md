# Lofi Yeti Runner

A 3D endless runner built with **Three.js (0.174.0)**, **React**, and **Vite** starring five sculpted, toon-outlined **Lofi & Mystic Yetis** inspired by `lofitheyeti.com`.

## Running Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser. To build for production:

```bash
npm run build
```

## Playable Lofi & Mystic Yetis Roster

1. **OG Lofi** (0 SUI coins) — *Chill Flow*: +30% bonus stunt points on Backflips & Tail-Whip Spins plus extended air hang-time.
2. **Inferno Blaze** (100 SUI coins) — *Flame Surge*: +2.5s longer Energy Sword duration and wider forward fiery slash reach.
3. **Neon Slime** (220 SUI coins) — *Elastic Bounce*: +14% higher Jump & Backflip clearance with springy slime landing bounce.
4. **Half-Cyborg** (360 SUI coins) — *Magnet Core*: Passive magnetic field pulling nearby lane SUI coins toward you.
5. **Void Shadow** (500 SUI coins) — *Phase Step*: Starts every run with +1 Void Shield to absorb a hit & longer post-hit invulnerability.

## Controls

- **Desktop**: `A` / `D` or `←` / `→` switch lanes · `Space` / `W` / `↑` jump (press again in mid-air for a **Backflip**) · `S` / `↓` slide · `X` tail-whip spin in air · `Z` sword slash · `Enter` / `Space` start · `Esc` / `P` pause.
- **Touch / Mobile**: Swipe left or right to switch lanes · Swipe up to jump · Swipe down to slide · Tap on the ground to jump · Tap in mid-air for a tail-whip spin.

## Customizing Assets

- **Yeti Model (`/public/assets/yeti.glb`)**: Drop a rigged `.glb` with clips named `run`, `jump`, `slide`, `flip`, `fly`, `hit`, `slash` at `/public/assets/yeti.glb`. If absent, the game renders the 5 sculpted toon-outlined 3D Lofi & Mystic Yeti rigs.
- **Gallery Night Artwork**: Configure `ART_URLS` in `src/game/config.ts`. Missing images automatically use generated procedural fallbacks.
- **Audio Hooks**: Configure sound file paths in `AUDIO_CONFIG` (`src/game/config.ts`).

## Adding a New 3D Scene

1. Add a scene ID to `SceneId` (`src/game/types.ts`), `SCENE_ORDER`, and `SCENE_NAMES` (`src/game/config.ts`).
2. Add lighting/fog/sky configuration in `SCENE_SPECS` and a `buildYourScene()` builder in `WorldManager` (`src/game/scenes.ts`).
3. Add a road texture branch in `createRoadTexture()` (`src/game/textures.ts`) and a scene-specific obstacle group in `EntityPoolManager` (`src/game/pools.ts`).
