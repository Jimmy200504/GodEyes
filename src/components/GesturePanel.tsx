import type { GestureTelemetry } from '../utils/gestureSocket';

const labels: Record<string, string> = { Open: '張掌', Close: '握拳', Point: '食指', None: '未偵測到手', Unknown: '手勢不確定' };
const axes = [
  { key: 'forward', label: '前後', positive: '前進', negative: '後退' },
  { key: 'sideways', label: '左右', positive: '右移', negative: '左移' },
  { key: 'vertical', label: '高低', positive: '升高', negative: '降低' },
  { key: 'yaw', label: '轉向', positive: '左轉', negative: '右轉' },
  { key: 'pitch', label: '俯仰', positive: '抬頭', negative: '低頭' },
] as const;

export default function GesturePanel({ data, status, onCalibrate }: { data: GestureTelemetry | null; status: string; onCalibrate: () => void }) {
  const fresh = !!data?.accepted;
  const moving = fresh && Object.values(data.command).some(value => Math.abs(value) > 0.001);
  const backend = data?.backend === 'NPU' ? 'NPU 手部模型 · CPU 分類' : data?.backend === 'CPU' ? 'CPU 模式' : '推論裝置未回報';
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
    <button type="button" disabled={!data?.connected} onClick={onCalibrate} className="rounded bg-cyan-800 px-3 py-2 text-xs disabled:opacity-40">掌心朝外校正（手背朝鏡頭）</button>
    <p className="text-xs text-gray-400">校正時張掌保持不動，完成後先握拳。換手時需校正。</p>
    <p className="text-xs text-gray-400 tabular-nums">推論 {data?.inferenceMs != null ? `${Math.round(data.inferenceMs)} ms` : '—'} · 資料年齡 {data ? `${Math.round(data.ageMs)} ms` : '—'}</p>
  </aside>;
}
