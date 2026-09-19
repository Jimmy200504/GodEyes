import { ArrowLeft, RotateCcw, NotebookPen } from 'lucide-react';
import type { WorldScene } from '../utils/worldScenes';
import { useEffect, useMemo, useRef, useState } from 'react';
import ThreeView from './ThreeView';
import { connectPoseSocket } from '../utils/poseSocket';
import GesturePanel from './GesturePanel';
import type { GestureTelemetry } from '../utils/gestureSocket';
import CameraPreview from './CameraPreview';
import type { HeadPose } from '../utils/headPose';
import { RemotePoseTracker } from '../utils/remotePose';

export default function RemoteExplorer({ scene, onBack }: { scene: WorldScene; onBack: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const tracker = useRef(new RemotePoseTracker(true, true, true));
  const [pose, setPose] = useState<HeadPose | null>(null);
  const [smoothing, setSmoothing] = useState(true);
  const [posePrediction, setPosePrediction] = useState(false);
  const [allowCoast, setAllowCoast] = useState(false);
  const [renderSmoothing, setRenderSmoothing] = useState(true);
  const [poseEpoch, setPoseEpoch] = useState(0);
  const [rtt, setRtt] = useState(0);
  const [estimated, setEstimated] = useState(false);
  const [gestureTelemetry, setGestureTelemetry] = useState<GestureTelemetry | null>(null);
  const [gestureStatus, setGestureStatus] = useState('等待手勢 NPU');
  const [gain, setGain] = useState(1.5);
  const [status, setStatus] = useState('等待邊緣裝置');

  const scaledPose = useMemo(() => pose && pose.position ? { ...pose, position: { x: pose.position.x * gain, y: pose.position.y * gain, z: pose.position.z * gain } } : pose, [pose, gain]);

  useEffect(() => connectPoseSocket((packet, ageMs) => {
    setEstimated(packet.scale !== 'metric');
    const next = tracker.current.update(packet, ageMs);
    setPose(next ? { ...next, sampleTimeMs: packet.capture_monotonic_ns/1e6, ageMs } : null);
    setAllowCoast(!next && packet.tracking === 'lost' && tracker.current.status === '追蹤狀態：lost');
    setStatus(tracker.current.status);
  }, message => {
    tracker.current.hold();
    setAllowCoast(false);
    setPose(null);
    setStatus(message);
  }, value => setRtt(Math.round(value))), []);

  return <main className="scene-explorer">
    <ThreeView scene={scene} mode="remote" onGestureTelemetry={setGestureTelemetry} onGestureStatus={setGestureStatus} headPose={scaledPose} renderSmoothing={renderSmoothing} posePrediction={posePrediction} allowCoast={allowCoast} poseEpoch={poseEpoch} />
    <nav className="scene-toolbar" aria-label="場景控制">
      <button onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />返回</button>
      <button onClick={() => { tracker.current.reset(); setAllowCoast(false); setPose(null); setPoseEpoch(value => value + 1); }}>
        <RotateCcw size={16} aria-hidden="true" />Reset
      </button>
      <button aria-expanded={detailsOpen} aria-controls="scene-details" onClick={() => setDetailsOpen(open => !open)}>
        <NotebookPen size={17} aria-hidden="true" />詳細資訊
      </button>
    </nav>
    {detailsOpen && <section id="scene-details" className="case-board" aria-label="現場筆記" onKeyDown={event => { if (event.key === 'Escape') setDetailsOpen(false); }}>
    <div className="case-board-notes">
    <section className="case-note case-note-settings">
      <span className="note-pin" aria-hidden="true" />
      <h2>{scene.name}</h2>
      <p role="status" className="note-status">{status}</p>
      <p className="text-xs text-gray-300">張掌前進，食指控制左右與高低。</p>
      <p className="text-xs text-gray-300">握拳或收手停止，收手後接回頭部追蹤。</p>
      <p className="text-xs text-gray-300">{estimated ? '目前使用相對尺度，可調整下方位移倍率。' : '姿態與位移依裝置回傳資料更新。'}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={smoothing} onChange={event => {
          setSmoothing(event.target.checked);
          tracker.current.setSmoothing(event.target.checked);
        }} />
        姿態防抖
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={renderSmoothing} onChange={event => setRenderSmoothing(event.target.checked)} />
        畫面平滑
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={posePrediction} onChange={event => setPosePrediction(event.target.checked)} />
        旋轉預測（實驗功能）
      </label>
      {posePrediction && <p className="text-xs text-amber-300">畫面可含短暫預測；上方狀態仍是真實追蹤結果，lost 不代表已恢復。</p>}
      <p className="text-xs text-gray-400">WebSocket · 往返約 {rtt} ms</p>
      <label className="block text-sm">位移倍率 {gain}× <input aria-label="位移倍率" type="range" min="0" max="30" step="0.5" value={gain} onChange={e => setGain(Number(e.target.value))} /></label>
      <p className="text-xs text-gray-400">緩慢側移初始化 · 不需要 ArUco · 尚無閉環校正</p>
    </section>
    <CameraPreview />
    <GesturePanel data={gestureTelemetry} status={gestureStatus} />
    </div>
    </section>}
  </main>;
}
