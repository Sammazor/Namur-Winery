"""
NAMURA Wine Studio - original score & sound design (fully synthesised, no samples).

Picture-locked to studio/src/timeline.js (cuts at 3.0, 6.0, 8.0, montage beats every
0.7 s from 10.0, final hit at 15.0).  Output: build/audio/namura_score.wav (48 kHz stereo)

Palette
  - warm analogue-style string pad (detuned band-limited saws, low-passed)
  - felt-piano plucks (inharmonic additive partials, hammer noise)
  - glass "tings" (inharmonic bell partials) on foil glints and the logo reveal
  - deep cinematic hits (pitched sub drop + low thud + air) on reveals
  - spectral whooshes / risers (time-varying filtered noise via STFT masks)
  - generated stereo hall reverb (convolution)
"""
import os
import numpy as np
from scipy import signal

SR = 48000
DUR = 20.0
N = int(SR * DUR)
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'build/audio'); os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(2023)
t_all = np.arange(N) / SR

def note(n):  # MIDI -> Hz
    return 440.0 * 2 ** ((n - 69) / 12)

NOTE = {k: v for k, v in zip(['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'], range(12))}
def m(name):  # 'D3' -> midi
    return 12 * (int(name[-1]) + 1) + NOTE[name[:-1]]

def place(buf, x, start, gain=1.0, pan=0.0):
    """mix mono/stereo x into stereo buf at time start (s), equal-power pan"""
    i = int(start * SR)
    if i >= N: return
    if x.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        x = np.stack([x * l, x * r], 1)
    if i < 0: x = x[-i:]; i = 0
    n = min(len(x), N - i)
    buf[i:i + n] += x[:n] * gain

def env_adsr(n, a, d, s, r, sr=SR):
    a, d, r = int(a * sr), int(d * sr), int(r * sr)
    e = np.ones(n) * s
    e[:a] = np.linspace(0, 1, a) ** 2 if a else 1
    if d: e[a:a + d] = np.linspace(1, s, min(d, max(0, n - a)))[:len(e[a:a + d])]
    if r: e[-r:] *= np.linspace(1, 0, r) ** 1.5
    return e

def lowpass(x, fc, order=2):
    b, a = signal.butter(order, min(fc / (SR / 2), 0.99), 'low'); return signal.lfilter(b, a, x, axis=0)
def highpass(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), 'high'); return signal.lfilter(b, a, x, axis=0)
def bandpass(x, f1, f2, order=2):
    b, a = signal.butter(order, [f1 / (SR / 2), min(f2 / (SR / 2), 0.99)], 'band'); return signal.lfilter(b, a, x, axis=0)

def saw(f, n, detune_cents=0.0, phase=0.0):
    """band-limited sawtooth via additive synthesis"""
    t = np.arange(n) / SR; f = f * 2 ** (detune_cents / 1200)
    out = np.zeros(n); k = 1
    while k * f < 9000 and k < 40:
        out += np.sin(2 * np.pi * k * f * t + phase * k) / k; k += 1
    return out * (2 / np.pi)

# ---------------------------------------------------------------- instruments
def pad(notes, dur, bright=1400, attack=1.2, release=1.6):
    n = int((dur + release) * SR)
    L = np.zeros(n); R = np.zeros(n)
    for nm in notes:
        f = note(m(nm))
        for dc, side in [(-7, -1), (0, 0), (6, 1), (11, 0.5)]:
            v = saw(f, n, dc, rng.uniform(0, 6.28))
            g = 1.0 / (1 + 0.15 * (m(nm) - 50) / 12)
            L += v * g * (0.5 - 0.35 * side); R += v * g * (0.5 + 0.35 * side)
    st = np.stack([L, R], 1)
    st = lowpass(st, bright, 2)
    # slow filter "breath": blend a darker copy
    dark = lowpass(st, bright * 0.45, 2)
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * 0.11 * np.arange(n) / SR)[:, None]
    st = st * (0.6 + 0.4 * lfo) + dark * (0.4 - 0.4 * lfo)
    e = env_adsr(n, attack, 0.5, 0.85, release)[:, None]
    st = highpass(st, 70, 2)                 # keep the sub range for the hits
    return st * e / max(1, len(notes)) * 0.5

