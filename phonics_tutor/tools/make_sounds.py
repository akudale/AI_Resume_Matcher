"""
Generate Pip's 40 phonics sound clips with an open-source voice, and check each one.

How it works
  1. Kokoro-82M (Apache-2.0) says a short real word, e.g. "sun". Text-to-speech models say
     words well but add a stray vowel when asked for a lone sound ("s" -> "s-ah").
  2. A phoneme recogniser (wav2vec2-lv-60-espeak-cv-ft, Apache-2.0) finds where each sound is.
  3. Consonants: we try cut points and keep a clip only if the recogniser hears exactly the target
     sound in it, nothing else. Vowels: taken from words like "cat" where the vowel is the only
     voiced part, after checking the whole word was said right. Long sounds ("sss") are slowed
     down when the slower version still passes the check.
  4. Clips are levelled, faded and saved as small WAV files in static/sounds/ (lossless: MP3 coding
     was found to smear such short sounds), plus manifest.json and report.json.

Run (needs internet access to huggingface.co the first time, ~1.6 GB of models):
    pip install onnxruntime numpy soundfile
    python tools/make_sounds.py                 # all 40 sounds
    python tools/make_sounds.py s sh a          # just some
Options: --voice af_heart (default, US) | bf_emma (UK) ...   --models DIR (model cache)
Needs ffmpeg on PATH (used to slow down long sounds).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "static" / "sounds"
SR = 24000
HF = "https://huggingface.co"
TTS_REPO = "onnx-community/Kokoro-82M-v1.0-ONNX"
REC_REPO = "onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX"

# id -> (accepted recogniser readings, [(word in Kokoro phonemes, where the sound is), ...], stretch?)
# "initial": sound starts the word; "final": ends it; "middle": between consonants; "whole": the clip is the sound;
# "cvc:<onset>:<coda>": a vowel between two voiceless stops ("cat", "keep"). The vowel is the only voiced
# part of such a word, so it can be cut out exactly where voicing starts and stops. We check the whole
# word was said right: a lone vowel is hard to name out of context, for recognisers and listeners alike.
RECIPES = {
    "s": ([["s"]], [("sˈʌn", "initial"), ("sˈɪt", "initial")], True),
    "z": ([["z"]], [("zˈɪp", "initial"), ("zˈu", "initial")], True),
    "f": ([["f"]], [("fˈæn", "initial"), ("fˈɪʃ", "initial")], True),
    "v": ([["v"]], [("vˈæn", "initial"), ("vˈɛt", "initial"), ("vˈæt", "initial"), ("vˈIn", "initial"), ("vˈɛst", "initial")], True),
    "m": ([["m"]], [("mˈæp", "initial"), ("mˈun", "initial")], True),
    "n": ([["n"]], [("nˈɛt", "initial"), ("nˈʌt", "initial")], True),
    "l": ([["l"]], [("lˈɛɡ", "initial"), ("lˈɑɡ", "initial")], True),
    "r": ([["ɹ"]], [("ɹˈɛd", "initial"), ("ɹˈæt", "initial"), ("ɹˈɪp", "initial"), ("ɹˈʌn", "initial"), ("ɹˈɑk", "initial")], True),
    "sh": ([["ʃ"]], [("ʃˈɑp", "initial"), ("ʃˈɪp", "initial")], True),
    "th": ([["θ"]], [("θˈʌm", "initial"), ("θˈɪn", "initial")], True),
    "ng": ([["ŋ"]], [("ɹˈɪŋ", "final"), ("kˈɪŋ", "final")], True),
    "h": ([["h"]], [("hˈæt", "initial"), ("hˈɛn", "initial")], False),
    "w": ([["w"]], [("wˈɛb", "initial"), ("wˈɪɡ", "initial")], False),
    "y": ([["j"]], [("jˈæk", "initial"), ("jˈɛs", "initial")], False),
    "t": ([["t"]], [("tˈæp", "initial"), ("tˈɛn", "initial")], False),
    "p": ([["p"]], [("pˈɪɡ", "initial"), ("pˈæn", "initial")], False),
    "k": ([["k"]], [("kˈæt", "initial"), ("kˈɪt", "initial")], False),
    "b": ([["b"]], [("bˈæt", "initial"), ("bˈɛd", "initial")], False),
    "d": ([["d"]], [("dˈɑɡ", "initial"), ("dˈɛn", "initial")], False),
    "g": ([["ɡ"]], [("ɡˈæp", "initial"), ("ɡˈɛt", "initial")], False),
    "j": ([["dʒ"]], [("ʤˈæm", "initial"), ("ʤˈɛt", "initial")], False),
    "ch": ([["tʃ"]], [("ʧˈɪp", "initial"), ("ʧˈɛk", "initial")], False),
    "ks": ([["k", "s"]], [("bˈɑks", "final"), ("fˈɑks", "final")], False),
    "kw": ([["k", "w"]], [("kwˈin", "initial"), ("kwˈɪk", "initial")], False),
    "a": ([["æ"]], [("kˈæt", "cvc:k:t"), ("pˈæt", "cvc:p:t"), ("tˈæp", "cvc:t:p")], False),
    "e": ([["ɛ"]], [("pˈɛt", "cvc:p:t"), ("kˈɛp", "cvc:k:p"), ("tˈɛk", "cvc:t:k")], False),
    "i": ([["ɪ"]], [("kˈɪt", "cvc:k:t"), ("pˈɪt", "cvc:p:t"), ("tˈɪp", "cvc:t:p")], False),
    "o": ([["ɑ"], ["ɑː"]], [("pˈɑt", "cvc:p:t"), ("kˈɑt", "cvc:k:t"), ("tˈɑp", "cvc:t:p")], False),
    "u": ([["ʌ"]], [("kˈʌt", "cvc:k:t"), ("kˈʌp", "cvc:k:p"), ("tˈʌk", "cvc:t:k"), ("pˈʌt", "cvc:p:t"), ("pˈʌk", "cvc:p:k")], False),
    "ay": ([["eɪ"]], [("kˈAp", "cvc:k:p"), ("tˈAk", "cvc:t:k"), ("pˈAt", "cvc:p:t")], False),
    "ee": ([["iː"], ["i"]], [("kˈip", "cvc:k:p"), ("pˈik", "cvc:p:k"), ("kˈit", "cvc:k:t"), ("pˈit", "cvc:p:t"), ("tˈik", "cvc:t:k")], False),
    "igh": ([["aɪ"]], [("kˈIt", "cvc:k:t"), ("tˈIp", "cvc:t:p"), ("pˈIp", "cvc:p:p")], False),
    "oh": ([["oʊ"]], [("kˈOt", "cvc:k:t"), ("tˈOp", "cvc:t:p"), ("pˈOk", "cvc:p:k")], False),
    "yoo": ([["j", "uː"], ["j", "u"], ["juː"]], [("kjˈut", "cvc:k:t"), ("pjˈuk", "cvc:p:k"), ("jˈu", "whole"), ("jˈuː", "whole")], False),
    "oo": ([["uː"], ["u"]], [("kˈup", "cvc:k:p"), ("tˈut", "cvc:t:t"), ("pˈup", "cvc:p:p")], False),
    "ar": ([["ɑː", "ɹ"], ["ɑːɹ"], ["ɑ", "ɹ"], ["ɑɹ"], ["ɑː"]], [("kˈɑɹt", "cvc:k:t"), ("pˈɑɹt", "cvc:p:t"), ("tˈɑɹt", "cvc:t:t")], False),
    "or": ([["ɔː", "ɹ"], ["ɔːɹ"], ["ɔ", "ɹ"], ["ɔɹ"], ["oːɹ"], ["ɔː"], ["oː", "ɹ"]], [("kˈɔɹt", "cvc:k:t"), ("pˈɔɹt", "cvc:p:t"), ("tˈɔɹt", "cvc:t:t")], False),
    "er": ([["ɜː"], ["ɚ"], ["ɜː", "ɹ"], ["ɝ"], ["ɜːɹ"]], [("kˈɜɹt", "cvc:k:t"), ("pˈɜɹt", "cvc:p:t"), ("hˈɜɹt", "cvc:h:t"), ("tˈɜɹk", "cvc:t:k"), ("pˈɜɹk", "cvc:p:k")], False),
    "ow": ([["aʊ"]], [("pˈWt", "cvc:p:t"), ("tˈWt", "cvc:t:t"), ("kˈWt", "cvc:k:t")], False),
    "oy": ([["ɔɪ"], ["oɪ"]], [("kˈYt", "cvc:k:t"), ("tˈYk", "cvc:t:k"), ("pˈYt", "cvc:p:t")], False),
}


def fetch(repo: str, path: str, models: Path) -> Path:
    dest = models / repo.replace("/", "__") / path
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {repo}/{path} ...", flush=True)
        subprocess.run(["curl", "-fsSL", "-o", str(dest), f"{HF}/{repo}/resolve/main/{path}"], check=True)
    return dest


class Voice:
    def __init__(self, models: Path, voice: str):
        self.vocab = json.load(open(fetch(TTS_REPO, "tokenizer.json", models)))["model"]["vocab"]
        self.sess = ort.InferenceSession(str(fetch(TTS_REPO, "onnx/model.onnx", models)))
        self.style = np.fromfile(fetch(TTS_REPO, f"voices/{voice}.bin", models), dtype=np.float32).reshape(-1, 1, 256)

    def say(self, phonemes: str, speed: float = 0.85) -> np.ndarray:
        ids = [0] + [self.vocab[c] for c in phonemes] + [0]
        wav = self.sess.run(None, {
            "input_ids": np.array([ids], np.int64),
            "style": self.style[len(phonemes)],
            "speed": np.array([speed], np.float32),
        })[0]
        return wav.reshape(-1).astype(np.float32)


class Recogniser:
    PAD = 0.3  # seconds of silence around audio

    def __init__(self, models: Path):
        self.sess = ort.InferenceSession(str(fetch(REC_REPO, "onnx/model.onnx", models)))
        vocab = json.load(open(fetch(REC_REPO, "vocab.json", models)))
        self.id2tok = {v: k for k, v in vocab.items()}

    def spikes(self, a: np.ndarray) -> list[tuple[str, float]]:
        """Recognised phonemes with the time (s, relative to `a`) where each one fires."""
        t = np.arange(0, len(a) / SR, 1 / 16000)
        x = np.interp(t, np.arange(len(a)) / SR, a).astype(np.float32)
        pad = np.zeros(int(self.PAD * 16000), np.float32)
        x = np.concatenate([pad, x, pad])
        x = (x - x.mean()) / (x.std() + 1e-7)
        ids = self.sess.run(None, {self.sess.get_inputs()[0].name: x[None]})[0][0].argmax(-1)
        out, prev = [], None
        for f, i in enumerate(ids):
            tok = self.id2tok[int(i)]
            if i != prev and tok not in ("<pad>", "<s>", "</s>", "<unk>", "|"):
                out.append((tok, f * 0.02 - self.PAD))
            prev = i
        return out

    def hears(self, a: np.ndarray) -> list[str]:
        return [t for t, _ in self.spikes(a) if t != "ʔ"]


def trim(a: np.ndarray, db: float = -40) -> np.ndarray:
    win = 240
    if len(a) < win:
        return a
    rms = np.sqrt(np.convolve(a ** 2, np.ones(win) / win, "same") + 1e-12)
    on = np.where(20 * np.log10(rms / rms.max()) > db)[0]
    return a[on[0]:on[-1] + 1] if len(on) else a[:0]


def finish(a: np.ndarray, fade: float = 0.012) -> np.ndarray:
    a = a - a.mean()
    n = min(int(fade * SR), len(a) // 3)
    if n:
        ramp = np.linspace(0, 1, n) ** 2
        a[:n] *= ramp
        a[-n:] *= ramp[::-1]
    return (a / (np.abs(a).max() + 1e-9) * 0.7).astype(np.float32)


def stretch(a: np.ndarray, factor: float) -> np.ndarray:
    """Slow a sound down (keeping its pitch) with ffmpeg's speech time-stretch, e.g. "sss" -> "ssssss"."""
    with tempfile.TemporaryDirectory() as d:
        src, dst = Path(d) / "in.wav", Path(d) / "out.wav"
        sf.write(src, a, SR)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(src), "-filter:a", f"atempo={factor}", str(dst)], check=True)
        b, _ = sf.read(dst)
    return b.astype(np.float32)


