export type SceneStatus =
  | "queued"
  | "cleaning"
  | "review"
  | "generating"
  | "downloading"
  | "ready"
  | "error";
export interface WorldScene {
  id: string;
  name: string;
  description?: string;
  source: "preset" | "generated";
  thumbnail: string;
  spzUrl?: string;
  status: SceneStatus;
  images?: string[];
  cleanImage?: string;
  prompt?: string;
  error?: string;
  canRetry?: boolean;
  stage?: "clean" | "world";
  createdAt?: string;
  updatedAt?: string;
  transform?: { scale: number; rotationX: number };
}
export const WORLD_SCENES: WorldScene[] = [
  {
    id: "shared-scene-v2",
    name: "誰才是兇手",
    description:
      "三個人都來過這間辦公室，三個人的說法都成立。站在各自的位置上，誰真的看得到桌上那支手機？",
    source: "preset",
    thumbnail: "/scenes/previews/shared-scene-v2.webp",
    spzUrl: "/scenes/shared-scene-v2-full-res.spz",
    status: "ready",
  },
  {
    id: "bright-truvia",
    name: "Bright 與 Truvia 案",
    description:
      "唯一的目擊證詞來自一扇窗。那個角度究竟看不看得見兇案？兩人為此坐了 27 年牢，後獲平反。",
    source: "preset",
    thumbnail: "/scenes/previews/bright-truvia.webp",
    spzUrl: "/scenes/bright-truvia-full-res.spz",
    status: "ready",
  },
];
export const STATUS_LABELS: Record<SceneStatus, string> = {
  queued: "等待整理",
  cleaning: "Codex 整理中",
  review: "等待檢視",
  generating: "Marble 生成中",
  downloading: "下載世界中",
  ready: "可探索",
  error: "需要處理",
};
export function isSceneActive(status: SceneStatus): boolean {
  return ["queued", "cleaning", "generating", "downloading"].includes(status);
}

export function sceneStage(scene?: WorldScene): number {
  if (!scene) return 0;
  if (scene.status === "ready") return 3;
  if (scene.status === "generating" || scene.status === "downloading") return 2;
  if (scene.status === "error" && scene.stage === "world") return 2;
  return 1;
}

export function sceneMessage(scene: WorldScene): string | undefined {
  switch (scene.status) {
    case "error":
      return scene.error;
    case "review":
      return "檢查影像中的人物、物件與空間關係，再送往 Marble。";
    case "ready":
      return "世界已儲存在本機，隨時都能再次進入。";
    default:
      return "任務在背景執行。你可以離開此頁，完成後再回來。";
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : "請檢查輸入內容後重試",
    );
  return result as T;
}
