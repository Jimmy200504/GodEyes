# Local tracking assets

- `wasm/`: copied from the installed `@mediapipe/tasks-vision` npm package, matching the bundled JavaScript runtime.
- `face_landmarker.task`: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

These assets are served locally for the hackathon demo. The active application does not need jsDelivr or Google Storage to start tracking. Updating tasks-vision requires refreshing `wasm/` from the same package version.
