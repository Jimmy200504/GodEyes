import type { GestureCommand } from './gestureNavigation';

export interface GestureTelemetry {
  slamClutched?: boolean;
  slamResumeWaiting?: boolean;
  handPresent: boolean;
  connected: boolean;
  accepted: boolean;
  gesture: string;
  confidence: number | null;
  backend: string;
  inferenceMs: number | null;
  ageMs: number;
  command: GestureCommand;
}
const zeroCommand = (): GestureCommand => ({ forward: 0, sideways: 0, vertical: 0, yaw: 0, pitch: 0 });

export type GestureConnection = (() => void) & { calibratePalm: () => boolean };

/** Pull one result at a time so a slow browser never replays queued motion. */
export function connectGestureSocket(
  onCommand: (command: GestureCommand, ageMs: number) => boolean,
  onStop: () => void,
  onStatus: (status: string) => void,
  onTelemetry?: (data: GestureTelemetry) => void,
): GestureConnection {
  let stopped = false;
  let calibrationPending = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout>;
  let timer: ReturnType<typeof setTimeout>;
  let requested = 0;
  let freshTimer: ReturnType<typeof setTimeout>;
  let telemetry: GestureTelemetry = { handPresent: false, connected: false, accepted: false, gesture: 'None', confidence: null, backend: 'unknown', inferenceMs: null, ageMs: 0, command: zeroCommand() };
  const emit = () => onTelemetry?.({ ...telemetry });
  const halt = (status: string) => {
    clearTimeout(freshTimer);
    onStop(); onStatus(status);
    telemetry = { ...telemetry, accepted: false, command: zeroCommand() };
    emit();
  };
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
    ws.onopen = () => { clearTimeout(timer); telemetry.connected = true; emit(); pull(); };
    ws.onmessage = event => {
      if (stopped || socket !== ws) return;
      clearTimeout(timer);
      try {
        const data = JSON.parse(event.data);
        const age = data.age_ms + performance.now() - requested;
        if (data.version !== 1 || typeof data.age_ms !== 'number' || !Number.isFinite(age) || data.age_ms < 0) throw Error('invalid packet');
        clearTimeout(freshTimer);
        if (typeof data.control_hint === 'string' && data.control_hint.startsWith('校正')) calibrationPending = false;
        telemetry = {
          handPresent: data.hand_present === true || (data.hand_present === undefined && ['Open', 'Close', 'Point', 'Unknown'].includes(data.gesture)),
          connected: true, accepted: false,
          gesture: typeof data.gesture === 'string' ? data.gesture : 'Unknown',
          confidence: typeof data.confidence === 'number' && Number.isFinite(data.confidence) && data.confidence >= 0 && data.confidence <= 1 ? data.confidence : null,
          backend: data.backend === 'NPU' || data.backend === 'CPU' ? data.backend : 'unknown',
          inferenceMs: typeof data.inference_ms === 'number' && Number.isFinite(data.inference_ms) && data.inference_ms >= 0 ? data.inference_ms : null,
          ageMs: age, command: zeroCommand(),
        };
        if (data.status && data.status !== 'tracking') {
          halt(data.status === 'stale' ? '手勢影格過期，已停止' : '等待相機影格，已停止');
        } else if (document.hidden || !document.hasFocus()) {
          halt('頁面未啟用，手勢已停止');
        } else if (calibrationPending) {
          halt('等待校正開始，已停止');
        } else if (onCommand(data.command, age)) {
          telemetry.accepted = true;
          telemetry.command = { ...data.command };
          freshTimer = setTimeout(() => { telemetry.ageMs = 250; halt('手勢資料過期，已停止'); }, Math.max(0, 250 - age));
          const labels: Record<string, string> = { Open: '張掌', Point: '食指 · 平移', Close: '握拳 · 停止', None: '未偵測到手 · 停止', Unknown: '手勢不確定 · 停止' };
          const hint = typeof data.control_hint === 'string' ? data.control_hint.slice(0, 100) : '';
          onStatus((labels[data.gesture] ?? '手勢停止') + (hint ? ` · ${hint}` : ''));
        } else halt('手勢資料過期或無效，已停止');
        emit();
        pull();
      } catch { halt('手勢資料異常，已停止'); ws.close(); }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (stopped || socket !== ws) return;
      clearTimeout(timer);
      telemetry.connected = false;
      halt('手勢未連線，已停止；正在重連');
      retry = setTimeout(connect, 500);
    };
  };
  const blur = () => halt('頁面未啟用，手勢已停止');
  window.addEventListener('blur', blur);
  document.addEventListener('visibilitychange', blur);
  connect();
  const disconnect = () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(freshTimer);
    clearTimeout(retry);
    socket?.close();
    window.removeEventListener('blur', blur);
    document.removeEventListener('visibilitychange', blur);
    onStop();
  };
  disconnect.calibratePalm = () => {
    if (!stopped && socket?.readyState === WebSocket.OPEN) {
      calibrationPending = true;
      halt('校正中：張掌，手背朝鏡頭，保持不動');
      socket.send('calibrate_palm_out');
      return true;
    }
    halt('手勢未連線，無法校正');
    return false;
  };
  return disconnect;
}
