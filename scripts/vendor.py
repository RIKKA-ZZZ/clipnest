"""Download pinned browser dependencies; reject every download above 300 MB."""
import hashlib, io, json, pathlib, tarfile, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist' / 'vendor'
OUT.mkdir(parents=True, exist_ok=True)
LIMIT = 300 * 1024 * 1024
PACKAGES = [('ffmpeg', '@ffmpeg/ffmpeg', '0.12.15'), ('core', '@ffmpeg/core', '0.12.10'), ('fflate', 'fflate', '0.8.2')]
report = []

def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'ClipNest-build/1.0'})
    with urllib.request.urlopen(req, timeout=90) as response:
        length = response.headers.get('Content-Length')
        if length and int(length) > LIMIT:
            raise RuntimeError(f'Download exceeds 300 MB; get it manually: {url}')
        data = response.read(LIMIT + 1)
        if len(data) > LIMIT:
            raise RuntimeError(f'Download exceeds 300 MB; get it manually: {url}')
        return data

for local, package, version in PACKAGES:
    meta = json.loads(fetch(f'https://registry.npmjs.org/{package}/{version}'))
    if meta['dist'].get('unpackedSize', 0) > LIMIT:
        raise RuntimeError(f'Package exceeds 300 MB: {meta["dist"]["tarball"]}')
    data = fetch(meta['dist']['tarball'])
    if hashlib.sha1(data).hexdigest() != meta['dist']['shasum']:
        raise RuntimeError(f'Integrity verification failed: {package}')
    folder = OUT / local
    folder.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive.getmembers():
            relative = member.name.removeprefix('package/')
            allowed = relative.startswith('dist/esm/') if local in ('ffmpeg', 'core') else relative == 'esm/browser.js'
            license_file = relative.lower() in ('license', 'license.txt', 'copying', 'package.json')
            if not member.isfile() or not (allowed or license_file):
                continue
            payload = archive.extractfile(member).read()
            name = pathlib.PurePosixPath(relative).name
            if name.endswith('.wasm'):
                chunks = []
                for i in range(0, len(payload), 8 * 1024 * 1024):
                    chunk_name = f'ffmpeg-core.part{i // (8 * 1024 * 1024)}.bin'
                    chunk = payload[i:i + 8 * 1024 * 1024]
                    (folder / chunk_name).write_bytes(chunk)
                    chunks.append({'name': chunk_name, 'bytes': len(chunk), 'sha256': hashlib.sha256(chunk).hexdigest()})
                (folder / 'chunks.json').write_text(json.dumps({'chunks': chunks, 'bytes': len(payload)}), encoding='utf-8')
            else:
                if local == 'fflate' and name == 'package.json':
                    metadata = json.loads(payload)
                    metadata['type'] = 'module'
                    payload = json.dumps(metadata, indent=2).encode('utf-8')
                (folder / name).write_bytes(payload)
    report.append({'package': package, 'version': version, 'tarball_bytes': len(data), 'source': meta.get('repository')})
    print(f'{package}@{version}: verified {len(data):,} bytes', flush=True)
(OUT / 'dependencies.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
