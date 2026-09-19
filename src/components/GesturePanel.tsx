import type { GestureTelemetry } from '../utils/gestureSocket';

const labels: Record<string, string> = { Open: '張掌', Close: '握拳', Point: '食指', None: '未偵測到手', Unknown: '手勢不確定' };
const axes = [
  { key: 'forward', label: '前進', positive: '前進', negative: '停止' },
  { key: 'sideways', label: '左右', positive: '右移', negative: '左移' },
  { key: 'vertical', label: '高低', positive: '升高', negative: '降低' },
] as const;

export default function GesturePanel({ data, status }: { data: GestureTelemetry | null; status: string }) {
  const fresh = !!data?.accepted;
  const moving = fresh && Object.values(data.command).some(value => Math.abs(value) > 0.001);
  const backend = data?.backend === 'NPU' ? 'NPU 手部模型 · CPU 分類' : data?.backend === 'CPU' ? 'CPU 模式' : '推論裝置未回報';
  const diagnostics = data?.diagnostics;
  const ms = (value: number | null) => value == null ? '—' : `${Math.round(value)} ms`;
  const score = (value: number | null) => value == null ? '—' : `${Math.round(value * 100)}%`;
  const stages: Record<string, string> = { no_palm: '手掌未通過', landmark_rejected: '已找到手掌，骨架未通過', tracking: '骨架已通過，送入分類' };
  return <aside aria-label="手勢偵測結果" className="absolute top-4 right-4 z-30 w-80 max-w-[90vw] max-h-[45vh] overflow-y-auto rounded-lg border border-cyan-400/30 bg-black/85 p-3 text-white shadow-xl space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-bold">手勢偵測</h2>
      <span className={data?.connected ? 'text-xs text-cyan-300' : 'text-xs text-amber-300'}>{data?.connected ? 'Socket 已連線' : '等待連線'}</span>
    </div>
    <p className="text-xs text-gray-400">{backend}</p>
    <p className="text-xs text-cyan-300">{data?.slamClutched ? '手勢控制中 · SLAM 畫面更新暫停' : data?.slamResumeWaiting ? '等待新 SLAM 姿態接續' : 'SLAM 頭部控制'}</p>
    <div className="flex items-baseline justify-between">
      <p className="text-lg font-semibold">{labels[data?.gesture ?? 'None'] ?? '未知手勢'}{data && !fresh && <span className="ml-2 text-xs text-amber-300">非即時有效結果</span>}</p>
      <span className="text-sm tabular-nums">{data?.confidence != null ? `${Math.round(data.confidence * 100)}%` : '—'}</span>
    </div>
    <p className="text-xs text-gray-400">右側百分比為手勢分類信心</p>
    <p role="status" className={fresh ? 'text-xs text-cyan-300' : 'text-xs text-amber-300'}>{status}</p>
    <div className="grid grid-cols-2 gap-1 text-xs">
      {axes.map(axis => {
        const value = fresh ? (data.command[axis.key] ?? 0) : 0;
        return <div key={axis.key} className="flex justify-between rounded bg-white/5 px-2 py-1.5">
          <span className="text-gray-400">{axis.label}</span>
          <span className="tabular-nums">{Math.abs(value) > .001 ? `${value > 0 ? axis.positive : axis.negative} ${Math.round(Math.abs(value) * 100)}%` : '停止'}</span>
        </div>;
      })}
    </div>
    {fresh && !moving && (data.gesture === 'Open' || data.gesture === 'Point') && <p className="text-xs text-gray-300">停止中，請依上方提示操作</p>}
    <p className="text-xs text-gray-400">張掌前進；食指指左／右平移、指上／下升降；握拳停止。不需校正。</p>
    <p className="text-xs text-gray-400">指尖到手腕都要入鏡。收手或辨識不確定即停止；暫不提供後退與手勢旋轉。</p>
    <p className="text-xs text-gray-400 tabular-nums">推論 {data?.inferenceMs != null ? `${Math.round(data.inferenceMs)} ms` : '—'} · 資料年齡 {data ? `${Math.round(data.ageMs)} ms` : '—'}</p>
    {diagnostics && <div className="border-t border-white/15 pt-2 text-xs text-gray-300 space-y-1 tabular-nums">
      <p>{stages[diagnostics.stage] ?? '等待分段診斷'}{!fresh && '（上次結果）'}</p>
      <p>手掌 {score(diagnostics.palmScore)} / 門檻 50% · 骨架 {score(diagnostics.landmarkScore)} / 門檻 49%</p>
      <p>手部追蹤 {ms(diagnostics.trackingMs)} · CPU 分類 {ms(diagnostics.classificationMs)}</p>
      <p>相機取圖往返 {ms(diagnostics.frameRoundtripMs)} · 來源年齡 {ms(diagnostics.sourceAgeMs)}</p>
      <p>手勢 Socket 往返 {ms(diagnostics.socketRoundtripMs)}（含服務端等待）</p>
    </div>}
  </aside>;
}
