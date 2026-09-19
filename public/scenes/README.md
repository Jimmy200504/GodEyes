# Marble sample environment

`lofi-world.spz` is the 500k-splat sample
`03facf44-511b-42d0-9ddb-9e2a0227e50e_500k.spz` referenced by Spark's
official Lofi Worlds example. Downloaded on 2026-09-19 (7,234,742 bytes).

- Preview: https://sparkjs.dev/examples/#lofi
- Asset list: https://github.com/sparkjsdev/spark/blob/main/examples/lofi/worlds.js
- Download: https://wlt-ai-cdn.art/tastier_spz_500/03facf44-511b-42d0-9ddb-9e2a0227e50e_500k.spz

The file is served locally; loading it requires no Marble account, API key,
or generation credits. Public availability is not a verified commercial or
redistribution license for the asset. Spark's software MIT license must not
be assumed to cover externally hosted scene content.

The app loads this environment by default. The top-left button switches back
to the original wireframe room. Loading failures retain the wireframe room.
The shoe and environment share the existing head-tracked off-axis camera.
Scene rotation, scale, and capture-origin placement are in `loadWorld()` in
`src/utils/threeScene.ts`; the initial scale is 0.3.
