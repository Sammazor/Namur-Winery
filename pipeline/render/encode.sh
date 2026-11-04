#!/usr/bin/env bash
# NAMURA Wine Studio - final encode & mux.
#   bash pipeline/render/encode.sh <frames_dir> <out.mp4> [fps] [--upscale4k]
# Produces an Instagram-Reels-ready H.264 High profile MP4 (BT.709, yuv420p, faststart)
# with the synthesised score loudness-normalised to -14 LUFS / -1 dBTP.
set -euo pipefail
FRAMES=${1:-build/frames_1080x1920}
OUT=${2:-output/NAMURA_Reel_1080x1920.mp4}
FPS=${3:-30}
AUDIO=build/audio/namura_score.wav
mkdir -p "$(dirname "$OUT")"
[ -f "$AUDIO" ] || .venv/bin/python pipeline/audio/score.py
VF="format=yuv420p"
if [[ "${4:-}" == "--upscale4k" ]]; then
  VF="scale=2160:3840:flags=lanczos+accurate_rnd+full_chroma_int,unsharp=5:5:0.35:5:5:0.0,format=yuv420p"
fi
ffmpeg -hide_banner -loglevel warning -y \
  -framerate "$FPS" -i "$FRAMES/f_%04d.png" -i "$AUDIO" \
  -map 0:v -map 1:a \
  -vf "$VF" -c:v libx264 -preset ${PRESET:-medium} -threads 2 -crf ${CRF:-19} -profile:v high -tune film \
  -x264-params "keyint=$((FPS*2)):min-keyint=$FPS:aq-mode=3" \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -af "loudnorm=I=-14:TP=-1.0:LRA=7" -c:a aac -b:a 320k -ar 48000 \
  -movflags +faststart -shortest "$OUT"
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,duration -of compact "$OUT"
