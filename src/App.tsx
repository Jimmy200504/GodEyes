import { useEffect, useRef, useState } from 'react';
import ThreeView from './components/ThreeView';
import { connectPoseSocket } from './utils/poseSocket';
import CameraPreview from './components/CameraPreview';
import type { HeadPose } from './utils/headPose';
import { RemotePoseTracker } from './utils/remotePose';

export default function App() {
  const tracker = useRef(new RemotePoseTracker(true));
  const [pose, setPose] = useState<HeadPose | null>(null);
  const [smoothing, setSmoothing] = useState(true);
  const [renderSmoothing, setRenderSmoothing] = useState(true);
  const [poseEpoch, setPoseEpoch] = useState(0);
  const [rtt, setRtt] = useState(0);
  const [estimated, setEstimated] = useState(false);
  const [status, setStatus] = useState('等待邊緣裝置');

  useEffect(() => connectPoseSocket((packet, ageMs) => {
    setEstimated(packet.scale === 'estimated');
    const next = tracker.current.update(packet, ageMs);
    setPose(next);
    setStatus(tracker.current.status);
  }, message => {
    tracker.current.hold();
    setPose(null);
    setStatus(message);
  }, value => setRtt(Math.round(value))), []);

  return <main className="h-screen w-screen relative bg-black">
    <ThreeView headPose={pose} renderSmoothing={renderSmoothing} poseEpoch={poseEpoch} />
    <CameraPreview />
    <div className="absolute bottom-4 left-4 z-20 rounded-lg bg-black/80 p-4 text-white space-y-2">
      <h1 className="font-bold">GodEyes · 頭戴相機 6DoF</h1>
      <p role="status">{status}</p>
      <p className="text-xs text-gray-300">{estimated ? 'Mac／本機瀏覽器渲染 · 未校正示範，請勿用於距離量測' : '邊緣裝置傳送姿態 · 本機渲染場景 · 位移與旋轉 1:1'}</p>
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
      <p className="text-xs text-gray-400">WebSocket · 往返約 {rtt} ms</p>
      <a className="block text-sm text-blue-300" href="/api/camera/calibration" target="_blank" rel="noopener">相機校正</a>
      <button className="rounded bg-blue-600 px-3 py-2" onClick={() => { tracker.current.reset(); setPose(null); setPoseEpoch(value => value + 1); }}>
        重設位置與正前方
      </button>
    </div>
  </main>;
}
