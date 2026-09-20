import { useCallback, useRef, useState } from "react";
import type { WorldScene } from "../utils/worldScenes";
import { useViewerParallax } from "../hooks/useViewerParallax";
import SplatWordmark from "./SplatWordmark";
import BoardBackdrop, {
  type BoardBackdropHandle,
  type WallStatus,
} from "./BoardBackdrop";
import BoardString from "./BoardString";
import KnifeSwitch from "./KnifeSwitch";

/**
 * The landing board.
 *
 * The wall is the reconstruction, greyed back; the evidence is pinned onto it
 * at a shallower depth, and the whole stage is projected off-axis from the
 * viewer. With the camera on, that viewpoint is your head — the same signal the
 * explorer runs on. The page argues by moving, so it says almost nothing.
 */

/** What is moving the viewpoint, for the readout. */
const DRIVE: Record<string, string> = {
  idle: "自動巡視",
  pointer: "游標驅動",
  head: "頭部姿態驅動",
};

/** The wall is the street scene, not the office: an exterior has structure at
 * every heading, which is what a backdrop needs once the board covers the
 * middle of it. */
const WALL_SCENE = "bright-truvia";
/** Where the wall camera rests, in degrees. Tilted down off the open sky and
 * onto the street, which is where the structure is. */
const WALL_HEADING = 0;
const WALL_TILT = -26;

/** One continuous run, threaded round the board rather than across it. */
const STRING_ORDER = ["brief", "mark", "case-0", "slip", "case-1", "track"];

interface EvidenceBoardProps {
  cases: WorldScene[];
  onOpen: (scene: WorldScene) => void;
  onCreate: () => void;
}

export default function EvidenceBoard({
  cases,
  onOpen,
  onCreate,
}: EvidenceBoardProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<BoardBackdropHandle | null>(null);
  const [wall, setWall] = useState<WallStatus>("loading");
  const onStatus = useCallback((next: WallStatus) => setWall(next), []);

  const { source, headStatus, enableHead, disableHead } = useViewerParallax(
    stageRef,
    { onFrame: (x, y) => backdropRef.current?.aim(x, y) },
  );

  const firstReady = cases.find((scene) => scene.status === "ready");
  const tracking = headStatus === "live";

  return (
    <section className="board" aria-labelledby="board-title">
      <div className="board-stage" ref={stageRef}>
        {/* The wall behind the board is the reconstruction, held back in grey. */}
        <div className="board-wall">
          <BoardBackdrop
            scene={cases.find((item) => item.id === WALL_SCENE)}
            heading={WALL_HEADING}
            tilt={WALL_TILT}
            handleRef={backdropRef}
            onStatus={onStatus}
          />
        </div>

        <p className="board-hud" aria-hidden="true">
          <b data-state={wall}>{wall === "ready" ? "LIVE" : "SOLVE"}</b>
          <span>
            {wall === "ready" && `3D GAUSSIAN SPLATTING · ${DRIVE[source]}`}
            {wall === "loading" && "正在載入現場點雲…"}
            {wall === "error" && "點雲無法載入"}
          </span>
        </p>

        <div className="board-cork" ref={boardRef}>
          <BoardString order={STRING_ORDER} boardRef={boardRef} />

          {/* The wordmark, circled in marker the way a name gets circled. */}
          <div className="board-item board-mark" data-depth="near">
            <span className="pin" data-anchor="mark" aria-hidden="true" />
            <h1 id="board-title" className="sr-only">
              GodEyes — 走進現場
            </h1>
            <SplatWordmark />
            <svg
              className="marker-ring"
              viewBox="0 0 400 140"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {/* A long word gets a long loop, not an ellipse — and the second
                  pass misses the join and runs on, the way a hand does. */}
              <path
                vectorEffect="non-scaling-stroke"
                d="M14 60c0-32 16-40 60-44 76-7 226-7 282-1 28 3 32 19 31 55-1 34-9 52-43 56-84 8-234 7-294 1-30-4-39-19-38-61 2-22 16-34 82-40"
              />
            </svg>
            <p className="marker-note">See more · Find truth</p>
          </div>

          {/* The claim, typed up as a report rather than set as a slogan. */}
          <div className="board-item brief" data-depth="near">
            <span className="pin" data-anchor="brief" aria-hidden="true" />
            <p className="brief-kicker">GODEYES · 現場重建</p>
            <h2 className="brief-claim">
              用 <em>world model</em>
              <br />
              重建犯案現場。
            </h2>
            <p className="brief-body">
              一張現場照片，解算成 <b>3D Gaussian Splatting</b>
              的點雲；戴上裝置走進去，看見的東西由你站的位置和頭轉的方向決定，而不是由拍照的人決定。
            </p>
          </div>

          {/* Not a slogan — the label a case file actually carries. */}
          <div className="board-item slip" data-depth="near">
            <span className="pin" data-anchor="slip" aria-hidden="true" />
            <p className="slip-head">
              <span>CASE FILE</span>
              <b>№ GE-0045</b>
            </p>
            <dl className="slip-rows">
              <div>
                <dt>輸入</dt>
                <dd>單一視角現場照片 · 最多 4 張</dd>
              </div>
              <div>
                <dt>模型</dt>
                <dd>World Model（Marble）</dd>
              </div>
              <div>
                <dt>表示</dt>
                <dd>3D Gaussian Splatting · .SPZ</dd>
              </div>
              <div>
                <dt>視角</dt>
                <dd>頭部姿態 · 六自由度</dd>
              </div>
              <div>
                <dt>輸出</dt>
                <dd className="slip-live">可以走進去的三維現場</dd>
              </div>
            </dl>
            <p className="slip-foot">
              這面牆本身就是重建出來的。左半是解算出的高斯點，右半是從同一組點算出的畫面。
            </p>
            <span className="stamp" aria-hidden="true">
              衍生視覺化<b>NOT EVIDENCE</b>
            </span>
          </div>

          <div className="board-item tape-actions" data-depth="near">
            {firstReady && (
              <button className="tape tape-red" onClick={() => onOpen(firstReady)}>
                直接進入現場 <b>→</b>
              </button>
            )}
            <button className="tape" onClick={onCreate}>
              重建你的現場 <b>→</b>
            </button>
          </div>

          {/* The cases, as pinned prints. */}
          {cases.map((scene, index) => (
            <button
              key={scene.id}
              className="board-item print"
              style={{ "--i": index } as React.CSSProperties}
              onClick={() => onOpen(scene)}
            >
              <span
                className="pin"
                data-anchor={`case-${index}`}
                aria-hidden="true"
              />
              <span className="print-img">
                <img
                  src={scene.thumbnail}
                  alt={`${scene.name} 的重建預覽`}
                  loading="lazy"
                />
              </span>
              <span className="print-class">
                {scene.id === "bright-truvia" ? "REAL CASE" : "FAKE CASE"}
              </span>
              <span className="print-name">{scene.name}</span>
            </button>
          ))}

          <div className="board-item knife-slot" data-depth="near">
            <span className="board-anchor" data-anchor="track" aria-hidden="true" />
            <KnifeSwitch
              status={headStatus}
              onToggle={tracking ? disableHead : enableHead}
            />
          </div>

        </div>
      </div>
      <div className="board-grain" aria-hidden="true" />
    </section>
  );
}
