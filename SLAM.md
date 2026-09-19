# 電腦端 SLAM 實驗

目前使用自製 OpenCV ORB＋LK 版本；stella／ORB-SLAM3 建置路線已停止。

## 持續 lost 自動重建、局部地圖與點品質管理

先 Ctrl-C 停掉舊版，在 Mac 執行：

```sh
scp root@100.86.170.121:/tmp/godeyes-auto-rebuild-update.tar.gz ~/Downloads/
cd ~/GodEyes-local-slam
tar -xzf ~/Downloads/godeyes-auto-rebuild-update.tar.gz
sh scripts/run-local-slam.sh --backend sparse --lost-reset-seconds 2
```

需要繼續測試合成影像時加上 `--synthetic-bridge`；網頁的旋轉外推開關仍可獨立使用。
更新包包含建置好的網頁，更新後重新整理瀏覽器。沒有新增 C++ 建置或依賴。

**自動重建**：有地圖後，連續實際處理到 lost 影格達 2 秒，才清掉工作地圖、關鍵影格及恢復備份，
建立新 session，以當前真實特徵重新初始化。計時使用影像來源時間戳，不按 lost 幀數計算。
中途恢復 tracking 就取消計時；網路沒送新影像時不盲目重建；初始化尚未成功時不反覆重建。
`--lost-reset-seconds 1` 可改為 1 秒，設 `0` 關閉；預設為 2 秒。

前端只對附有正確前一 session 與 `lost_timeout` 原因的自製 SLAM 新地圖自動接續，
保留最後量測視角作為顯示偏移。無關的換地圖、手動重啟或其他來源仍要求重設原點。
這是顯示上的銜接，不是兩張地圖的幾何融合，舊地圖與新地圖的尺度及絕對方位沒有對齊。
新的單目地圖仍需要少量平移與紋理才能初始化，**不是 2 秒後保證立刻恢復 tracking**；
畫面會顯示「已自動重建地圖，請緩慢側移初始化」。

**局部地圖追蹤**：上一幀 tracking 時，以其姿態投影地圖，優先配對畫面及周圍 80 px 內、
正深度的點；姿態解算失敗會立即退回全工作地圖，再接原有恢復流程。Lost 後不沿用狹窄搜尋範圍。
這是簡化的可見點搜尋，尚未實作共視圖或完整運動模型。

**按品質保留點**：幾何驗證成功的 ORB 觀察累計次數與最近觀察幀號，用來在地圖滿載時選擇保留點。
新三角化點保留一輪加入機會；保留的 3D 座標、目前／原始描述子與統計資料同步裁切。
不再單純按插入順序刪除舊點；獨立 3D 備份仍保留供重新定位。

`/status` 新增 `lost_duration_ms`、`auto_resets`、`reset_reason`、`local_map_points`、`points_pruned`。
局部搜尋解算成功時 `tracking_method` 為 `orb-local`。這些是成熟 SLAM 常見策略的簡化實作，
尚無局部 bundle adjustment、閉環修正或多地圖融合，也未量到 Mac 真機改善幅度。

77 項 Python 測試涵蓋超時邊界、恢復取消計時、關閉功能、重新初始化、品質保留與全圖 fallback；
前端測試涵蓋新地圖接續時視角延續，以及拒絕錯誤前一 session、過期封包與不明地圖變更。

## 實驗：旋轉外推與合成中間影像

兩項實驗均可獨立開關，預設關閉。先 Ctrl-C 停掉舊服務，在 Mac 執行：

```sh
scp root@100.86.170.121:/tmp/godeyes-interpolation-update.tar.gz ~/Downloads/
cd ~/GodEyes-local-slam
tar -xzf ~/Downloads/godeyes-interpolation-update.tar.gz
sh scripts/run-local-slam.sh --backend sparse --synthetic-bridge
```

