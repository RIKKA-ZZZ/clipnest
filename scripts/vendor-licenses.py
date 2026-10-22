"""Fetch small upstream license texts, enforcing the same download cap."""
from pathlib import Path
from urllib.request import urlopen
root=Path(__file__).resolve().parents[1]/'dist'/'vendor'
for dest,url in [
    ('ffmpeg/LICENSE','https://raw.githubusercontent.com/ffmpegwasm/ffmpeg.wasm/main/LICENSE'),
    ('core/LICENSE','https://raw.githubusercontent.com/FFmpeg/FFmpeg/n5.1.4/COPYING.GPLv2'),
    ('core/COPYING.LGPLv2.1','https://raw.githubusercontent.com/FFmpeg/FFmpeg/n5.1.4/COPYING.LGPLv2.1')
]:
    with urlopen(url,timeout=25) as response:
        declared=int(response.headers.get('Content-Length','0'))
        if declared>300*1024*1024: raise RuntimeError(f'Over 300 MB: {url}')
        content=response.read(1024*1024+1)
        if len(content)>1024*1024: raise RuntimeError(f'Unexpectedly large license: {url}')
    (root/dest).write_bytes(content)
    print(f'{dest}: {len(content)} bytes')
