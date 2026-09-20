import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The red string.
 *
 * Anchors are measured from the laid-out board rather than hard-coded, so the
 * run still lands on the pins at any width. It draws itself in once, the way
 * someone would thread it.
 */

interface BoardStringProps {
  /** `data-anchor` values, in the order the string is threaded. */
  order: string[];
  boardRef: React.RefObject<HTMLElement>;
}

interface Point {
  x: number;
  y: number;
}

export default function BoardString({
  order,
  boardRef,
}: BoardStringProps): JSX.Element | null {
  const [points, setPoints] = useState<Point[]>([]);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const pathRef = useRef<SVGPathElement>(null);

  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const origin = board.getBoundingClientRect();
    if (!origin.width) return;
    const next: Point[] = [];
    for (const name of order) {
      const node = board.querySelector<HTMLElement>(`[data-anchor="${name}"]`);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      next.push({
        x: rect.left - origin.left + rect.width / 2,
        y: rect.top - origin.top + rect.height / 2,
      });
    }
    setBox({ width: origin.width, height: origin.height });
    setPoints(next);
  }, [boardRef, order]);

  useLayoutEffect(() => {
    measure();
    const board = boardRef.current;
    if (!board) return;
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    return () => observer.disconnect();
  }, [boardRef, measure]);

  // Fonts land after first paint and move the notes under the pins.
  useEffect(() => {
    if (!document.fonts?.ready) return;
    void document.fonts.ready.then(measure);
  }, [measure]);

  useEffect(() => {
    const path = pathRef.current;
    if (!path || points.length < 2) return;
    const length = path.getTotalLength();
    path.style.setProperty("--run", `${length}`);
  }, [points]);

  if (points.length < 2 || !box.width) return null;

  // Straight runs with a slight sag: string is pulled taut but never perfectly.
  const d = points
    .map((point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      const previous = points[index - 1];
      const midX = (previous.x + point.x) / 2;
      const midY = (previous.y + point.y) / 2 + 10;
      return `Q ${midX} ${midY} ${point.x} ${point.y}`;
    })
    .join(" ");

  return (
    <svg
      className="board-string"
      viewBox={`0 0 ${box.width} ${box.height}`}
      width={box.width}
      height={box.height}
      aria-hidden="true"
    >
      <path className="board-string-shadow" d={d} />
      <path ref={pathRef} className="board-string-run" d={d} />
    </svg>
  );
}
