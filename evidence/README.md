# Real evidence bundles

Each folder holds the **exact bytes** exchanged with NEAR AI Cloud (model `Qwen/Qwen3.8-27B`, Private TEE)
and the TEE's ed25519 signature over `<model>:<sha256(request.json)>:<sha256(response.json)>`.
They were produced on 31 Oct 2026 with `verifier/make-evidence.mjs` (first versions with `tools/make_evidence.py`)
and submitted to the testnet contract. Anyone can re-check them offline: `npm run verify` in `verifier/`.

| folder | project / milestone | photo(s) | verdict |
|---|---|---|---|
| v2-M1-framing | VIENNA-02 / M1 drywall | open metal-stud framing | REJECTED |
| v2-M2-bare | VIENNA-02 / M2 floor tiling | bathroom with bare screed floor | REJECTED |
| v2-M2-mixed | VIENNA-02 / M2 floor tiling | two photos of *different* floors | NEEDS_MORE_EVIDENCE |
| v2-M2-clips | VIENNA-02 / M2 floor tiling | tiles in leveling clips, joints open | REJECTED |
| v2-M2-wide | VIENNA-02 / M2 floor tiling | wide shot of a finished, grouted floor | APPROVED |
| home-384-m1-rejected | HOME-384 / M1 floor tiling (created in the web app) | bathroom with bare screed | REJECTED |
| home-384-m1-needs_more_evidence | HOME-384 / M1 | one close-up of a finished floor | NEEDS_MORE_EVIDENCE |
| home-13745-m1-needs_more_evidence | HOME-13745 / M1 "floor fully tiled" | three close-ups of a real terrazzo floor (author's own photos) | NEEDS_MORE_EVIDENCE — cannot confirm the *whole* floor |
| hall-4545-m1-approved | HALL-4545 / M1 "tiles in the photographed section" | the same three photos | APPROVED — criteria scoped to what the photos can prove |
| test-M1 | VIENNA-01 / M1 kitchen drywall | synthetic test image | REJECTED |

Photo credits (Wikimedia Commons):
- "Light gage metal framing.JPG" by P199, public domain — https://commons.wikimedia.org/wiki/File:Light_gage_metal_framing.JPG
- "Mid-City New Orleans Bathroom - De-Floored.jpg" by Bart Everson, CC BY 2.0 — https://commons.wikimedia.org/wiki/File:Mid-City_New_Orleans_Bathroom_-_De-Floored.jpg
- "Brownish floor tiles.jpg" by Samiknoov, CC0 — https://commons.wikimedia.org/wiki/File:Brownish_floor_tiles.jpg
- "Tile floor example.jpg" by SubscribeTransport, CC0 — https://commons.wikimedia.org/wiki/File:Tile_floor_example.jpg
- "Verlegen von Fliesen mit einem Nivelliersystem.jpg" by Frank Winkelmann, CC0 — https://commons.wikimedia.org/wiki/File:Verlegen_von_Fliesen_mit_einem_Nivelliersystem.jpg
