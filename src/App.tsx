import { useEffect, useRef, useState } from 'react';
import ThreeView from './components/ThreeView';
import CameraPreview from './components/CameraPreview';
import type { HeadPose } from './utils/headPose';
import { RemotePoseTracker } from './utils/remotePose';

export default function App() {
  const tracker = useRef(new RemotePoseTracker(true));
  const [pose, setPose] = useState<HeadPose | null>(null);
  const [smoothing, setSmoothing] = useState(true);
  const [estimated, setEstimated] = useState(false);
  const [status, setStatus] = useState('等待邊緣裝置');

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller = new AbortController();
    const poll = async () => {
      controller = new AbortController();
      const started = performance.now();
      const timeout = setTimeout(() => controller.abort(), 1000);
      try {
        const response = await fetch('/api/pose', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('receiver unavailable');
        const data = await response.json();
        if (stopped) return;
        if (data.pose) {
          setEstimated(data.pose.scale === 'estimated');
          const next = tracker.current.update(data.pose, data.age_ms + performance.now() - started);
          if (next) setPose(next);
          setStatus(tracker.current.status);
        } else {
          tracker.current.hold();
          setStatus('等待邊緣裝置傳送姿態，保留最後視角');
        }
      } catch {
        if (!stopped) {
          tracker.current.hold();
          setStatus('連線中斷，視角已凍結；正在重新連線');
        }
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(poll, 33);
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, []);

  return <main className="h-screen w-screen relative bg-black">
    <ThreeView headPose={pose} />
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
      <button className="rounded bg-blue-600 px-3 py-2" onClick={() => tracker.current.reset()}>
        重設位置與正前方
      </button>
    </div>
  </main>;
}
