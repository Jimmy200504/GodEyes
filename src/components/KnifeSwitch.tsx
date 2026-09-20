import type { HeadStatus } from "../hooks/useViewerParallax";

/**
 * The camera control, as a knife switch screwed to the board.
 *
 * Throwing a lever needs no sentence explaining it, which is the point: the
 * wall moves when you move, and the page would rather be understood by being
 * touched than by being read.
 */

const STATE: Record<HeadStatus, string> = {
  off: "OFF",
  loading: "···",
  live: "ON",
  denied: "NO CAM",
  unsupported: "N/A",
};

interface KnifeSwitchProps {
  status: HeadStatus;
  onToggle: () => void;
}

export default function KnifeSwitch({
  status,
  onToggle,
}: KnifeSwitchProps): JSX.Element {
  const on = status === "live";
  const dead = status === "unsupported" || status === "denied";

  return (
    <button
      type="button"
      className={`knife${on ? " knife-on" : ""}`}
      onClick={onToggle}
      disabled={status === "loading" || dead}
      aria-pressed={on}
      aria-label={on ? "關閉頭部追蹤" : "啟用頭部追蹤，用頭部姿態驅動視角"}
    >
      <span className="knife-plate" aria-hidden="true">
        <span className="knife-post knife-post-a" />
        <span className="knife-post knife-post-b" />
        <span className="knife-lever" />
        <span className="knife-lamp" />
      </span>
      <span className="knife-read" aria-hidden="true">
        <b>HEAD TRACK</b>
        <span>
          <i>{STATE[status]}</i>
          {status === "off" && "以頭部姿態驅動視角"}
          {status === "live" && "視角跟隨你的頭"}
          {status === "loading" && "正在開啟鏡頭"}
          {status === "denied" && "鏡頭權限被拒"}
          {status === "unsupported" && "此裝置無法追蹤"}
        </span>
      </span>
    </button>
  );
}
