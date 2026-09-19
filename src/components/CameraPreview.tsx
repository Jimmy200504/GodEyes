import { useEffect, useRef, useState } from 'react';

interface CameraStatus {
  ids: number[];
  fps: number;
  age_ms: number | null;
  error: string | null;
  pose_tracking?: string;
  pose_reason?: string | null;
  used_ids?: number[];
  target_ids?: number[];
}

export default function CameraPreview() {
  const image = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<CameraStatus | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let stopped = false;
    let imageTimer: ReturnType<typeof setTimeout>;
    let statusTimer: ReturnType<typeof setTimeout>;
    let imageController = new AbortController();
    let statusController = new AbortController();
    let currentUrl = '';
    const frames = async () => {
      imageController = new AbortController();
      const timeout = setTimeout(() => imageController.abort(), 2000);
      try {
        const response = await fetch('/api/camera/frame.jpg', { cache: 'no-store', signal: imageController.signal });
        if (!response.ok) throw new Error('preview unavailable');
        const blob = await response.blob();
        if (stopped) return;
        const nextUrl = URL.createObjectURL(blob);
        if (image.current) image.current.src = nextUrl;
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = nextUrl;
        setOffline(false);
      } catch { if (!stopped) setOffline(true); }
      finally {
        clearTimeout(timeout);
        if (!stopped) imageTimer = setTimeout(frames, 100);
      }
    };
    const states = async () => {
      statusController = new AbortController();
      const timeout = setTimeout(() => statusController.abort(), 2000);
      try {
        const response = await fetch('/api/camera/status', { cache: 'no-store', signal: statusController.signal });
        if (!response.ok) throw new Error('status unavailable');
        const next: CameraStatus = await response.json();
        if (!stopped) setStatus(next);
      } catch { if (!stopped) setStatus(null); }
      finally {
        clearTimeout(timeout);
        if (!stopped) statusTimer = setTimeout(states, 500);
      }
    };
    void frames(); void states();
    return () => {
      stopped = true;
      clearTimeout(imageTimer); clearTimeout(statusTimer);
      imageController.abort(); statusController.abort();
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, []);

  const fresh = status?.age_ms != null && status.age_ms < 1000 && !status.error && !offline;
  const tracking = fresh && status?.pose_tracking === 'tracking';
  const targets = status?.target_ids ?? [0];
  const used = tracking ? status?.used_ids ?? [0] : [];
  const reason = !fresh ? '影像連線中斷／等待更新' : tracking ? '定位中' :
    status?.pose_reason === 'pose_quality_rejected' ? '已看到標記，姿態品質不足' :
    status?.pose_reason === 'marker_too_small' ? '標記太小，請靠近' :
    status?.ids.length ? '看到其他 ID，目前無法定位' : '未看到標記，視角保持不動';

  return <aside className="absolute bottom-4 right-4 z-30 w-80 max-w-[44vw] overflow-hidden rounded-lg border border-white/20 bg-black/85 text-white shadow-xl">
    <div className="flex justify-between px-3 py-2 text-xs">
      <span>相機即時預覽</span><span>{status?.fps?.toFixed(1) ?? '—'} FPS（處理）</span>
    </div>
    <img ref={image} alt="Logitech 相機即時畫面與 ArUco 框" className="aspect-[4/3] w-full bg-black object-contain" />
    <div className="space-y-1 px-3 py-2 text-xs" role="status">
      <p className={tracking ? 'text-green-300' : 'text-amber-300'}>{reason}</p>
      <p>看到 ID：{status?.ids.join('、') || '無'} · 參與定位：{used.join('、') || '無'}</p>
      <p className="text-gray-400">定位目標：{targets.join('、')} · {targets.length === 1 ? '單標記模式' : '多標記模式'}</p>
    </div>
  </aside>;
}