def piano(nm, dur=2.5, vel=0.8):
    f0 = note(m(nm)); n = int(dur * SR); t = np.arange(n) / SR
    B = 0.0004; out = np.zeros(n)
    for k in range(1, 14):
        fk = k * f0 * np.sqrt(1 + B * k * k)
        if fk > 12000: break
        amp = vel ** (1 + 0.15 * k) / k ** 1.1
        dec = 1.8 / (1 + 0.35 * k) * (440 / f0) ** 0.25
        out += amp * np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.28)) * np.exp(-t / dec) * (1 - np.exp(-t * 400))
    ham = lowpass(rng.standard_normal(n) * np.exp(-t * 90), 2500) * 0.08 * vel
    return (out + ham) * 0.3 * (1 - np.exp(-(dur - t) * 20))

def glass(f0=2200, dur=3.5, amp=0.25):
    n = int(dur * SR); t = np.arange(n) / SR; out = np.zeros(n)
    for ratio, a, d in [(1, 1, 1.1), (2.756, 0.45, 0.6), (5.404, 0.25, 0.35), (8.933, 0.12, 0.2), (1.003, 0.6, 1.3)]:
        out += a * np.sin(2 * np.pi * f0 * ratio * t) * np.exp(-t / d)
    out *= (1 - np.exp(-t * 3000))
    return out * amp * 0.6

def hit(dur=4.0, amp=1.0, f_hi=72, f_lo=34):
    n = int(dur * SR); t = np.arange(n) / SR
    f = f_lo + (f_hi - f_lo) * np.exp(-t * 6)
    ph = 2 * np.pi * np.cumsum(f) / SR
    sub = np.sin(ph) * np.exp(-t / 1.4) * (1 - np.exp(-t * 300))
    thud = lowpass(rng.standard_normal(n), 220, 4) * np.exp(-t * 9) * 2.2
    air = bandpass(rng.standard_normal(n), 1500, 9000) * np.exp(-t * 4) * 0.12
    body = lowpass(rng.standard_normal(n), 900, 2) * np.exp(-t * 3.5) * 0.35
    x = sub * 1.0 + thud + air + body
    return np.tanh(x * 1.4) * amp * 0.7

def spectral_noise(dur, fc_curve, bw_curve, amp_curve, seed=0):
    """noise shaped by a time-varying band (STFT mask) -> whooshes / risers"""
    n = int(dur * SR); r = np.random.default_rng(seed)
    x = r.standard_normal(n)
    f, tt, Z = signal.stft(x, SR, nperseg=2048, noverlap=1536)
    u = np.clip(tt / dur, 0, 1)
    fc = fc_curve(u)[None, :]; bw = bw_curve(u)[None, :]
    mask = np.exp(-0.5 * (np.log2(np.maximum(f[:, None], 20) / fc) / bw) ** 2)
    _, y = signal.istft(Z * mask, SR, nperseg=2048, noverlap=1536)
    y = y[:n]; y = y / (np.abs(y).max() + 1e-9)
    return y * amp_curve(np.arange(len(y)) / max(1, len(y) - 1))

def whoosh(dur=0.9, up=True, amp=0.5, seed=1):
    peak = 0.62
    fc = (lambda u: 300 * (16 ** u)) if up else (lambda u: 5000 / (16 ** u))
    y = spectral_noise(dur, fc, lambda u: 0.55 + 0.3 * u, lambda u: (np.minimum(u / peak, 1) ** 2) * np.exp(-np.maximum(u - peak, 0) * 9), seed)
    # stereo: pan sweep across the cut
    pan = np.linspace(-0.7, 0.7, len(y)) * (1 if up else -1)
    return np.stack([y * np.cos((pan + 1) * np.pi / 4), y * np.sin((pan + 1) * np.pi / 4)], 1) * amp

def riser(dur, amp=0.4):
    y = spectral_noise(dur, lambda u: 400 * (12 ** (u ** 1.5)), lambda u: 0.6 + 0.0 * u, lambda u: u ** 2.2, seed=9)
    n = len(y); t = np.arange(n) / SR
    tone = np.zeros(n)
    for k, base in enumerate([m('A3'), m('E4'), m('A4')]):
        f = note(base) * 2 ** ((t / dur) ** 2 * 0.5)  # rises a tritone-ish
        tone += np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25
    tone *= (t / dur) ** 2.5
    return (y * 0.7 + tone * 0.35) * amp

def tom(amp=0.5):
    n = int(0.9 * SR); t = np.arange(n) / SR
    f = 50 + 40 * np.exp(-t * 25)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6) * amp + lowpass(rng.standard_normal(n), 400) * np.exp(-t * 40) * 0.15 * amp