def voiced_run(a: np.ndarray):
    """(start, end) samples of the longest stretch of voiced (periodic, loud) sound."""
    n, hop = int(0.02 * SR), int(0.005 * SR)
    lo_lag, hi_lag = SR // 400, SR // 70
    starts = list(range(0, len(a) - n, hop))
    rms = np.array([np.sqrt((a[i:i + n] ** 2).mean()) for i in starts])
    voiced = []
    for k, i in enumerate(starts):
        fr = a[i:i + n] - a[i:i + n].mean()
        ac = np.correlate(fr, fr, "full")[n - 1:]
        voiced.append(rms[k] > 0.15 * rms.max() and ac[lo_lag:hi_lag].max() / (ac[0] + 1e-9) > 0.6)
    best, cur = None, None
    for k, v in enumerate(voiced + [False]):
        if v and cur is None:
            cur = k
        elif not v and cur is not None:
            if best is None or k - cur > best[1] - best[0]:
                best = (cur, k)
            cur = None
    return None if best is None else (starts[best[0]], starts[best[1] - 1] + n)


def ok(heard: list[str], accept: list[list[str]]) -> bool:
    dedup = [t for i, t in enumerate(heard) if i == 0 or t != heard[i - 1]]
    return any(heard == want or dedup == want for want in accept)