更新包含已建置網頁，重新整理瀏覽器後，勾選「實驗：旋轉外推」。
若要只測外推，啟動指令移除 `--synthetic-bridge`；若要只測影像合成，保留參數但不要勾外推。
兩者都關閉即可比較基準版。不需 C++ 編譯或額外模型。

**旋轉外推**：使用最近兩筆有效姿態的來源時間差估計角速度（上限 4 rad/s），
每個顯示影格預測旋轉，最多持續到收到最後有效姿態後 100 ms；資料原有的 250 ms 新鮮度限制也仍生效。
不預測平移、不將預測值送回 SLAM 或當作真實 tracking。連續 lost 不延長期限。
重設、換地圖、連線中斷會停止外推；恢復後先清除舊速度。
這是顯示層的短暫預測，並沒有把 15 FPS 相機變成 60 FPS 的真實量測；急停或反向仍可能猜錯。

**合成中間影像**：原本的 ORB、LK 與關鍵影格恢復都失敗時，才使用上一張有效影像和目前真實影像，
在半解析度計算雙向 Farneback 光流，近似半程扭曲並融合成一張中間影像。
先走「上一張 → 合成影像 → 目前影像」尋找 LK 初值，再回到兩張真實影像做前後向、亮度及邊界檢查，
最後仍需 PnP/RANSAC 驗證。參考影像相隔超過 200 ms 時不嘗試。
合成影像不送入 ORB 建圖、不成為關鍵影格，不增加來源幀數，也不產生虛構時間戳。
它需要等目前真實影像到達，因此不降低收圖等待，也不能處理完全遮擋；遮擋區可能出現重影。
這是一般影像扭曲與光流插值，沒有使用生成式模型。

`/status` 的 `synthetic_bridge_enabled` 表示功能是否開啟；`bridge_attempted`、`bridge_tracks`、`bridge_ms`
分別表示當幀是否嘗試、通過真實影像驗證的候選點數及額外耗時（包含後續 PnP）。
`bridge_attempts_total`／`bridge_successes_total` 是自 map/session 重設起的嘗試／解算成功次數；
成功的 `tracking_method` 為 `synthetic-bridge`。解算成功若已超過新鮮度限制，仍可能不顯示，
需一起看 `stale_frames` 和耗時。合成可能增加延遲，不能只看畫面是否較順。

測試包含真實影像的光流與合成、空白真實端點拒收、強制原流程失敗後的 fallback 接線、
來源時間戳與逾時限制，以及外推方向、期限、失聯、重設與四元數跨界。
強制失敗的測試只驗證 fallback 可以正確運作，不代表已證明它比原 LK 更能追蹤。
Mac 真機成功率與速度仍待比較。

本次 72 項 Python 測試、前端測試、App 入口型別檢查與 Vite 建置通過。全專案 TypeScript
檢查仍有未修改的 ModelViewer／FaceLandmarker 舊檔型別錯誤，未將該檢查報為通過。

光流依據：[OpenCV 官方教學](https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html)。

## 地圖滿載後的重新定位更新

```sh
scp root@100.86.170.121:/tmp/godeyes-recovery-update.tar.gz ~/Downloads/
cd ~/GodEyes-local-slam
tar -xzf ~/Downloads/godeyes-recovery-update.tar.gz
sh scripts/run-local-slam.sh --backend sparse
```

先 Ctrl-C 關閉上一版。此包包含前幾次的追蹤與多關鍵影格更新，不覆蓋相機校正。

使用者提供的三筆狀態：lost 時接收約 13.7–15 FPS、SLAM 5.35–23.32 ms、
收圖等待 26.36–47.87 ms，工作地圖已達 2,000 點；一筆狀態 age_ms 達 2,267 ms。
這不能證明失敗前的追蹤或建圖也同樣快，累計 skipped_frames／stale_frames 也不是當下的丟幀率。
尚無法斷定 FPS 或地圖裁切是該次失敗的唯一原因。

