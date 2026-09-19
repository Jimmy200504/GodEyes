# World scenes

The scene selector uses only these two full-resolution Marble SPZ exports:

| Asset | Original source under `../Imagegen` |
| --- | --- |
| `bright-truvia-full-res.spz` | `bright-truvia/world-model-BT-HYP-07-close-sidewalk-plus/world-full_res.spz` |
| `shared-scene-v2-full-res.spz` | `Fake Scene/world-model-shared-scene-v2/world-full_res.spz` |

Scene definitions live in `src/utils/worldScenes.ts`. Bright Truvia is the default.
Switching releases the previous scene; loading failures allow retrying or selecting the other scene.
The old shoe, wireframe room, and lo-fi sample are no longer displayed.