VOWELS = {"a", "e", "i", "o", "u", "ay", "ee", "igh", "oh", "yoo", "oo", "ar", "or", "er", "ow", "oy"}
_carriers: dict = {}


def check(rec: Recogniser, clip: np.ndarray, accept: list[list[str]], vowel: bool) -> tuple[bool, list[str]]:
    """Is this clip exactly the target sound?

    A lone vowel is hard to recognise (the recogniser hears most of them as "ah"), so a vowel is
    also tested inside a word made of our own consonant clips: b + vowel + d must be heard as b-?-d.
    """
    heard = rec.hears(finish(clip.copy()))
    if ok(heard, accept):
        return True, heard
    if vowel and _carriers:
        gap = np.zeros(int(0.01 * SR), np.float32)
        word = np.concatenate([_carriers["b"], gap, finish(clip.copy()), gap, _carriers["d"]])
        in_word = rec.hears(word)
        if any(in_word == ["b"] + want + ["d"] for want in accept):
            return True, in_word
        return False, in_word
    return False, heard


def extract(voice: Voice, rec: Recogniser, word: str, kind: str, accept: list[list[str]], vowel=False, speed=0.85):
    a = trim(voice.say(word, speed))
    if kind.startswith("cvc:"):
        _, onset, coda = kind.split(":")
        heard = rec.hears(a)
        if not any(heard == [onset] + want + [coda] for want in accept):
            return None, heard
        run = voiced_run(a)
        if run is None:
            return None, heard
        lo, hi = run
        clip = a[lo + int(0.01 * SR):hi - int(0.01 * SR)]
        return (clip, heard) if len(clip) >= 0.08 * SR else (None, heard)
    if kind.startswith("vstop:"):
        tail = kind.split(":", 1)[1].split()
        heard = rec.hears(a)
        if not any(heard == want + tail for want in accept):
            return None, heard
        win = int(0.01 * SR)
        rms = np.sqrt(np.convolve(a ** 2, np.ones(win) / win, "same"))
        peak = int(np.argmax(rms[: int(len(a) * 0.7)]))
        quiet = np.where(rms[peak:] < rms[peak] * 0.06)[0]  # the stop's closure
        if not len(quiet):
            return None, heard
        end = peak + int(quiet[0]) - int(0.005 * SR)
        clip = a[:end]
        if len(clip) < 0.08 * SR:
            return None, heard
        return clip, heard
    if kind == "whole":
        good, heard = check(rec, a, accept, vowel)
        return (a, heard) if good else (None, heard)
    sp = rec.spikes(a)
    toks = [t for t, _ in sp if t != "ʔ"]
    times = [s for t, s in sp if t != "ʔ"]
    n = len(accept[0])
    step = int(0.01 * SR)
    dur = len(a)
    if kind == "initial":
        stop = int(times[n] * SR) if len(times) > n else dur
        for end in range(min(stop + 4 * step, dur), int(0.04 * SR), -step):  # longest clean clip
            clip = a[:end]
            good, heard = check(rec, clip, accept, vowel)
            if good:
                return clip, heard
    elif kind == "final":
        k = len(toks) - n
        begin = int(times[k - 1] * SR) if k >= 1 else 0
        for start in range(max(0, begin - 4 * step), dur - int(0.04 * SR), step):  # earliest clean start
            clip = a[start:]
            good, heard = check(rec, clip, accept, vowel)
            if good:
                return clip, heard
    elif kind == "middle":
        # vowel between two consonants: the loud, voiced stretch around the vowel's spike
        if len(times) < 2:
            return None, toks
        win = int(0.01 * SR)
        rms = np.sqrt(np.convolve(a ** 2, np.ones(win) / win, "same"))
        centre = min(dur - 1, int(times[1] * SR))
        lo_lim, hi_lim = int(times[0] * SR), int(times[2] * SR) if len(times) > 2 else dur
        centre = lo_lim + int(np.argmax(rms[lo_lim:hi_lim])) if hi_lim > lo_lim else centre
        heard = toks
        for frac in (0.3, 0.4, 0.5, 0.2, 0.6):
            thr = rms[centre] * frac
            lo = centre
            while lo > lo_lim and rms[lo] > thr:
                lo -= 1
            hi = centre
            while hi < hi_lim - 1 and rms[hi] > thr:
                hi += 1
            lo, hi = lo + int(0.015 * SR), hi - int(0.01 * SR)
            if hi - lo < 0.06 * SR:
                continue
            good, heard = check(rec, a[lo:hi], accept, vowel)
            if good:
                return a[lo:hi], heard
    return None, toks


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ids", nargs="*", help="phoneme ids to make (default: all)")
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--models", default=os.environ.get("PIP_MODELS", str(Path.home() / ".cache" / "pip-phonics")))
    args = ap.parse_args()
    models = Path(args.models)
    voice, rec = Voice(models, args.voice), Recogniser(models)
    OUT.mkdir(parents=True, exist_ok=True)
    report_path = OUT / "report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    # Consonant clips used to test vowels in a word (b + vowel + d).
    for cid in ("b", "d"):
        for word, kind in RECIPES[cid][1]:
            c, _ = extract(voice, rec, word, kind, RECIPES[cid][0])
            if c is not None:
                _carriers[cid] = finish(c.copy())
                break
    for pid in args.ids or RECIPES:
        accept, recipes, long_sound = RECIPES[pid]
        clip, heard, used = None, None, None
        speeds = (0.6, 0.75, 0.85) if long_sound else (0.65, 0.75, 0.85, 1.0)
        for speed in speeds:
            for word, kind in recipes:
                clip, heard = extract(voice, rec, word, kind, accept, False, speed)
                if clip is not None:
                    used = (word, kind)
                    break
            if clip is not None:
                break
        if clip is None:
            print(f"{pid:4} FAILED (last heard {heard}) -> the voice will say this sound instead")
            report[pid] = {"ok": False, "heard": heard}
            (OUT / f"{pid}.wav").unlink(missing_ok=True)
            continue
        clip = finish(clip.copy())
        if long_sound:
            # Longer is easier for a child to copy ("sssss"), but keep it only if it still sounds right.
            for factor in (0.5, 0.67, 0.8):
                longer = finish(stretch(clip, factor))
                if ok(rec.hears(longer), accept):
                    clip = longer
                    break
        if pid not in VOWELS and not ok(rec.hears(clip), accept):
            print(f"{pid:4} FAILED final check (heard {rec.hears(clip)})")
            report[pid] = {"ok": False, "heard": rec.hears(clip)}
            (OUT / f"{pid}.wav").unlink(missing_ok=True)
            continue
        if pid not in VOWELS:
            heard = rec.hears(clip)
        dest = OUT / f"{pid}.wav"
        for subtype in ("PCM_16", "FLOAT"):  # 16-bit is smaller; keep full precision if rounding changes the sound
            sf.write(dest, clip, SR, subtype=subtype)
            saved, _ = sf.read(dest)
            if pid in VOWELS or ok(rec.hears(saved.astype(np.float32)), accept):
                break
        if pid not in VOWELS and not ok(rec.hears(saved.astype(np.float32)), accept):
            print(f"{pid:4} FAILED after saving")
            report[pid] = {"ok": False}
            dest.unlink()
            continue
        report[pid] = {"ok": True, "from": used[0], "where": used[1], "heard": heard, "seconds": round(len(clip) / SR, 2), "voice": args.voice}
        print(f"{pid:4} ok   from {used[0]:6} ({used[1]:7}) {len(clip) / SR:.2f}s  heard {' '.join(heard)}", flush=True)
    report_path.write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
    subprocess.run([sys.executable, str(ROOT / "build_sounds.py")], check=True)


if __name__ == "__main__":
    main()