程式確認存在的缺口是：原本 FIFO 裁切會刪除舊 3D 點，而 2D 關鍵影格不足以獨立重新定位。
新版在初始化及有效關鍵影格建立時，保存最多 6 組獨立 3D 觀察，每組最多 250 點，
包含對應描述子，通過正深度與 1.5 px 重投影檢查並分散取樣。
工作地圖與 LK 都無法估姿態時，最多驗證匹配數最高的 2 組備份，仍須通過 PnP/RANSAC。
成功後以該組 3D 點恢復工作地圖，`tracking_method` 顯示 `keyframe-relocalize`。
因此恢復後 `map_points` 可能從 2,000 降到 250 以下，這是工作點集切換；世界座標與 session 不重設。
不是 loop closure，也沒有假裝沿用上一筆 pose。只保留有限視角，不能保證任意舊位置都能恢復。

`/status` 新增：

- `feature_count`：當幀偵測到的 ORB 特徵數。
- `map_matches`：當幀所嘗試的工作地圖／備份中，最多的描述子匹配數，尚未通過幾何驗證。
- `pose_reason`：`insufficient_correspondences` 或 `pose_geometry_rejected`，成功時為 null。
- `recovery_views`：獨立 3D 備份數。
- `input_gap_ms`：連續處理影格的來源時間戳間隔，不受兩台機器時鐘差影響。
- `flow_age_ms`：當幀與上一張有效 LK 參考影像的來源時間差；超過 200 ms 不沿用。

合成測試驗證舊點被全部淘汰後仍能恢復、座標和 session 連續、錯誤幾何拒收、
容量上限與 reset；Mac 真機 FPS 與恢復成功率仍待測試。

## 多關鍵影格建圖更新

先在 Mac Ctrl-C 停掉舊服務，再執行：

```sh
scp root@100.86.170.121:/tmp/godeyes-keyframes-update.tar.gz ~/Downloads/
cd ~/GodEyes-local-slam
tar -xzf ~/Downloads/godeyes-keyframes-update.tar.gz
sh scripts/run-local-slam.sh --backend sparse
```

沿用已安裝的 Python/OpenCV，不需 Docker 或自行編譯 C++。

最多保留 6 張有效關鍵影格（初始視角及最近 5 張），每 5 幀做一次有上限的建圖工作：
從具有平移基線的影格中，最多選 3 張方向較接近的候選，採用通過幾何檢查的新點最多的結果。
每次最多新增 150 點，以影像網格分散選點，地圖仍限制 2,000 點。
新地圖點會立即加入 LK 參考，讓下一幀能使用；描述子與 3D 點同步裁切，避免索引錯置。
左右轉動超過 8 度或有足夠平移才新增關鍵影格；lost 不建圖、不記錄關鍵影格。

`http://localhost:8866/status` 新增 `keyframes`、`new_points`、`mapping_ms`。
先緩慢橫移建立初始地圖，再一邊小幅移動一邊左右轉，觀察新點增加及轉回舊視角後的恢復。
單純原地旋轉會保存視角，但不足以產生新深度；仍不能保證轉入完全未建圖區域時持續追蹤。

合成測試涵蓋從較早視角補點、新點接手追蹤、回到舊視角、純旋轉拒絕補深度、
關鍵影格與地圖容量上限、lost／reset。Mac 實際 FPS、漂移及轉頭效果尚待測試。
這仍是有限稀疏地圖 VO，尚未加入 bundle adjustment 或 loop closure。

## 轉頭追蹤更新

在 Mac 先 Ctrl-C 停掉舊服務，再執行：

```sh
scp root@100.86.170.121:/tmp/godeyes-tracking-update.tar.gz ~/Downloads/
cd ~/GodEyes-local-slam
tar -xzf ~/Downloads/godeyes-tracking-update.tar.gz
sh scripts/run-local-slam.sh --backend sparse
```

使用既有 Python/OpenCV，不需要自行編譯 C++。Docker Desktop 可以關閉。

