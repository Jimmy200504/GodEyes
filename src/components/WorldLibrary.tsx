import type { WorldScene } from "../utils/worldScenes";
import EvidenceBoard from "./EvidenceBoard";
import CaseFolders from "./CaseFolders";

interface WorldLibraryProps {
  scenes: WorldScene[];
  onCreate: () => void;
  onOpen: (scene: WorldScene) => void;
}

/** Filed in the order they should be read: the puzzle first, then the case
 * that actually happened. */
const CASE_IDS = ["shared-scene-v2", "bright-truvia"];

export default function WorldLibrary({
  scenes,
  onCreate,
  onOpen,
}: WorldLibraryProps): JSX.Element {
  const cases = CASE_IDS.map((id) =>
    scenes.find((scene) => scene.id === id),
  ).filter((scene): scene is WorldScene => Boolean(scene));
  // Cases first, then whatever has been submitted since.
  const filed = [
    ...cases,
    ...scenes.filter((scene) => !CASE_IDS.includes(scene.id)),
  ];

  return (
    <main className="page page-noir">
      <EvidenceBoard cases={cases} onOpen={onOpen} onCreate={onCreate} />
      <CaseFolders scenes={filed} onOpen={onOpen} onCreate={onCreate} />
      <footer className="page-foot">
        <span>GODEYES · 走進現場</span>
        <span>SEE MORE · FIND TRUTH</span>
      </footer>
    </main>
  );
}
