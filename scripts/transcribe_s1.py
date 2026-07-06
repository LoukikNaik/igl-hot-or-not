#!/usr/bin/env python3
"""Download audio for all S1 episodes (Dailymotion) and transcribe with mlx-whisper.

Run with the transcribe project's venv python:
  /Users/loukiknaik/projects/transcribe/venv/bin/python scripts/transcribe_s1.py

Writes transcripts/ep<N>.txt ("[MM:SS] text" lines). Skips episodes already done.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TDIR = os.path.join(HERE, 'transcripts')
MODEL = 'mlx-community/whisper-large-v3-turbo'

def log(msg):
    print(msg, flush=True)

def main():
    import mlx_whisper  # from the transcribe venv

    episodes = []
    with open(os.path.join(TDIR, 'episode_ids.txt')) as f:
        for line in f:
            parts = line.split()
            if len(parts) == 2:
                episodes.append((int(parts[0]), parts[1]))

    for ep, vid in episodes:
        out_txt = os.path.join(TDIR, f'ep{ep}.txt')
        if os.path.exists(out_txt):
            log(f'ep{ep}: transcript exists, skip')
            continue

        audio = os.path.join(TDIR, f'ep{ep}.m4a')
        if not os.path.exists(audio):
            log(f'ep{ep}: downloading audio ({vid})...')
            r = subprocess.run(
                ['yt-dlp', '--no-update', '-f', 'bestaudio/best', '-x',
                 '--audio-format', 'm4a', '-o', audio,
                 f'https://www.dailymotion.com/video/{vid}'],
                capture_output=True, text=True)
            if r.returncode != 0 or not os.path.exists(audio):
                log(f'ep{ep}: DOWNLOAD FAILED\n{r.stderr[-500:]}')
                continue

        log(f'ep{ep}: transcribing...')
        try:
            res = mlx_whisper.transcribe(audio, path_or_hf_repo=MODEL, language='hi')
        except Exception as e:
            log(f'ep{ep}: TRANSCRIBE FAILED {e}')
            continue

        lines = []
        for seg in res.get('segments', []):
            s = int(seg['start'])
            text = seg['text'].strip()
            if text:
                lines.append(f'[{s // 60}:{s % 60:02d}] {text}')
        with open(out_txt, 'w') as f:
            f.write('\n'.join(lines))
        log(f'ep{ep}: done, {len(lines)} segments')
        os.remove(audio)  # keep disk usage sane

    log('ALL DONE')

if __name__ == '__main__':
    main()
