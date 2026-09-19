import { useEffect, useRef, useState } from 'react';

interface CameraStatus {
  ids: number[];
  map_points?: number;
  inliers?: number;
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
  const reason = !fresh ? '影像連線中斷／等待更新' : tracking ? '自然特徵定位中' :
    status?.pose_tracking === 'initializing' ? '請朝有紋理的環境緩慢側移，建立地圖' : '追蹤中斷：轉回已建圖區域，或重建地圖';

  return <aside className="case-note case-note-camera">
    <span className="note-pin" aria-hidden="true" />
    <div className="note-camera-heading">
      <h2>相機畫面</h2><span>{status?.fps?.toFixed(1) ?? '—'} FPS</span>
    </div>
    <img ref={image} alt="Logitech 相機即時畫面與自然特徵" className="aspect-[4/3] w-full bg-black object-contain" />
    <div className="space-y-1 px-3 py-2 text-xs" role="status">
      <p className={tracking ? 'text-green-300' : 'text-amber-300'}>{reason}</p>
      <p>地圖點：{status?.map_points ?? 0} · 定位內點：{status?.inliers ?? 0}</p>
      <button className="text-blue-300" onClick={async () => { try { const response = await fetch('/api/camera/reset', { method: 'POST' }); if (!response.ok) throw Error('reset failed'); } catch { setOffline(true); } }}>重建地圖</button>
    </div>
  </aside>;
}