- 地圖點描述子隨有效觀察更新，只有接受的 PnP 姿態下重投影誤差小於 1.5 px、正深度的匹配才更新。
- 每個點保留一份原始描述子，近期描述子失敗時再嘗試原始外觀重新定位；仍須通過 PnP/RANSAC。
- 短暫 lost 不立刻丟掉上一張有效影像，200 ms 內可嘗試直接用 LK 接回。失敗影格不作為參考，也不輸出有效 pose。
- `/status` 新增 `descriptor_updates`，`tracking_method` 增加 `orb-relocalize`。處理超時時也更新耗時與後端狀態，便於區分計算太慢和追蹤失敗。

合成測試涵蓋逐步外觀改變、轉回原始視角、拒絕幾何離群匹配、遮擋後恢復及超時失效。
這些不是 Mac 真機追蹤效果；實機 FPS 和左右轉頭失敗率仍待比較。
地圖仍需要平移視差才能新增深度，完全轉離已建圖區域仍可能 lost。多關鍵影格建圖已加入上方新版，仍不放寬 lost 判定，也不把上一筆姿態當成新追蹤。

以下保留前次更新與清理步驟。

## 光流更新與清理 ORB-SLAM3

在 Mac 停掉上次的啟動腳本（Ctrl-C），更新原本已能執行的資料夾：

```sh
scp root@100.86.170.121:/tmp/godeyes-flow-update.tar.gz ~/Downloads/
cd ~/GodEyes-local-slam
tar -xzf ~/Downloads/godeyes-flow-update.tar.gz
python3 scripts/cleanup-orbslam3.py --apply
sh scripts/run-local-slam.sh
```

清理 Docker 時須開啟 Docker Desktop；清理完可關閉，新版追蹤不需要它。
清理範圍是指定名稱及映像都符合的 ORB worker 容器、`godeyes-orbslam3:4452a3c-v1` 映像、
可辨識的 `~/GodEyes-orbslam3` 實驗資料夾及兩份 ORB 下載包。
不刪除 `~/GodEyes-local-slam`、其他專案、volumes 或 Docker Desktop。
若沒有正在跑的 ORB 容器是正常的：之前可能只有建置到一半。
腳本不加 `--apply` 可僅列出清理項目。

建置快取在 Docker builder 內，失敗的建置也可能留下大量快取，不能靠刪除容器全部清掉。
舊快取無法可靠按本專案辨識，因此預設保留。
**只有確認此 builder 沒有其他專案需要的快取時**，才加 `--prune-build-cache`，
例如 `python3 scripts/cleanup-orbslam3.py --apply --prune-build-cache`；這會清除該 builder 的所有未使用建置快取。

### 這次改了什麼

ORB 仍負責初始化、地圖匹配及恢復。匹配失敗時，使用前一個有效影格的 3D 對應點做金字塔 LK 光流，
經前後向一致性、亮度差、邊界與 PnP/RANSAC 幾何檢查後才接受姿態。
最多保存 250 個分散的追蹤點；重設或距離上一張有效影像超過 200 ms 就清除光流歷史（短暫 lost 的行為已由上方更新修改）。
預覽及 `/status` 顯示 `tracking_method`（`orb`／`optical-flow`）及 `flow_tracks`，方便判斷備援是否生效。

光流只延續已知地圖點，沒有補出未知區域的深度，也沒有加入閉環。大幅轉離已建圖區域仍可能 lost。
兩次 LK 會增加 CPU 時間，實機 FPS、模糊與大角度轉頭效果需比較；可執行
`sh scripts/run-local-slam.sh --no-optical-flow` 關掉備援做 A/B 測試。
合成影像測試包含真實 LK 對應、描述子缺失時的轉動估姿態、遮擋、時間跳躍、幾何離群點與重設。


分支 `vaclisinc/imx-local-slam` 從 `imx-head-pose` 的電腦接收版 `d8e7d2c` 建立，移入 `89fa78d` 的自然特徵核心與前端。

