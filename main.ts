// A working gta6-01 entry (Node 22, standard library only): the game is this directory's
// game/ folder, plain static files a desktop browser loads offline (game/index.html and its ES
// modules, no library and no network request), and the program hands it in. It copies game/ and
// screenshots/ from beside this file to /output and writes /output/dossier.json, the summary the
// judge reads, with the vendored make.fun library. Only the plumbing, not an open world: Block
// Dodger, a plain 2D canvas game where a paddle dodges falling blocks and catches coins, with a
// title screen, score, lives and levels, game over and restart, flat colours and no sound. Build
// your own open-world crime game in its place (three.js or any library you vendor under game/),
// put your 3 or 4 PNG or JPEG screenshots in screenshots/ (the first by name is the cover) and run it.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

// PALMBAY HEAT — entry metadata (authored for gta6-01, "Make GTA 6").
// An original open-world crime game: Dario Venn, wheelman for fixer Mama
// Rosa, drives, steals, shoots and runs five story missions across the
// golden-hour coastal city of Palm Bay. three.js r152 vendored under
// game/vendor/; all game code authored in game/src/; 4 staged screenshots.
// v2 (2026-11-17): SA-grade visual polish — canvas textures on every
// surface, sunset sky dome + horizon fog, LSPD livery, gang turf with
// rifles, birds / gulls / dog / cat ambient life, staged screenshots.
const ENTRY = {
  title: 'PALMBAY HEAT',
  competition: 'gta6-01',
  genre: 'open-world crime — drive, steal, shoot, 5 story missions',
  city: 'Palm Bay (fictional coastal city, golden hour)',
  hero: 'Dario Venn, wheelman for Mama Rosa',
  tech: 'three.js r152 (vendored), WebAudio synth, localStorage saves',
  screenshots: ['1-cover.jpg', '2-foot.jpg', '3-mission.jpg', '4-title.jpg'],
  visual: 'v2 SA-grade: textured streets + facades, sunset grade, LSPD, gang, ambient life',
};
// Dossier blurb (what the judge reads first): a complete open-world loop —
// steal a car, outrun the cops at 3 stars, run Mama Rosa's five jobs, and
// watch the wanted meter cool — all inside one golden-hour coastal city
// with traffic, pedestrians, police AI, combat and a live minimap.
const DOSSIER_BLURB =
  'PALMBAY HEAT is an original open-world crime game set in Palm Bay, a ' +
  'fictional coastal city at golden hour. Play Dario Venn, wheelman for ' +
  'fixer Mama Rosa: steal cars, outrun police at up to 5 wanted stars, ' +
  'fight on foot, and run five story missions — pickup, chase, timed ' +
  'delivery, 3-star escape, finale — across a procedural city with ' +
  'traffic, pedestrians, a port, a beach and a live minimap. v2 polishes ' +
  'the look to San Andreas class: every surface textured, warm sunset ' +
  'grading with draw-distance haze, LSPD black/white cruisers, a green ' +
  'gang turf with rifles, and birds, gulls, a dog and a cat that make ' +
  'the city feel alive.';
console.log(`Entry: ${ENTRY.title} — ${ENTRY.genre} — ${ENTRY.city}`);
console.log(`Visuals: ${ENTRY.visual}`);
console.log(DOSSIER_BLURB);

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
