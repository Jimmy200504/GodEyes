"""Interactive intrinsics calibration from unannotated frames of the active camera."""
import json
import threading
import time
from pathlib import Path
import cv2
import numpy as np
from calibrate import calibrate

PAGE = '''<!doctype html><meta charset="utf-8"><title>GodEyes 相機校正</title>
<style>body{background:#111827;color:white;font:18px system-ui;max-width:850px;margin:24px auto;padding:16px}img{max-width:100%}button,a{margin:8px;padding:12px}a{color:#93c5fd}p{line-height:1.7}</style>
<h1>相機校正</h1><p>手機開啟下方棋盤格連結，橫向顯示、關閉自動旋轉並固定畫面大小。相機需要看到完整棋盤和白邊；避免反光，停穩後再按「收集」。也可使用列印版。</p>
<a href="/markers/calibration-checkerboard.png" target="_blank">開啟棋盤格 PNG（給手機顯示）</a>
<a href="/markers/calibration-checkerboard-A4.pdf" target="_blank">下載 A4 棋盤格 PDF</a>
<p>至少收集 16 張：中央、四角、近／遠，並讓棋盤向左／右、上／下傾斜約 20–40 度。只原地重複拍正面不能完成校正。手機上格子的實際尺寸不影響焦距／畸變校正；之後定位仍使用實測 53 mm ArUco。</p>
<img id="preview"><p id="status">讀取中…</p>
<button onclick="act('capture')">收集這個角度</button><button onclick="act('solve')">計算校正</button><button onclick="act('apply')">套用校正</button><button onclick="act('reset')">重新收集</button>
<p>套用後回到 3D 頁面按「重設位置與正前方」。校正影像只存在板子本機。計算期間可能暫時影響定位 FPS。</p>
<script>
const base='/api/camera/calibration';let busy=false;
async function status(){try{const s=await(await fetch(base+'/status')).json();document.getElementById('status').textContent=`已收集 ${s.count} 張 · ${s.message}`;}catch{}setTimeout(status,500)}
async function act(action){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{const r=await fetch(base+'/'+action,{method:'POST'});const s=await r.json();document.getElementById('status').textContent=s.message;}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false)}}
async function frame(){try{const r=await fetch('/api/camera/frame.jpg');if(r.ok){const old=preview.src;preview.src=URL.createObjectURL(await r.blob());if(old.startsWith('blob:'))URL.revokeObjectURL(old)}}catch{}setTimeout(frame,150)}status();frame();
</script>'''


class CalibrationSession:
    def __init__(self, root='calibration'):
        self.root = Path(root)
        self.lock = threading.Lock()
        self.samples = []
        self.result = None
        self.message = '等待棋盤格；9×6 內角點'
        self.folder = self.root / str(time.time_ns())

    def status(self):
        with self.lock:
            return dict(count=len(self.samples), message=self.message,
                        ready=self.result is not None)

    def capture(self, frame):
        with self.lock:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            found, corners = cv2.findChessboardCornersSB(gray, (9, 6))
            if not found:
                raise ValueError('未看到完整棋盤格，請保留白邊、避開反光並停穩')
            corners = corners.reshape(-1, 2)
            # Reject nearly repeated views; additional static images do not constrain intrinsics.
            for _, old in self.samples:
                difference = min(np.mean(np.linalg.norm(corners-old, axis=1)),
                                 np.mean(np.linalg.norm(corners[::-1]-old, axis=1)))
                if difference < 12:
                    raise ValueError('角度太相似，請移到畫面其他位置或傾斜／改變距離')
            if len(self.samples) >= 40:
                raise ValueError('已達 40 張，請計算校正或重新收集')
            self.folder.mkdir(parents=True, exist_ok=True)
            path = self.folder / f'view-{len(self.samples):02d}.png'
            if not cv2.imwrite(str(path), frame):
                raise ValueError('無法儲存校正影像')
            self.samples.append((str(path), corners))
            self.result = None
            self.message = f'已收集 {len(self.samples)} 張，繼續變換位置、距離與傾角'

    def solve(self):
        with self.lock:
            if len(self.samples) < 16:
                raise ValueError('至少需要 16 個不同視角')
            paths = [p for p, _ in self.samples]
            points = np.array([c for _, c in self.samples])
            sample = cv2.imread(paths[0]); height, width = sample.shape[:2]
            centers = points.mean(axis=1)
            if np.ptp(centers[:,0]) < width*.2 or np.ptp(centers[:,1]) < height*.15:
                raise ValueError('畫面覆蓋不足，請補拍左右與上下區域')
            # Hold out every fourth image to check predictions, not merely training fit.
            train = [p for i,p in enumerate(paths) if i % 4 != 3]
            fitted = calibrate(train, 9, 6, 1.)
            k = np.array(fitted['camera_matrix']); dist = np.array(fitted['dist_coeffs'])
            objects = np.zeros((54,3),np.float32); objects[:,:2] = np.mgrid[:9,:6].T.reshape(-1,2)
            errors=[]; normals=[]
            for i,(_,corners) in enumerate(self.samples):
                ok,r,t=cv2.solvePnP(objects,corners,k,dist)
                if not ok: raise ValueError('校正視角解算失敗')
                rot,_=cv2.Rodrigues(r); normals.append(rot[:,2])
                if i % 4 == 3:
                    projected,_=cv2.projectPoints(objects,r,t,k,dist)
                    errors.append(float(np.sqrt(np.mean(np.sum((projected.reshape(-1,2)-corners)**2,axis=1)))))
            spread=max(np.arccos(np.clip(abs(np.dot(a,b)),0,1)) for a in normals for b in normals)
            if spread < np.deg2rad(20):
                raise ValueError('傾斜角度不足，請補拍左右／上下斜看的棋盤格')
            result=calibrate(paths,9,6,1.)
            result['validation_rms_px']=float(np.sqrt(np.mean(np.square(errors))))
            result['validation_max_px']=max(errors)
            result['pattern']='9x6 inner corners; square units arbitrary (intrinsics only)'
            k=np.array(result['camera_matrix'])
            if (result['rms_reprojection_px']>1 or max(errors)>1.5
                    or not (.25*width<k[0,0]<5*width and .25*width<k[1,1]<5*width)
                    or not (0<k[0,2]<width and 0<k[1,2]<height)):
                raise ValueError('校正品質不足，請避免模糊／反光並補拍多角度')
            path=self.folder/'camera.json';path.write_text(json.dumps(result,indent=2))
            self.result=str(path)
            self.message=f"校正完成：RMS {result['rms_reprojection_px']:.3f} px；保留視角 RMS {result['validation_rms_px']:.3f} px。可按套用"
            return self.result

    def reset(self):
        with self.lock:
            self.samples=[];self.result=None;self.folder=self.root/str(time.time_ns())
            self.message='已重設，舊影像仍保留在本機'