流程：i.MX93 擷取／JPEG → 原 WebSocket 串流 → Mac／電腦去畸變、ORB、兩視角初始化、三角化、map-to-frame PnP → 本機 relay → 本機網頁。
板子不算 SLAM；不用標記。現階段是單眼 VO 加有限稀疏地圖，沒有 bundle adjustment、閉環修正或地圖儲存；尺度為 arbitrary，不能當作公尺。它是初步效果實驗，不能代表完整 SLAM 系統的效果。

## Mac 啟動包

板端已準備 `/tmp/godeyes-local-slam.tar.gz`，包含程式及已建置網頁。在 Mac 執行：

```sh
scp root@100.86.170.121:/tmp/godeyes-local-slam.tar.gz ~/Downloads/
mkdir -p ~/GodEyes-local-slam
tar -xzf ~/Downloads/godeyes-local-slam.tar.gz -C ~/GodEyes-local-slam
cd ~/GodEyes-local-slam
sh scripts/run-local-slam.sh
```

需已安裝 Python 3.10+ 及 Node.js 20.19+／22.12+。腳本首次安裝依賴，將本機 18781 轉發至板端 8781，避免撞到原版影格通道；啟動本機接收器與 5182 網頁。Ctrl-C 關閉本次腳本的服務。若需改板子帳號／位址，設定 `SLAM_BOARD=user@host`。

## 手動啟動

板子沿用 `imx-head-pose` 既有串流（已在執行則不需再開）：

```sh
.venv/bin/python -u pose/frame_stream.py --host 127.0.0.1 --port 8781
```

Mac 取得此分支程式後，在專案根目錄安裝：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r pose/requirements.txt
npm ci
npm run build
```

Mac 三個終端機分別執行：

```sh
ssh -N -o ExitOnForwardFailure=yes -L 8781:127.0.0.1:8781 root@100.86.170.121
```

```sh
.venv/bin/python -u pose/mac_frame_slam.py
```

```sh
npm run preview -- --host 127.0.0.1 --port 5182 --strictPort
```

開啟 **http://localhost:5182**。只轉發影像 port 8781；8865／8866／8867 是電腦本機服務，不需另外啟動 relay。預設讀取已保存的 C270 640×480 校正，可用 `--calibration` 指定另一份同解析度校正。

朝向有紋理、不同深度的靜態場景，緩慢側移以初始化；原地旋轉無法初始化。開始追蹤後按「重設位置與正前方」。lost 時視角凍結，可回到已建圖區域嘗試恢復；「重建地圖」會清空地圖，再初始化並重設原點。板端串流重啟也會換地圖，避免混用兩個時間軸。

## 比較效果

以相同光線與動作各測 ArUco 與此版 30 秒：靜止、側移、前後移動、轉頭、離開再返回原區域。記錄追蹤成功比例、靜止漂移、回原位誤差與跟隨延遲。單眼無公尺尺度，位置比較須先做尺度對齊；每次重建地圖尺度可能不同。前端防抖與畫面平滑設定需一致。

`http://localhost:8866/status` 提供處理 FPS、地圖點、PnP 內點、重投影誤差、`timings_ms`（decode／undistort／slam）、串流 Mbps、跳幀與過期幀數。每兩秒也會輸出 JSON。沿用原版 250 ms 影格年齡上界淘汰；age 包含請求往返與等待，不是精確的相機到螢幕延遲。預覽是去畸變灰階畫面及狀態文字。

ArUco 對照請使用原 `imx-head-pose` 工作目錄及其 [MAC_FRAME_POSE.md](pose/MAC_FRAME_POSE.md)，原本 5181 網頁與 8765／8766／8767 不變。若兩接收器同時運作會增加板端串流與網路負載，效能比較時建議一次運行一個。

## 驗證

```sh
python3 -m unittest discover -s pose -p 'test_*.py'
node --test tests/*.test.mjs
npm run build
```

測試涵蓋合成幾何、退化情況、離群點、影格時間戳、來源重啟、順序拒收、JPEG 解碼與 HTTP 重建地圖。真實 Mac／SSH 路徑的追蹤品質和效能仍需實測。
