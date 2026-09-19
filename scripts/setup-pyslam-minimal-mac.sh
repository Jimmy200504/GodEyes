#!/usr/bin/env bash
set -eo pipefail
cd "$(dirname "$0")/.."
project_dir="$PWD"
[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || {
  echo '請在 Apple Silicon Mac 上執行。' >&2; exit 1;
}
command -v brew >/dev/null
xcode-select -p >/dev/null
mkdir -p .pyslam-min/logs
log_path="$project_dir/.pyslam-min/logs/setup-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee "$log_path") 2>&1
trap 'echo "未完成。請保留此 log：$log_path"' ERR
rm -f .pyslam-min/ready
revision=a5ff2562eb929ed9a08420f528a120a3cca65585
source_dir="$project_dir/.pyslam-min/upstream"
echo '[1/5] 取得稀疏原始碼：不下載神經網路子模組或模型'
if [ ! -d "$source_dir/.git" ]; then
  git init "$source_dir"
  git -C "$source_dir" remote add origin https://github.com/luigifreda/pyslam.git
fi
if ! git -C "$source_dir" rev-parse --verify HEAD >/dev/null 2>&1; then
  git -C "$source_dir" config remote.origin.promisor true
  git -C "$source_dir" config remote.origin.partialclonefilter blob:none
  git -C "$source_dir" -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=90 \
    fetch --progress --filter=blob:none --depth=1 origin "$revision"
  git -C "$source_dir" sparse-checkout init --cone
  git -C "$source_dir" sparse-checkout set pyslam settings cpp/solvers cpp/casters cpp/utils cpp/hamming thirdparty/g2opy
  git -C "$source_dir" -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=90 checkout --detach "$revision"
fi
[ "$(git -C "$source_dir" rev-parse HEAD)" = "$revision" ] || {
  echo '最小版原始碼版本不符，未覆寫。'; exit 1;
}
echo '[2/5] 使用 Homebrew 二進位依賴與獨立 Python 3.11 環境'
# Reuse installed formulae; no brew upgrade or upstream install_all.sh.
for formula in python@3.11 cmake ninja eigen@3 opencv@4; do
  if ! brew list --versions "$formula" >/dev/null 2>&1; then
    HOMEBREW_NO_AUTO_UPDATE=1 brew install --force-bottle "$formula"
  fi
done
opencv_dir="$(brew --prefix opencv@4)/lib/cmake/opencv4"
[ -f "$opencv_dir/OpenCVConfig.cmake" ] || {
  echo "找不到 OpenCV 4 設定：$opencv_dir/OpenCVConfig.cmake" >&2
  exit 1
}
echo "OpenCV 4 CMake 設定：$opencv_dir"
python_bin="$(brew --prefix python@3.11)/bin/python3.11"
[ -x .pyslam-min/venv/bin/python ] || "$python_bin" -m venv .pyslam-min/venv
python_bin="$project_dir/.pyslam-min/venv/bin/python"
# OpenCV wheel variants share the cv2 directory. Remove conflicting variants
# only inside this isolated venv, then repair headless files before continuing.
if "$python_bin" - <<'PY'
from importlib.metadata import distributions
import sys
installed = {d.metadata['Name'].lower().replace('_', '-') for d in distributions()}
sys.exit(0 if installed & {'opencv-python', 'opencv-contrib-python', 'opencv-python-headless'} else 1)
PY
then
  "$python_bin" -m pip uninstall -y opencv-python opencv-contrib-python opencv-python-headless
  "$python_bin" -m pip install --only-binary=:all: --no-deps --force-reinstall opencv-contrib-python-headless==4.10.0.84
fi
"$python_bin" -m pip install --only-binary=:all: -r native/pyslam-min/requirements.txt
"$python_bin" native/pyslam-min/check_runtime.py --python-only
"$python_bin" native/pyslam-min/prepare.py "$source_dir"
pybind_dir="$("$python_bin" -m pybind11 --cmakedir)"
mkdir -p .pyslam-min/native
common=(-G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5
  -DCMAKE_OSX_ARCHITECTURES=arm64 -DPython3_EXECUTABLE="$python_bin"
  -Dpybind11_DIR="$pybind_dir" -DEigen3_DIR="$(brew --prefix eigen@3)/share/eigen3/cmake"
  -DEIGEN3_INCLUDE_DIR="$(brew --prefix eigen@3)/include/eigen3")
echo '[3/5] 單工編譯 upstream g2o（保留 pySLAM 的 Flag API）'
cmake -S "$source_dir/thirdparty/g2opy" -B .pyslam-min/build-g2o "${common[@]}" \
  -DG2O_BUILD_APPS=OFF -DG2O_BUILD_EXAMPLES=OFF -DG2O_USE_OPENGL=OFF \
  -DG2O_USE_OPENMP=OFF -DBUILD_WITH_MARCH_NATIVE=OFF \
  -DCMAKE_DISABLE_FIND_PACKAGE_Cholmod=ON -DCMAKE_DISABLE_FIND_PACKAGE_CSparse=ON \
  -DCMAKE_DISABLE_FIND_PACKAGE_QGLViewer=ON -DCMAKE_DISABLE_FIND_PACKAGE_GLUT=ON
cmake --build .pyslam-min/build-g2o --target g2o --parallel 1
echo '[4/5] 單工編譯三個小元件：pyslam_utils、hamming、pnpsolver'
cmake -S native/pyslam-min -B .pyslam-min/build-utils "${common[@]}" \
  -DPYSLAM_SOURCE="$source_dir" -DOpenCV_DIR="$opencv_dir" \
  -DCMAKE_LIBRARY_OUTPUT_DIRECTORY="$project_dir/.pyslam-min/native"
cmake --build .pyslam-min/build-utils --parallel 1
echo '[5/5] 啟動核心並處理空白影像，檢查不會載入模型套件'
export PYSLAM_USE_CPP=false OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2
"$python_bin" native/pyslam-min/check_runtime.py
"$python_bin" pose/pyslam_minimal.py --smoke
printf '%s\n' "$revision" > .pyslam-min/ready
echo '最小版啟動檢查通過。接著執行 bash scripts/run-pyslam-minimal.sh <錄影目錄>'
