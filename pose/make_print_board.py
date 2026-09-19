"""Generate reproducible A4 print assets; Pillow is only needed for this utility."""
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def main():
    output = Path(__file__).resolve().parents[1] / 'public' / 'markers'
    output.mkdir(parents=True, exist_ok=True)
    ppm = 12  # 304.8 DPI: exact integer pixels for A4, 55 mm and six marker cells.
    dpi = ppm * 25.4
    image = Image.new('RGB', (210*ppm, 297*ppm), 'white')
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.load_default(size=48)
    font = ImageFont.load_default(size=30)
    def text(x, y, value, title=False):
        draw.text((round(x*ppm),round(y*ppm)),value,fill='black',font=title_font if title else font)
    text(20,20,'GodEyes - ArUco B board',True)
    text(20,30,'DICT_4X4_50 | IDs 0, 1, 2, 3 | Black square: 55 mm')
    text(20,38,'A4 portrait. Print at 100% / Actual Size. Do NOT fit to page.')
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    markers = []
    for marker_id, (x,y) in enumerate([(32.5,70),(122.5,70),(32.5,160),(122.5,160)]):
        marker = cv2.aruco.generateImageMarker(dictionary,marker_id,55*ppm)
        image.paste(Image.fromarray(marker).convert('RGB'),(round(x*ppm),round(y*ppm)))
        text(x,y+61,f'ID {marker_id} - 55 mm')
        standalone = cv2.copyMakeBorder(marker,120,120,120,120,cv2.BORDER_CONSTANT,value=255)
        assert cv2.imwrite(str(output/f'aruco-B-id{marker_id}-with-margin.png'),standalone)
        # Fixed-board world: origin at layout center, X right, Y up, Z out of paper.
        corners = [[round((u-105)/1000,7),round((142.5-v)/1000,7),0.0]
                   for u,v in [(x,y),(x+55,y),(x+55,y+55),(x,y+55)]]
        markers.append(dict(id=marker_id,corners_m=corners))
    text(20,238,'Keep sheet flat. For this board layout, do not cut/rearrange tags.')
    text(20,247,'If placing tags around a screen, measure their new relative positions.')
    text(20,255,'After printing, measure black edges: 55 mm, excluding white margin.')
    draw.line((30*ppm,270*ppm,80*ppm,270*ppm),fill='black',width=3)
    for x in (30,80): draw.line((x*ppm,268*ppm,x*ppm,272*ppm),fill='black',width=3)
    text(90,266,'50 mm scale check')
    image.save(output/'aruco-board-A4-55mm-ids0-3.png',dpi=(dpi,dpi))
    image.save(output/'aruco-board-A4-55mm-ids0-3.pdf','PDF',resolution=dpi,quality=100,subsampling=0)
    (output/'aruco-board-A4-55mm-ids0-3.json').write_text(json.dumps(dict(
        dictionary='DICT_4X4_50',marker_size_m=.055,page_size_mm=[210,297],
        center_spacing_m=[.09,.09],frame='origin at board center; X right, Y up, Z out of paper',
        corner_order='top-left, top-right, bottom-right, bottom-left as printed',
        markers=markers),indent=2))
    detector = cv2.aruco.ArucoDetector(dictionary,cv2.aruco.DetectorParameters())
    _,ids,_ = detector.detectMarkers(np.asarray(image))
    assert ids is not None and sorted(ids.flatten().tolist()) == [0,1,2,3]
    for marker_id in range(4):
        _,ids,_ = detector.detectMarkers(cv2.imread(str(output/f'aruco-B-id{marker_id}-with-margin.png')))
        assert ids is not None and ids.flatten().tolist() == [marker_id]
    print('Verified four board markers and all four standalone PNGs; A4 210x297 mm, tags 55 mm.')


if __name__ == '__main__': main()
