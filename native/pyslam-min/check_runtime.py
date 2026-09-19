"""Fail early with actionable import errors; verify the headless native build."""
import importlib
import argparse
from importlib import metadata
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT/'.pyslam-min/native'),
               str(ROOT/'.pyslam-min/upstream/thirdparty/g2opy/lib')]


def validate_variants(installed):
    expected = {'opencv-contrib-python-headless': '4.10.0.84'}
    if installed != expected:
        raise RuntimeError(f'Expected only {expected}, found {installed}; '
                           'repair the isolated Python environment, not the C++ build.')


def main(python_only=False):
    # Query the wheel before native extensions load Homebrew's OpenCV.
    # Afterwards dyld symbol interposition may report the other build's info.
    import cv2
    gui = next((line.strip() for line in cv2.getBuildInformation().splitlines()
                if line.strip().startswith('GUI:')), '')
    print(f'Python: {sys.executable}', flush=True)
    print(f'cv2: {cv2.__file__}', flush=True)
    print(f'Before native imports: {gui}', flush=True)
    installed = {}
    for name in ('opencv-python', 'opencv-contrib-python', 'opencv-python-headless',
                 'opencv-contrib-python-headless'):
        try:
            installed[name] = metadata.version(name)
            print(f'Installed: {name}=={installed[name]}', flush=True)
        except metadata.PackageNotFoundError:
            pass
    validate_variants(installed)
    wheel_path = metadata.distribution('opencv-contrib-python-headless').locate_file('cv2/__init__.py')
    if Path(cv2.__file__).resolve() != Path(wheel_path).resolve():
        raise RuntimeError(f'cv2 is shadowed: imported {cv2.__file__}, expected {wheel_path}')
    # Verified in the official 4.10.0.84 macOS ARM64 wheel: this "headless"
    # release contains COCOA. GUI build info is diagnostic, not an install test.
    # Safety check below still rejects a second native GUI/capture implementation.
    if python_only:
        return
    modules = ('numpy', 'scipy', 'numba', 'ujson', 'yaml', 'ordered_set',
               'packaging', 'termcolor', 'psutil', 'requests', 'gdown', 'tqdm',
               'evo', 'websockets', 'g2o', 'pyslam_utils', 'hamming', 'pnpsolver')
    for name in modules:
        try:
            importlib.import_module(name)
        except Exception as error:
            raise RuntimeError(f'Minimal pySLAM dependency failed to load: {name}: {error}') from error
    if sys.platform == 'darwin':
        import ctypes
        dyld = ctypes.CDLL(None)
        count = dyld._dyld_image_count
        count.restype = ctypes.c_uint32
        get_name = dyld._dyld_get_image_name
        get_name.argtypes = [ctypes.c_uint32]
        get_name.restype = ctypes.c_char_p
        loaded = [(get_name(i) or b'').decode(errors='replace') for i in range(count())]
        unwanted = [p for p in loaded if 'libopencv_highgui.' in p or 'libopencv_videoio.' in p]
        if unwanted:
            raise RuntimeError('Unexpected OpenCV GUI/capture libraries loaded: ' + ', '.join(unwanted))
    print('Minimal dependencies loaded; OpenCV package/linkage checks passed.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python-only', action='store_true')
    main(parser.parse_args().python_only)
