import type { PosePacket } from './remotePose';

/** One acknowledged frame in flight; no HTTP pose polling or offline replay. */
export function connectPoseSocket(
  onPose: (pose: PosePacket, ageMs: number) => void,
  onHold: (message: string) => void,
  onLatency: (rttMs: number) => void,
): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout>;
  let opening: ReturnType<typeof setTimeout>;
  let lastValid = performance.now();
  let held = false;
  const hold = (message: string) => {
    if (!held) { held = true; onHold(message); }
  };
  const connect = () => {
    if (stopped) return;
    let lastKey = '';
    let offset = Infinity;
    const started = performance.now();
    let handshake = 0;
    const url = new URL('/api/pose/ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    socket = ws;
    opening = setTimeout(() => ws.close(), 1500);
    ws.onopen = () => { clearTimeout(opening); handshake = performance.now() - started; };
    ws.onmessage = event => {
      if (stopped || socket !== ws) return;
      try {
        const data = JSON.parse(event.data);
        const now = performance.now();
        if (!Number.isFinite(data.sent_monotonic_ms)) throw Error('invalid timestamp');
        ws.send(JSON.stringify({ ack: data.sent_monotonic_ms }));
        offset = Math.min(offset, now - data.sent_monotonic_ms);
        // Clock epochs differ. Detect extra queue delay relative to the best observed offset.
        const queueDelay = Math.max(0, now - data.sent_monotonic_ms - offset);
        const rtt = data.transport_rtt_ms || handshake;
        onLatency(rtt);
        if (!data.pose) { hold('等待姿態，保留最後視角'); return; }
        const age = data.age_ms + Math.max(queueDelay, rtt);
        if (!Number.isFinite(age) || age > 250) { hold('資料過期，視角已凍結'); return; }
        const p: PosePacket = data.pose;
        const key = JSON.stringify([p.session_id, p.map_id, p.seq]);
        if (key === lastKey) return;
        lastKey = key;
        lastValid = now;
        held = false;
        onPose(p, age);
      } catch { hold('姿態連線異常，正在重新連線'); ws.close(); }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (stopped || socket !== ws) return;
      clearTimeout(opening);
      hold('連線中斷，視角已凍結；正在重新連線');
      retry = setTimeout(connect, 500);
    };
  };
  const watchdog = setInterval(() => {
    if (performance.now() - lastValid > 250) hold('等待新姿態，視角已凍結');
  }, 50);
  connect();
  return () => { stopped = true; clearTimeout(retry); clearTimeout(opening); clearInterval(watchdog); socket?.close(); };
}
