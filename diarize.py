"""Step 2: add speaker labels to transcript.json using sherpa-onnx diarization."""
import json, os, subprocess, sys, time, pathlib
import numpy as np
import sherpa_onnx

tr_path, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
t0_s = sys.argv[3] if len(sys.argv) > 3 else "0"
dur_s = sys.argv[4] if len(sys.argv) > 4 else None
num_speakers = int(sys.argv[5]) if len(sys.argv) > 5 else -1  # -1: auto by threshold

tr = json.loads(tr_path.read_text())
M = pathlib.Path(__file__).parent / "models"
cfg = sherpa_onnx.OfflineSpeakerDiarizationConfig(
    segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
        pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
            model=str(M / "sherpa-onnx-pyannote-segmentation-3-0/model.onnx")),
        num_threads=8),
    embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
        model=str(M / "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"),
        num_threads=8),
    clustering=sherpa_onnx.FastClusteringConfig(num_clusters=num_speakers, threshold=float(os.environ.get('DIAR_THRESHOLD', '0.8'))),
    min_duration_on=0.3, min_duration_off=0.5)
sd = sherpa_onnx.OfflineSpeakerDiarization(cfg)

cmd = ["ffmpeg", "-v", "error", "-ss", t0_s, "-i", tr["source"]]
if dur_s:
    cmd += ["-t", dur_s]
raw = subprocess.run(cmd + ["-vn", "-ac", "1", "-ar", str(sd.sample_rate), "-f", "s16le", "-"],
                     check=True, capture_output=True).stdout
audio = np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0

t = time.time()
def _progress(done, total):
    print(f"PROGRESS {done / max(total, 1):.4f}", flush=True)
    return 0


turns = sd.process(audio, _progress).sort_by_start_time()
run = time.time() - t
turns = [(r.start, r.end, r.speaker) for r in turns]

# 合併碎片群組：總時長 < MIN_SPK_SEC 的群改併入時間上最近的大群，再依總時長重新編號 S0..
tot = {}
for a, b, k in turns:
    tot[k] = tot.get(k, 0) + (b - a)
MIN_SPK_SEC = max(15.0, 0.03 * sum(tot.values()))
big = [(a, b, k) for a, b, k in turns if tot[k] >= MIN_SPK_SEC]
if big:
    def near(a, b):
        return min(big, key=lambda x: max(x[0] - b, a - x[1], 0))[2]
    turns = [(a, b, k if tot[k] >= MIN_SPK_SEC else near(a, b)) for a, b, k in turns]
tot = {}
for a, b, k in turns:
    tot[k] = tot.get(k, 0) + (b - a)
rank = {k: i for i, k in enumerate(sorted(tot, key=tot.get, reverse=True))}
turns = [(a, b, rank[k]) for a, b, k in turns]


def speaker_of(s, e):
    ov = {}
    for a, b, spk in turns:
        o = min(e, b) - max(s, a)
        if o > 0:
            ov[spk] = ov.get(spk, 0) + o
    return f"S{max(ov, key=ov.get)}" if ov else None


for seg in tr["segments"]:
    for w in seg["words"]:
        w["spk"] = speaker_of(w["s"], w["e"])
    cnt = {}
    for w in seg["words"]:
        if w["spk"]:
            cnt[w["spk"]] = cnt.get(w["spk"], 0) + 1
    seg["spk"] = max(cnt, key=cnt.get) if cnt else speaker_of(seg["start"], seg["end"])

tr["turns"] = [{"s": a, "e": b, "spk": f"S{k}"} for a, b, k in turns]
out.write_text(json.dumps(tr, ensure_ascii=False, indent=1))
per = {}
for a, b, k in turns:
    per[f"S{k}"] = per.get(f"S{k}", 0) + (b - a)
print(f"diarize={run:.1f}s turns={len(turns)} speakers={ {k: round(v) for k, v in per.items()} }")
