"""Create a review copy from the real recording; preserve the original."""
import json
from pathlib import Path
import subprocess

base = Path(__file__).resolve().parent
source = Path('/Users/sean/Documents/GOOGLE.mov')
plan = json.loads((base / 'edit-plan.json').read_text())
parts = []
def timestamp(seconds):
    milliseconds = round(seconds * 1000)
    hours, remainder = divmod(milliseconds, 3600000)
    minutes, remainder = divmod(remainder, 60000)
    seconds, milliseconds = divmod(remainder, 1000)
    return f'{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}'

captions = []
for i, scene in enumerate(plan):
    part = base / f'part-{i + 1:02}.mp4'
    duration = scene['duration']
    graph = (
        f"[0:v]setpts=(PTS-STARTPTS)/{scene['speed']},fps=30,"
        'scale=1778:1000,pad=1920:1080:71:0:color=0x0d171f[v];'
        '[v][1:v]overlay=0:1000:shortest=1,format=yuv420p[out]'
    )
    subprocess.run([
        'ffmpeg', '-y', '-loglevel', 'error', '-ss', str(scene['start']),
        '-t', str(scene['end'] - scene['start']), '-i', str(source),
        '-loop', '1', '-i', scene['image'], '-filter_complex', graph,
        '-map', '[out]', '-t', str(duration), '-an', '-c:v', 'libx264',
        '-preset', 'fast', '-crf', '19', '-movflags', '+faststart', str(part)
    ], check=True)
    parts.append(part)
    captions.append(f"{i + 1}\n{timestamp(scene['output_start'])} --> {timestamp(scene['output_end'])}\n{scene['text']}\n")
    print(f'Completed scene {i + 1}/{len(plan)}', flush=True)

listing = base / 'concat.txt'
listing.write_text(''.join(f"file '{p.name}'\n" for p in parts))
final = base.parent / 'moa-google-oauth-verification-en.mp4'
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat',
    '-safe', '0', '-i', str(listing), '-c', 'copy', '-movflags', '+faststart', str(final)], check=True)
(base.parent / 'moa-google-oauth-verification-en.srt').write_text('\n'.join(captions))
print(f'Exported {final}', flush=True)
