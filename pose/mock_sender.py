"""Synthetic transport demo only; does not read a camera or run SLAM/NPU."""
import argparse
import json
import math
import time
import uuid
from urllib.request import Request, urlopen

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8765/api/pose")
    args = parser.parse_args()
    start = time.monotonic()
    session = str(uuid.uuid4())
    seq = 0
    print("SYNTHETIC pose source — not camera tracking", flush=True)
    try:
        while True:
            t = time.monotonic() - start
            yaw = 0.35 * math.sin(t)
            pose = dict(version=1, frame="opencv-c2w", session_id=session,
                map_id="mock-map", source="mock", seq=seq,
                capture_monotonic_ns=int(t * 1e9), tracking="tracking", scale="metric",
                position=[0.2 * math.sin(t), 0.08 * math.sin(t / 2), 0.2 * math.sin(t / 3)],
                quaternion_xyzw=[0, math.sin(yaw / 2), 0, math.cos(yaw / 2)])
            request = Request(args.url, data=json.dumps(pose).encode(),
                headers={"Content-Type": "application/json"}, method="POST")
            with urlopen(request, timeout=2) as response:
                response.read()
            seq += 1
            time.sleep(1 / 30)
    except KeyboardInterrupt:
        pass
