"""Reproducible source revisions, native Homebrew dependencies, single-job build."""
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT/'.stella'
STELLA_REV = '525231147319bcd31242f981078c36d9272727b4'  # 0.7.0
G2O_REV = 'e8df2004e07ea8f5b8e6a8b9f2dc067b45b45036'  # 20230223_git
VOCAB_REV = '708407ae4cd59219b996eda7ed1f4562c7ae106a'


def run(*args, cwd=ROOT):
    print('+', ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=cwd, check=True)


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def checkout(name, url, revision):
    path = LOCAL/'src'/name
    if not path.exists():
        path.mkdir(parents=True)
        run('git', 'init', path)
        run('git', '-C', path, 'remote', 'add', 'origin', url)
    current = subprocess.run(['git', '-C', str(path), 'rev-parse', 'HEAD'],
                             capture_output=True, text=True)
    # Sources under .stella are managed build inputs; never touch the app checkout.
    if current.returncode or current.stdout.strip() != revision:
        run('git', '-C', path, 'fetch', '--depth=1', 'origin', revision)
        run('git', '-C', path, 'checkout', '--detach', 'FETCH_HEAD')
    return path


def main():
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise RuntimeError('Native Apple Silicon macOS is required')
    jobs = int(os.environ.get('BUILD_JOBS', '1'))
    if not 1 <= jobs <= 2:
        raise RuntimeError('BUILD_JOBS must be 1 or 2; default 1 for a 16 GB Mac')
    if shutil.disk_usage(ROOT).free < 8 * 1024**3:
        raise RuntimeError('At least 8 GB of free disk space is required for dependencies/builds')
    run('xcrun', '--find', 'clang++')
    brew = Path('/opt/homebrew/bin/brew')
    if not brew.is_file():
        raise RuntimeError('Expected Apple Silicon Homebrew at /opt/homebrew/bin/brew')
    os.environ['PATH'] = '/opt/homebrew/bin:' + os.environ['PATH']
    os.environ['HOMEBREW_NO_AUTO_UPDATE'] = '1'
    os.environ['HOMEBREW_NO_INSTALL_UPGRADE'] = '1'
    os.environ['CMAKE_BUILD_PARALLEL_LEVEL'] = str(jobs)
    os.environ['OMP_NUM_THREADS'] = '2'
    run(brew, 'install', '--force-bottle', 'cmake', 'ninja', 'opencv', 'yaml-cpp', 'suite-sparse', 'libomp', 'sqlite')
    prefixes = {name: output(str(brew), '--prefix', name)
                for name in ('opencv', 'yaml-cpp', 'suite-sparse', 'libomp', 'sqlite')}
    prefix = LOCAL/'install'
    common = ['-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_POLICY_VERSION_MINIMUM=3.5',
              '-DCMAKE_OSX_ARCHITECTURES=arm64', '-DCMAKE_CXX_STANDARD=17',
              f'-DCMAKE_INSTALL_PREFIX={prefix}',
              f'-DCMAKE_PREFIX_PATH={prefix};' + ';'.join(prefixes.values())]
    eigen = checkout('eigen', 'https://gitlab.com/libeigen/eigen.git',
                     '3147391d946bb4b6c68edd901f2add6ac1f31f8c')  # Eigen 3.4.0, not Homebrew Eigen 5
    run('cmake', '-S', eigen, '-B', LOCAL/'build-eigen', *common,
        '-DBUILD_TESTING=OFF', '-DEIGEN_BUILD_DOC=OFF', '-DEIGEN_BUILD_PKGCONFIG=OFF')
    run('cmake', '--install', LOCAL/'build-eigen')
    common += [f'-DEigen3_DIR={prefix}/share/eigen3/cmake']
    g2o = checkout('g2o', 'https://github.com/RainerKuemmerle/g2o.git', G2O_REV)
    cmake = g2o/'CMakeLists.txt'
    cmake.write_text(cmake.read_text().replace('set(CMAKE_CXX_STANDARD 14)', 'set(CMAKE_CXX_STANDARD 17)'))
    sparse = prefixes['suite-sparse']
    run('cmake', '-S', g2o, '-B', LOCAL/'build-g2o', *common,
        '-DCMAKE_DISABLE_FIND_PACKAGE_SuiteSparse=ON', '-DG2O_USE_CHOLMOD=OFF', '-DG2O_USE_CSPARSE=ON', '-DG2O_USE_OPENGL=OFF',
        '-DG2O_USE_OPENMP=OFF', '-DG2O_BUILD_APPS=OFF', '-DG2O_BUILD_EXAMPLES=OFF',
        '-DG2O_BUILD_SLAM2D_TYPES=OFF', '-DG2O_BUILD_SLAM3D_ADDON_TYPES=OFF',
        '-DG2O_BUILD_ICP_TYPES=OFF', '-DBUILD_UNITTESTS=OFF', '-DDO_SSE_AUTODETECT=OFF',
        f'-DCSPARSE_INCLUDE_DIR={sparse}/include/suitesparse',
        f'-DCSPARSE_LIBRARY={sparse}/lib/libcxsparse.dylib')
    run('cmake', '--build', LOCAL/'build-g2o', '--parallel', jobs)
    run('cmake', '--install', LOCAL/'build-g2o')
    stella = checkout('stella', 'https://github.com/stella-cv/stella_vslam.git', STELLA_REV)
    run('git', '-C', stella, 'submodule', 'update', '--init', '--recursive', '--depth=1')
    # These upstream projects override CMAKE_CXX_STANDARD internally.
    for cmake in (stella/'CMakeLists.txt', stella/'3rd/FBoW/CMakeLists.txt'):
        source = cmake.read_text()
        if 'set(CMAKE_CXX_STANDARD 11)' not in source and 'set(CMAKE_CXX_STANDARD 17)' not in source:
            raise RuntimeError(f'Unexpected upstream C++ settings in {cmake}')
        cmake.write_text(source.replace('set(CMAKE_CXX_STANDARD 11)', 'set(CMAKE_CXX_STANDARD 17)'))
    omp = prefixes['libomp']
    run('cmake', '-S', ROOT/'native/stella', '-B', LOCAL/'build', *common,
        f'-DSTELLA_SOURCE_DIR={stella}', f'-DOpenCV_DIR={prefixes["opencv"]}/lib/cmake/opencv4',
        f'-DOpenMP_C_FLAGS=-Xpreprocessor -fopenmp -I{omp}/include',
        f'-DOpenMP_CXX_FLAGS=-Xpreprocessor -fopenmp -I{omp}/include',
        '-DOpenMP_C_LIB_NAMES=omp', '-DOpenMP_CXX_LIB_NAMES=omp',
        f'-DOpenMP_omp_LIBRARY={omp}/lib/libomp.dylib',
        '-DCMAKE_DISABLE_FIND_PACKAGE_SuiteSparse=ON',
        '-DBUILD_TESTS=OFF', '-DBUILD_UTILS=OFF', '-DUSE_ARUCO=OFF', '-DUSE_GTSAM=OFF',
        '-DBUILD_WITH_MARCH_NATIVE=OFF', '-DUSE_SSE_ORB=OFF', '-DUSE_SSE_FP_MATH=OFF',
        '-DUSE_AVX=OFF', '-DUSE_MMX=OFF', '-DUSE_SSE=OFF', '-DUSE_SSE2=OFF',
        '-DUSE_SSE3=OFF', '-DUSE_SSE4=OFF',
        f'-DCXSPARSE_INCLUDE_DIR={sparse}/include/suitesparse',
        f'-DCXSPARSE_LIBRARY={sparse}/lib/libcxsparse.dylib')
    run('cmake', '--build', LOCAL/'build', '--target', 'godeyes_stella_worker', '--parallel', jobs)
    vocab = LOCAL/'orb_vocab.fbow'
    if not vocab.is_file():
        partial = vocab.with_suffix('.partial')
        run('curl', '--fail', '--location', '--retry', '3', '--max-time', '600',
            f'https://raw.githubusercontent.com/stella-cv/FBoW_orb_vocab/{VOCAB_REV}/orb_vocab.fbow',
            '--output', partial)
        if partial.stat().st_size < 1_000_000:
            raise RuntimeError('Vocabulary download was unexpectedly small')
        partial.replace(vocab)
    python = ROOT/'.venv/bin/python'
    if not python.is_file():
        run(sys.executable, '-m', 'venv', ROOT/'.venv')
    run(python, '-m', 'pip', 'install', '-r', ROOT/'pose/requirements.txt')
    run(python, ROOT/'pose/stella_smoke.py')
    print('Native startup/frame/reset smoke test passed. Run: bash scripts/run-stella-slam.sh')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
