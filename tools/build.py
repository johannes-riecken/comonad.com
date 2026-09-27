"""Build the actual GHC/Wasm reactor and copy its source/runtime assets."""
from pathlib import Path
import json
import hashlib
import shutil
import subprocess
import zipfile

root = Path(__file__).resolve().parent.parent
toolchain = root / '.toolchain'
ghc = toolchain / 'ghc/bin/wasm32-wasi-ghc'
build = root / 'build/wasm'
build.mkdir(parents=True, exist_ok=True)
wasm = root / 'dist/crc.wasm'
exports = ['hs_init', 'malloc', 'free', 'crc_direct', 'crc_remainder',
           'crc_factor', 'crc_multiply', 'crc_combine', 'crc_finish', 'automaton_step', 'image_demo',
           'binding_demo', 'morton_demo', 'ad_demo', 'lca_demo', 'contour_demo']
command = [str(ghc), '-O2', '-Wall', '-ihaskell', 'haskell/Browser.hs',
           '-outputdir', str(build), '-no-hs-main', '-optl-mexec-model=reactor',
           '-optl-Wl,' + ','.join('--export=' + name for name in exports),
           '-o', str(wasm)]
subprocess.run(command, cwd=root, check=True)
runtime = root / 'dist/vendor/wasi'
shutil.copytree(root / 'node_modules/@bjorn3/browser_wasi_shim/dist', runtime,
                dirs_exist_ok=True, ignore=shutil.ignore_patterns('*.tsbuildinfo'))
for license_name in ['LICENSE-MIT', 'LICENSE-APACHE']:
    shutil.copyfile(root / 'node_modules/@bjorn3/browser_wasi_shim' / license_name,
                    runtime / license_name)
for path in (root / 'haskell').glob('*.hs'):
    shutil.copyfile(path, root / 'dist/source' / path.name)
shutil.copyfile(root / 'TwoDContouring.hs', root / 'dist/source/TwoDContouring.hs')
with zipfile.ZipFile(root / 'dist/source/browser-sources.zip', 'w', zipfile.ZIP_DEFLATED) as bundle:
    for path in sorted((root / 'haskell').glob('*.hs')):
        bundle.write(path, 'haskell/' + path.name)
    bundle.writestr('README.md', '# Browser companions\n\nThese are the self-contained Haskell sources used by the inline figures.\nThe browser adapter uses base, containers, mtl, and transformers.\nBuilt with GHC 9.14.1.20260731 for wasm32-wasi. From this directory:\n\n```sh\nwasm32-wasi-ghc -O2 -ihaskell haskell/Browser.hs -no-hs-main -optl-mexec-model=reactor -optl-Wl,' + ','.join('--export=' + name for name in exports) + ' -o crc.wasm\n```\n\nThe JavaScript host uses @bjorn3/browser_wasi_shim 0.4.2 and calls hs_init(0,0).\nJSON results from binding_demo, morton_demo, ad_demo, lca_demo, contour_demo, and image_demo are UTF-8 C strings; free them after use.\nServer.hs is a separate native CRC example and requires wai and warp.\n')
version = subprocess.check_output([str(ghc), '--numeric-version'], text=True).strip()
metadata = {'compiler': 'GHC ' + version, 'target': 'wasm32-wasi',
            'wasm_bytes': wasm.stat().st_size,
            'wasm_sha256': hashlib.file_digest(wasm.open('rb'), 'sha256').hexdigest(),
            'source_sha256': {p.name: hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()
                              for p in (root / 'haskell').glob('*.hs')},
            'exports': exports}
(root / 'dist/build-info.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(json.dumps(metadata, indent=2))
