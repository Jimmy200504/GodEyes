"""Apply auditable import-only changes to the pinned pySLAM Python core.

The tracking / mapping / optimization implementations are retained. Optional
modules load only when used; selecting a missing feature raises an import error.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import shutil

OPTIONAL = {
    'torch', 'kornia', 'open3d', 'pyslam.utilities.dust3r',
    'pyslam.slam.optimizer_gtsam', 'pyslam.slam.global_bundle_adjustment',
    'pyslam.slam.map_reload_tester', 'pyslam.loop_closing.loop_closing',
    'pyslam.semantics.semantic_mapping_factory',
    'pyslam.semantics.semantic_color_map_factory',
    'pyslam.dense.volumetric_integrator_base',
    'pyslam.dense.volumetric_integrator_types',
    'pyslam.dense.volumetric_integrator_factory',
}

LAZY_SOURCE = '''import importlib

class DeferredImport:
    def __init__(self, module, name=None):
        self.module = module
        self.name = name
    def resolve(self):
        value = importlib.import_module(self.module)
        return getattr(value, self.name) if self.name else value
    def __getattr__(self, name):
        return getattr(self.resolve(), name)
    def __call__(self, *args, **kwargs):
        return self.resolve()(*args, **kwargs)
'''


def is_optional(module):
    return any(module == name or module.startswith(name + '.') for name in OPTIONAL)


class Imports(ast.NodeTransformer):
    def __init__(self, package):
        self.package = package
        self.changed = False

    def visit_Call(self, node):
        node = self.generic_visit(node)
        if (isinstance(node.func, ast.Name) and node.func.id == 'import_from'
                and node.args and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
                and node.args[0].value.startswith(('pyslam.local_features.', 'modules.xfeat', 'lightglue'))):
            node.func.id = 'DeferredImport'
            self.changed = True
        return node

    def visit_Import(self, node):
        replacements = []
        for alias in node.names:
            module = alias.name
            if module == 'torch.multiprocessing':
                replacements.append(ast.Import(names=[ast.alias(name='multiprocessing', asname=alias.asname)]))
                self.changed = True
            elif is_optional(module):
                # All reviewed dotted optional imports have explicit aliases.
                bound = alias.asname or module.split('.')[0]
                target = module if alias.asname else module.split('.')[0]
                replacements.extend(ast.parse(f'{bound} = DeferredImport({target!r})').body)
                self.changed = True
            else:
                replacements.append(ast.Import(names=[alias]))
        return replacements

    def visit_ImportFrom(self, node):
        if node.level:
            prefix = self.package.split('.')[:len(self.package.split('.')) - node.level + 1]
            module = '.'.join(prefix + ([node.module] if node.module else []))
        else:
            module = node.module or ''
        replacements = []
        for alias in node.names:
            full = module + '.' + alias.name
            if is_optional(module) or is_optional(full):
                bound = alias.asname or alias.name
                if is_optional(module):
                    expr = f'{bound} = DeferredImport({module!r}, {alias.name!r})'
                else:
                    expr = f'{bound} = DeferredImport({full!r})'
                replacements.extend(ast.parse(expr).body)
                self.changed = True
            else:
                replacements.append(ast.ImportFrom(module=node.module, names=[alias], level=node.level))
        return replacements


def transform(source, relative):
    tree = ast.parse(source)
    package = '.'.join(Path(relative).parts[:-1])
    transformer = Imports(package)
    tree = transformer.visit(tree)
    if relative == 'pyslam/config.py':
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'kDefaultConfigPath' for t in node.targets):
                node.value = ast.Call(func=ast.Attribute(value=ast.Attribute(value=ast.Name(id='os', ctx=ast.Load()), attr='environ', ctx=ast.Load()), attr='get', ctx=ast.Load()), args=[ast.Constant(value='PYSLAM_MIN_CONFIG'), node.value], keywords=[])
                transformer.changed = True
    # Neural matcher imports were also being attempted at module scope.
    if relative == 'pyslam/local_features/feature_matcher.py':
        for node in tree.body:
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
                if isinstance(node.value.func, ast.Name) and node.value.func.id == 'import_from':
                    args = node.value.args
                    node.value = ast.Call(func=ast.Name(id='DeferredImport', ctx=ast.Load()), args=args, keywords=[])
                    transformer.changed = True
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == 'feature_matcher_factory':
                guard = ast.parse("if matcher_type not in (FeatureMatcherTypes.BF, FeatureMatcherTypes.FLANN):\n    raise ValueError('Minimal build supports only BF/FLANN matching')").body
                node.body = guard + node.body
    if not transformer.changed:
        return source
    # Preserve upstream license docstring and future imports at the start.
    index = 1 if tree.body and isinstance(tree.body[0], ast.Expr) and isinstance(tree.body[0].value, ast.Constant) and isinstance(tree.body[0].value.value, str) else 0
    while index < len(tree.body) and isinstance(tree.body[index], ast.ImportFrom) and tree.body[index].module == '__future__':
        index += 1
    tree.body[index:index] = ast.parse('from __future__ import annotations\nfrom pyslam.minimal_imports import DeferredImport').body
    ast.fix_missing_locations(tree)
    return ast.unparse(tree) + '\n'


def prepare(root):
    root = Path(root).resolve()
    manifest_path = root / 'godeyes-minimal-patches.json'
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        for name, hashes in manifest.items():
            if hashlib.sha256((root/name).read_bytes()).hexdigest() != hashes['patched']:
                raise RuntimeError(f'Modified prepared file: {name}; refusing to overwrite')
        return
    manifest = {}
    header = root/'thirdparty/g2opy/python/core/block_solver.h'
    header_original = header.read_text()
    if header_original.count('#define _CHOLMOD_FOUND 1') != 1:
        raise RuntimeError('Unexpected g2o block solver bindings; review before patching')
    for path in sorted((root/'pyslam').rglob('*.py')):
        # Optional neural implementations themselves never need to be loaded.
        relative = path.relative_to(root).as_posix()
        if relative != 'pyslam/config.py' and not relative.startswith(('pyslam/slam/', 'pyslam/utilities/', 'pyslam/local_features/', 'pyslam/semantics/', 'pyslam/loop_closing/')):
            continue
        original = path.read_text()
        result = transform(original, relative)
        if result != original:
            backup = root/'godeyes-originals'/relative
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, backup)
            path.write_text(result)
            manifest[relative] = {'original': hashlib.sha256(original.encode()).hexdigest(),
                                  'patched': hashlib.sha256(result.encode()).hexdigest()}
    (root/'pyslam/minimal_imports.py').write_text(LAZY_SOURCE)
    # Keep the original g2o bindings (Flag API); avoid mandatory unused CHOLMOD.
    path = root/'thirdparty/g2opy/python/CMakeLists.txt'
    original = path.read_text()
    result = original.replace('    solver_cholmod\n', '')
    result = result.replace('    opengl_helper\n', '')
    result += '\nif(TARGET solver_cholmod)\n  target_link_libraries(g2o PRIVATE solver_cholmod)\nendif()\n'
    result += '\nif(TARGET opengl_helper)\n  target_link_libraries(g2o PRIVATE opengl_helper)\nendif()\n'
    result = result.replace('pybind11_add_module(g2o g2o.cpp)', 'pybind11_add_module(g2o NO_EXTRAS g2o.cpp)')
    result += '\n# Reduce memory for the monolithic bindings; core optimizer stays Release.\nif(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")\n  target_compile_options(g2o PRIVATE -O1)\nendif()\n'
    result = result.replace('add_subdirectory(${PROJECT_SOURCE_DIR}/EXTERNAL/pybind11 ${CMAKE_BINARY_DIR}/pybind11_build)',
                            'set(PYBIND11_FINDPYTHON ON)\nfind_package(pybind11 CONFIG REQUIRED)')
    (root/'godeyes-original-g2o-cmake.txt').write_text(original)
    path.write_text(result)
    manifest[str(path.relative_to(root))] = {'original': hashlib.sha256(original.encode()).hexdigest(),
                                           'patched': hashlib.sha256(result.encode()).hexdigest()}
    # Upstream bindings hard-code CHOLMOD even when CMake did not find it.
    header_result = header_original.replace('#include <g2o/solvers/cholmod/linear_solver_cholmod.h>', '')
    header_result = header_result.replace('#define _CHOLMOD_FOUND 1', '#define _CHOLMOD_FOUND 0')
    backup = root/'godeyes-originals'/header.relative_to(root)
    backup.parent.mkdir(parents=True, exist_ok=True)
    backup.write_text(header_original)
    header.write_text(header_result)
    manifest[str(header.relative_to(root))] = {'original': hashlib.sha256(header_original.encode()).hexdigest(),
                                              'patched': hashlib.sha256(header_result.encode()).hexdigest()}
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f'Prepared {len(manifest)} files; original sources and patch hashes retained.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    prepare(parser.parse_args().source)