def reverb_ir(dur=3.2, predelay=0.025, damp=5500, seed=4):
    n = int(dur * SR); r = np.random.default_rng(seed); t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    for c in range(2):
        x = r.standard_normal(n) * np.exp(-t * 6.9 / dur)
        lo = lowpass(x, damp, 1); hi_decay = np.exp(-t * 3)
        ir[:, c] = lo * (1 - hi_decay) + x * hi_decay * 0.6
    # early reflections
    for d, g in [(0.011, 0.5), (0.019, 0.35), (0.027, 0.3), (0.041, 0.22)]:
        ir[int((d + predelay) * SR), 0] += g; ir[int((d * 1.13 + predelay) * SR), 1] += g
    ir[:int(predelay * SR)] = 0
    return ir / np.sqrt((ir ** 2).sum(0)).max()

def convolve(x, ir):
    return np.stack([signal.fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], 1)

# ---------------------------------------------------------------- arrangement
music = np.zeros((N, 2)); sfx = np.zeros((N, 2)); verb_send = np.zeros((N, 2))

# 0-3  dark air: drone fifth + high shimmer
drone = pad(['D2', 'A2'], 3.6, bright=600, attack=1.4, release=1.2)
place(music, drone, 0.0, 1.1)
shim_t = np.arange(int(3.4 * SR)) / SR
shim = sum(np.sin(2 * np.pi * note(m(x)) * shim_t + i) for i, x in enumerate(['D6', 'A6', 'E7'])) / 3
shim *= (0.5 + 0.5 * np.sin(2 * np.pi * 5.3 * shim_t)) * np.minimum(shim_t / 2.5, 1) ** 2 * np.exp(-np.maximum(shim_t - 3.0, 0) * 6)
place(verb_send, shim * 0.05, 0.0, 1.0, 0.3)
place(sfx, glass(2350, 3.0, 0.13), 1.95, 1.0, -0.2); place(verb_send, glass(2350, 3.0, 0.13), 1.95, 0.6, -0.2)
place(sfx, whoosh(1.2, True, 0.28, 3), 1.9)

# 3  reveal: hit + Dm(add9)
place(sfx, hit(4.5, 1.0), 2.98); place(verb_send, hit(4.5, 0.4), 2.98)
place(music, pad(['D2', 'A2', 'D3', 'F3', 'A3', 'E4'], 3.2, bright=1500, attack=0.35), 2.95, 1.0)
for i, (nm, tt) in enumerate([('A4', 3.6), ('D5', 4.3), ('E5', 5.0)]):
    p = piano(nm, 3.0, 0.55); place(music, p, tt, 0.55, 0.2 * (i - 1)); place(verb_send, p, tt, 0.5)
place(sfx, glass(1760, 3.0, 0.09), 4.05, 1.0, 0.25); place(verb_send, glass(1760, 3.0, 0.09), 4.05, 0.8)

# 6  whip into HAROEH: whoosh + soft hit + Bbmaj7
place(sfx, whoosh(0.85, True, 0.55, 5), 6.0 - 0.53)
place(sfx, hit(3.0, 0.5, 60, 32), 6.0); place(verb_send, hit(3.0, 0.25), 6.0)
place(music, pad(['Bb1', 'Bb2', 'F3', 'A3', 'D4'], 2.2, bright=1700, attack=0.25), 5.95, 1.0)
for nm, tt in [('F5', 6.5), ('D5', 7.05), ('A4', 7.5)]:
    p = piano(nm, 2.5, 0.5); place(music, p, tt, 0.5, -0.2); place(verb_send, p, tt, 0.55)

# 8  light transition into IVRI: reverse swell + ting, F/A colour
place(sfx, whoosh(1.0, False, 0.35, 7), 7.55)
place(sfx, glass(2637, 3.0, 0.12), 8.0, 1.0, 0.3); place(verb_send, glass(2637, 3.0, 0.12), 8.0, 0.8)
place(music, pad(['A2', 'F3', 'C4', 'G4'], 2.2, bright=1800, attack=0.3), 7.95, 1.0)
for nm, tt in [('C5', 8.45), ('G5', 9.0), ('A5', 9.4)]:
    p = piano(nm, 2.5, 0.45); place(music, p, tt, 0.45, 0.25); place(verb_send, p, tt, 0.6)

# 10-15  montage: pulse on every beat (0.7 s), arpeggios, whooshes on whips
beat = 0.7
prog = [['D2', 'A2', 'D3', 'F3', 'A3'], ['Bb1', 'F2', 'D3', 'F3', 'Bb3'], ['F2', 'C3', 'F3', 'A3', 'C4'], ['C2', 'G2', 'E3', 'G3', 'C4']]
arps = [['D4', 'F4', 'A4', 'E5'], ['D4', 'F4', 'Bb4', 'F5'], ['C4', 'F4', 'A4', 'G5'], ['C4', 'E4', 'G4', 'D5']]
place(sfx, whoosh(0.7, True, 0.5, 11), 10.0 - 0.43)
for k in range(5):  # 2-beat chords 10.0 .. 13.5
    t0 = 10.0 + k * 2 * beat
    if t0 >= 13.5: break
    place(music, pad(prog[k % 4], 2 * beat + 0.1, bright=1900, attack=0.06, release=0.6), t0, 0.85)
    for j, nm in enumerate(arps[k % 4] * 1):
        p = piano(nm, 1.6, 0.42 + 0.06 * (j == 0)); tt = t0 + j * beat / 2
        place(music, p, tt, 0.42, (-0.4, 0.4)[j % 2]); place(verb_send, p, tt, 0.5)
