# PALMBAY HEAT

[![PALMBAY HEAT on make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![Rank](https://make.fun/badge/gta6-01/Jaka1603/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![Reward](https://make.fun/badge/gta6-01/Jaka1603/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

An original open-world crime game built with three.js, made for the make.fun bounty **"Make GTA 6"** (gta6-01). You play Dario Venn, a driver-for-hire climbing the Palm Bay underworld: cruise a procedural city, dodge the law, and work through five story missions — from a first pickup job to a full-blown downtown heist — while the wanted system keeps every escape tense.

## How to run

```bash
node serve.ts
```

Then open <http://localhost:8080>. Or serve the `game/` folder with any static file server and open `index.html`.

## Controls

- **WASD** — walk / drive
- **E** — enter / exit a car
- **F** — punch
- **Click** — shoot
- **1 / 2** — switch weapon, **R** — reload
- **Shift** — sprint
- **P** — pause

## Features

- Procedural city: streets, buildings, traffic, and pedestrians
- Wanted system (0–5 stars) with police pursuit and escape
- 5 story missions with objectives, checkpoints, and rewards
- On-foot and driving combat with weapon switching
- HUD + minimap, mission tracker, and cash display
- Save / continue progress
- Synthesized sound effects and music via WebAudio (no audio files)

## v2 visual polish (San Andreas-class)

- Every surface textured: asphalt with patches and lane markings, sidewalk slabs, building facades with lit windows, sand, grass, water
- Warm sunset grading: gradient sky dome with sun disc, horizon-matched fog, ACES tone mapping, long golden-hour shadows
- LSPD black/white police cruisers (POLICE doors, light bar, push bumper) + uniformed officers + busted scene
- Palm Bay gang turf (green) with bandana members carrying rifles and pistols
- Ambient life: bird flocks in V formation, seagulls over the pier, a dog that follows a pedestrian, a cat that crosses the road
- Red convertible hero car with interior, seats, plates and racing stripes; brake lights, headlight glow, exhaust puffs

## v3 review fixes (Jaka's list)

- Natural trees everywhere: tapered trunks + layered rounded canopies (no more palm spikes), placed by a validating builder — zero trees inside buildings (≥1.5 m clearance) and zero on roads
- Street lamps every ~28 m with warm emissive heads and glow, instanced for performance
- Sidewalks stop at junctions instead of painting across them; zebra crossings on every leg of every intersection
- Traffic lights at avenue junctions, stop signs at minor ones, benches along sidewalks and the promenade
- Every citizen rebuilt as a LEGO-style minifigure: studded cylindrical head, printed smile, printed torso details (police badge, gang chain, civil prints), C-shaped hands
- Full bug-audit pass: building collision for player/cars/police, mission-flow fixes (the escape mission now raises its 3 stars; the chase needs its 3 rams), traffic lane discipline, parked cars at real curbs, occlusion-correct shooting, corrected minimap arrow and shoreline

## Screenshots

- [Cover — Palm Bay at dusk](screenshots/1-cover.jpg)
- [On foot — downtown Palm Bay](screenshots/2-foot.jpg)
- [Mission — the getaway](screenshots/3-mission.jpg)
- [Title screen](screenshots/4-title.jpg)

## License

MIT — see [LICENSE](LICENSE).
