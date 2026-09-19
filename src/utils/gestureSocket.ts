import type { GestureCommand } from './gestureNavigation';

/** Pull one result at a time so a slow browser never replays queued motion. */
export function connectGestureSocket(
  onCommand: (command: GestureCommand, ageMs: number) => boolean,
  onStop: () => void,
  onStatus: (status: string) => void,
): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout>;
  let timer: ReturnType<typeof setTimeout>;
  let requested = 0;
  const halt = (status: string) => { onStop(); onStatus(status); };
  const connect = () => {
    if (stopped) return;
    const url = new URL('/api/gesture/ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    socket = ws;
    const pull = () => {
      requested = performance.now();
      ws.send('next');
      timer = setTimeout(() => { halt('手勢逾時，已停止'); ws.close(); }, 1000);
    };
    timer = setTimeout(() => ws.close(), 1500);
    ws.onopen = () => { clearTimeout(timer); pull(); };
    ws.onmessage = event => {
      if (stopped || socket !== ws) return;
      clearTimeout(timer);
      try {
        const data = JSON.parse(event.data);
        const age = data.age_ms + performance.now() - requested;
        if (data.version !== 1 || typeof data.age_ms !== 'number' || data.age_ms < 0) throw Error('invalid packet');
        if (data.status && data.status !== 'tracking') {
          halt(data.status === 'stale' ? '手勢影格過期，已停止' : '等待相機影格，已停止');
        } else if (document.hidden || !document.hasFocus()) {
          halt('頁面未啟用，手勢已停止');
        } else if (onCommand(data.command, age)) {
          const labels: Record<string, string> = { Open: '張掌 · 移動', Point: '食指 · 旋轉', Close: '握拳 · 停止', None: '未偵測到手 · 停止', Unknown: '手勢不確定 · 停止' };
          onStatus(labels[data.gesture] ?? '手勢停止');
        } else halt('手勢資料過期或無效，已停止');
        pull();
      } catch { halt('手勢資料異常，已停止'); ws.close(); }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (stopped || socket !== ws) return;
      clearTimeout(timer);
      halt('手勢未連線，已停止；正在重連');
      retry = setTimeout(connect, 500);
    };
  };
  const blur = () => halt('頁面未啟用，手勢已停止');
  window.addEventListener('blur', blur);
  document.addEventListener('visibilitychange', blur);
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(retry);
    socket?.close();
    window.removeEventListener('blur', blur);
    document.removeEventListener('visibilitychange', blur);
    onStop();
  };
}