for k in range(8):
    tt = 10.0 + k * beat
    place(sfx, tom(0.55 if k % 2 == 0 else 0.35), tt); place(verb_send, tom(0.2), tt)
for tt in [11.4, 12.8]:
    place(sfx, whoosh(0.55, tt == 11.4, 0.42, int(tt * 10)), tt - 0.34)
for tt in [10.7, 12.1, 13.5, 14.2]:  # hard cuts: tight glassy transient
    place(sfx, glass(3136 if tt != 13.5 else 2794, 1.2, 0.07), tt, 1.0, 0.0); place(verb_send, glass(3136, 1.2, 0.05), tt)
# build: A sus4 -> A with riser into the final hit
place(music, pad(['A1', 'A2', 'D3', 'E3', 'A3'], 0.75, bright=2000, attack=0.1, release=0.4), 13.5, 0.9)
place(music, pad(['A1', 'A2', 'C#3', 'E3', 'A3'], 0.85, bright=2400, attack=0.1, release=0.3), 14.2, 1.0)
place(sfx, riser(1.5, 0.55), 13.5)
for k, nm in enumerate(['A4', 'C#5', 'E5', 'A5']):
    p = piano(nm, 1.2, 0.4); place(music, p, 14.2 + k * 0.18, 0.4); place(verb_send, p, 14.2 + k * 0.18, 0.4)

# 15-20  resolution: big hit, D major (add9) bloom, logo sparkle, tail
place(sfx, hit(5.0, 1.15, 80, 31), 14.99); place(verb_send, hit(5.0, 0.5), 14.99)
final = pad(['D2', 'A2', 'D3', 'F#3', 'A3', 'E4', 'F#4'], 4.5, bright=2100, attack=0.5, release=1.5)
place(music, final, 15.0, 1.15)
for nm, tt, v in [('F#5', 15.6, 0.5), ('A5', 16.25, 0.45), ('E5', 16.9, 0.42), ('D5', 17.7, 0.4), ('A4', 18.5, 0.35)]:
    p = piano(nm, 3.0, v); place(music, p, tt, v, 0.15); place(verb_send, p, tt, 0.7)
for k, f in enumerate([2349, 2794, 3520, 4186, 4699]):   # logo sparkle (D-major bell arpeggio)
    g = glass(f, 2.5, 0.06); place(sfx, g, 16.45 + k * 0.09, 1.0, -0.5 + 0.25 * k); place(verb_send, g, 16.45 + k * 0.09, 1.0)
place(sfx, glass(1175, 4.0, 0.08), 17.55); place(verb_send, glass(1175, 4.0, 0.1), 17.55)
place(sfx, whoosh(1.6, True, 0.22, 21), 15.8)

# ---------------------------------------------------------------- mix & master
ir = reverb_ir(3.4)
wet = convolve(verb_send + music * 0.35 + sfx * 0.12, ir)
mix = music * 0.62 + sfx * 1.0 + wet * 0.5
mix = highpass(mix, 28, 2)
# gentle glue compression (RMS envelope follower)
rms = np.sqrt(lowpass(np.mean(mix ** 2, 1), 8, 1).clip(1e-9))
gain = np.minimum(1.0, (0.22 / rms) ** 0.2)[:, None]
mix *= gain
# fades: in with picture, out at the end
fade = np.minimum(1, t_all / 0.15) * np.clip((DUR - t_all) / 0.6, 0, 1) ** 1.5
mix *= fade[:, None]
mix = mix / np.abs(mix).max() * 0.98
mix = np.tanh(mix * 1.25) / np.tanh(1.25)          # soft limiter
mix = mix / np.abs(mix).max() * 0.89                 # ~ -1 dBFS peak before loudnorm

pcm = (mix * 32767).astype(np.int16)
from scipy.io import wavfile
wavfile.write(os.path.join(OUT, 'namura_score.wav'), SR, pcm)
print('wrote', os.path.join(OUT, 'namura_score.wav'), f'{DUR}s')
