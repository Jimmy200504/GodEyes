export const WORLD_SCENES = [
  { id: 'bright-truvia', label: 'Bright Truvia · 人行道', file: 'bright-truvia-full-res.spz' },
  { id: 'shared-scene-v2', label: 'Fake Scene · 共享場景 v2', file: 'shared-scene-v2-full-res.spz' },
] as const;

export type WorldSceneId = typeof WORLD_SCENES[number]['id'];
