"""Python webcam GUI in a browser. Trusted hackathon network only."""
import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import cv2
import numpy as np
from aruco_pose import DICTIONARY
from aruco_sender import LatestSender
from pose_pipeline import PosePipeline

PAGE = """<!doctype html><html lang="zh-Hant"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>GodEyes 相機預覽</title>
<style>body{background:#111827;color:white;font:17px system-ui;margin:24px auto;padding:0 16px;max-width:900px}img{width:100%;max-width:800px;border-radius:12px;background:black}p{line-height:1.7}a{color:#93c5fd}#status{font-size:22px;margin:16px 0}button{padding:10px}</style>
<h1>GodEyes · 相機即時預覽</h1><div id="status" role="status">正在連線…</div>
<img id="camera" alt="Logitech C270 即時影像"><p id="details"></p><p id="pose-status" role="status"></p>
<p>把手機的 B 放進畫面，保留完整白邊；辨識後出現綠框與 ID 0。<br>黑色正方形邊長 5.5 cm；手機位置與顯示大小需固定。預覽和姿態傳送使用同一批影格。</p>
<button id="full">放大畫面</button> <a id="render" target="_blank" rel="noopener">開啟 3D 場景</a>
<script>
const im=document.getElementById('camera'),st=document.getElementById('status');
document.getElementById('render').href=location.protocol+'//'+location.hostname+':5173';
document.getElementById('full').onclick=()=>im.requestFullscreen?.();
async function frame(){try{const r=await fetch('/frame.jpg',{cache:'no-store',signal:AbortSignal.timeout(2000)});
if(!r.ok)throw Error();const u=URL.createObjectURL(await r.blob()),old=im.src;im.src=u;
if(old.startsWith('blob:'))URL.revokeObjectURL(old);}catch{st.textContent='鏡頭畫面暫時無法取得';}setTimeout(frame,100);}
async function status(){try{const r=await fetch('/status',{cache:'no-store',signal:AbortSignal.timeout(2000)}),s=await r.json();
const fresh=s.age_ms!==null&&s.age_ms<1000;
st.textContent=s.error?'相機錯誤：'+s.error:!fresh?'等待新影格…':s.found?'已偵測到 B（ID 0）':'尚未偵測到 B，請調整相機／手機方向';
st.style.color=fresh&&s.found?'#86efac':'#fbbf24';
document.getElementById('details').textContent=`${s.width} × ${s.height} · 處理約 ${s.fps} FPS · ID：${s.ids.join(', ')||'無'} · B 最短邊 ${s.min_side_px} px`;
const why={calibration_required:'尚未校正，未啟用姿態追蹤',resolution_mismatch:'影像尺寸不符校正',marker_missing_or_duplicate:'找不到唯一 B',marker_too_small:'B 太小，請靠近',pose_quality_rejected:'姿態解算品質不足'};
document.getElementById('pose-status').textContent=s.pose_tracking==='tracking'?(s.scale==='estimated'?'姿態解算中 · 未校正粗估，距離與角度可能有誤差':'姿態解算中 · 已載入校正'):(why[s.pose_reason]||'等待姿態解算');
}catch{st.textContent='預覽連線中斷';}setTimeout(status,500);}frame();status();
</script></html>"""


class Camera:
    def __init__(self, device, pipeline, sender):
        self.pipeline = pipeline
        self.sender = sender
        self.device = device
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.jpg = None
        self.updated = None
        self.state = dict(found=False, ids=[], fps=0, width=0, height=0, min_side_px=0, error=None)
        self.worker = threading.Thread(target=self.run, daemon=True)
        self.worker.start()

    def run(self):
        while not self.stop.is_set():
            self.capture()
            self.stop.wait(2)

    def capture(self):
        cap = cv2.VideoCapture(self.device, cv2.CAP_V4L2)
        try:
            if not cap.isOpened():
                raise RuntimeError('Cannot open ' + str(self.device) + ' (device busy or unavailable); retrying')
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            detector = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(DICTIONARY),
                                             cv2.aruco.DetectorParameters())
            previous = time.monotonic()
            fps = 0
            while not self.stop.is_set():
                ok, frame = cap.read()
                if not ok:
                    raise RuntimeError('Camera read failed')
                captured = time.monotonic()
                corners, ids, _ = detector.detectMarkers(frame)
                packet, reprojection = self.pipeline.update(corners, ids,
                    (frame.shape[1], frame.shape[0]), captured)
                self.sender.put(packet, captured)
                values = [] if ids is None else [int(v) for v in ids.flatten()]
                found = values.count(0) == 1
                shortest = 0
                if found:
                    points = corners[values.index(0)].reshape(4,2)
                    shortest = round(float(np.min(np.linalg.norm(points-np.roll(points,1,axis=0),axis=1))),1)
                if ids is not None:
                    cv2.aruco.drawDetectedMarkers(frame, corners, ids)
                cv2.putText(frame, 'B detected - ID 0' if found else 'Looking for B (ID 0)',
                    (12,30), cv2.FONT_HERSHEY_SIMPLEX, .65, (0,255,0) if found else (0,190,255), 2)
                ok, jpeg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY,80])
                if not ok:
                    continue
                now = time.monotonic()
                fps = .9*fps + .1/max(now-previous,.001)
                previous = now
                with self.lock:
                    self.jpg = jpeg.tobytes()
                    self.updated = now
                    self.state = dict(found=found,ids=values,fps=round(fps,1),width=frame.shape[1],
                        height=frame.shape[0],min_side_px=shortest,error=None,
                        pose_tracking=packet['tracking'], pose_reason=packet['tracking_reason'],
                        scale=packet['scale'], position=packet['position'],
                        reprojection_error_px=reprojection)
        except Exception as error:
            with self.lock:
                self.state['error'] = str(error)
        finally:
            cap.release()


def make_server(camera, host, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_GET(self):
            path = self.path.split('?',1)[0]
            code = 200
            with camera.lock:
                if path == '/':
                    body,mime = PAGE.encode(),'text/html; charset=utf-8'
                elif path == '/frame.jpg':
                    body,mime = camera.jpg or b'','image/jpeg'
                    if not body: code = 503
                elif path == '/status':
                    data = dict(camera.state,age_ms=None if camera.updated is None else
                        round((time.monotonic()-camera.updated)*1000))
                    body,mime = json.dumps(data).encode(),'application/json'
                else:
                    code,body,mime = 404,b'Not found','text/plain'
            try:
                self.send_response(code)
                self.send_header('Content-Type',mime)
                self.send_header('Content-Length',str(len(body)))
                self.send_header('Cache-Control','no-store')
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError): pass
    return ThreadingHTTPServer((host,port),Handler)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--camera',default='/dev/video2')
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--port',type=int,default=8766)
    parser.add_argument('--calibration', help='camera.json from real calibration')
    parser.add_argument('--approximate', action='store_true', help='rough demo intrinsics; NOT calibrated metric tracking')
    parser.add_argument('--marker-m', type=float, default=.055)
    parser.add_argument('--url', default='http://127.0.0.1:8765/api/pose')
    args = parser.parse_args()
    pipeline = PosePipeline(args.marker_m, args.calibration, args.approximate)
    sender = LatestSender(args.url)
    camera = Camera(int(args.camera) if args.camera.isdecimal() else args.camera, pipeline, sender)
    server = make_server(camera,args.host,args.port)
    print(f'Camera preview http://{args.host}:{args.port}',flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        camera.stop.set();server.server_close();camera.worker.join(timeout=2);sender.close()
