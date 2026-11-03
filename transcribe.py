"""Step 1: video -> transcript.json (word-level timestamps, no speakers yet)."""
import json, subprocess, sys, time, tempfile, pathlib
import numpy as np
from faster_whisper import WhisperModel

src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
t0_s = sys.argv[3] if len(sys.argv) > 3 else "0"
dur_s = sys.argv[4] if len(sys.argv) > 4 else None

with tempfile.TemporaryDirectory() as d:
    wav = pathlib.Path(d) / "a.wav"
    cmd = ["ffmpeg", "-v", "error", "-ss", t0_s, "-i", str(src)]
    if dur_s:
        cmd += ["-t", dur_s]
    subprocess.run(cmd + ["-vn", "-ac", "1", "-ar", "16000", str(wav)], check=True)
    t = time.time()
    model = WhisperModel("large-v3-turbo", device="cpu", compute_type="int8", cpu_threads=16)
    load = time.time() - t
    t = time.time()
    audio = np.frombuffer(wav.read_bytes()[44:], np.int16).astype(np.float32) / 32768.0
    segs, info = model.transcribe(audio, word_timestamps=True, vad_filter=True)
    segments = []
    for s in segs:  # lazy generator: report progress as segments arrive
        segments.append({"start": s.start, "end": s.end, "text": s.text.strip(),
                         "words": [{"w": w.word, "s": w.start, "e": w.end, "p": w.probability} for w in s.words]})
        print(f"PROGRESS {min(s.end / info.duration, 1):.4f}", flush=True)
    run = time.time() - t

out.write_text(json.dumps({"source": str(src), "language": info.language,
                           "duration": info.duration, "segments": segments},
                          ensure_ascii=False, indent=1))
print(f"lang={info.language} audio={info.duration:.0f}s load={load:.1f}s "
      f"transcribe={run:.1f}s rtf={run/info.duration:.2f} segs={len(segments)}")
