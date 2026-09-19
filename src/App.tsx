import { useEffect, useMemo, useRef, useState } from 'react';
import ThreeView from './components/ThreeView';
import { connectPoseSocket } from './utils/poseSocket';
import GesturePanel from './components/GesturePanel';
import type { GestureTelemetry } from './utils/gestureSocket';
import CameraPreview from './components/CameraPreview';
import type { HeadPose } from './utils/headPose';
import { RemotePoseTracker } from './utils/remotePose';

export default function App() {
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

  return <main className="h-screen w-screen relative bg-black">
    <ThreeView onGestureTelemetry={setGestureTelemetry} onGestureStatus={setGestureStatus} headPose={scaledPose} renderSmoothing={renderSmoothing} posePrediction={posePrediction} allowCoast={allowCoast} poseEpoch={poseEpoch} />
    <CameraPreview />
    <GesturePanel data={gestureTelemetry} status={gestureStatus} />
    <div className="absolute bottom-4 left-4 z-20 rounded-lg bg-black/80 p-4 text-white space-y-2">
      <h1 className="font-bold">GodEyes · 無標記 SLAM ＋手勢控制</h1>
      <p role="status">{status}</p>
      <p role="status" className="text-sm text-cyan-300">{gestureStatus}</p>
      <p className="text-xs text-gray-300">張掌：移動 · 食指：旋轉 · 手移向畫面上下左右控制方向</p>
      <p className="text-xs text-gray-300">手放中央、握拳或移出畫面：停止</p>
      <p className="text-xs text-gray-300">{estimated ? 'Mac 瀏覽器渲染 · 任意尺度，可調整虛擬位移倍率' : '邊緣裝置傳送姿態 · 本機渲染場景 · 位移與旋轉 1:1'}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={smoothing} onChange={event => {
          setSmoothing(event.target.checked);
          tracker.current.setSmoothing(event.target.checked);
        }} />
        姿態防抖（減少細微抖動，會增加些微延遲）
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={renderSmoothing} onChange={event => setRenderSmoothing(event.target.checked)} />
        畫面平滑（逐畫面更新）
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={posePrediction} onChange={event => setPosePrediction(event.target.checked)} />
        實驗：旋轉外推（最多 100 ms，可能猜錯）
      </label>
      {posePrediction && <p className="text-xs text-amber-300">畫面可含短暫預測；上方狀態仍是真實追蹤結果，lost 不代表已恢復。</p>}
      <p className="text-xs text-gray-400">WebSocket · 往返約 {rtt} ms</p>
      <label className="block text-sm">位移倍率 {gain}× <input aria-label="位移倍率" type="range" min="0" max="30" step="0.5" value={gain} onChange={e => setGain(Number(e.target.value))} /></label>
      <p className="text-xs text-gray-400">緩慢側移初始化 · 不需要 ArUco · 尚無閉環校正</p>
      <button className="rounded bg-blue-600 px-3 py-2" onClick={() => { tracker.current.reset(); setAllowCoast(false); setPose(null); setPoseEpoch(value => value + 1); }}>
        重設位置與正前方
      </button>
    </div>
  </main>;
}
