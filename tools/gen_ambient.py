#!/usr/bin/env python3
"""生成 GARGANTUA 氛围音乐 assets/audio/ambient-drone.wav
32 秒无缝循环:深层亚低音 + 五度叠置 drone + 缓慢滤波噪声涌动。纯标准库。
"""
import math
import os
import random
import struct
import wave

SR = 22050
DUR = 32.0
N = int(SR * DUR)
random.seed(20261026)
TWO_PI = 2.0 * math.pi

L = [0.0] * N
R = [0.0] * N


def add_sine(freq, amp, lfo_cycles=0, lfo_depth=0.5, lfo_phase=0.0,
             pan=0.5, detune=0.0, vib_hz=0.0, vib_amt=0.0):
    """叠加一层正弦(可带失谐/颤音/整周期 LFO,保证无缝循环)"""
    for i in range(N):
        t = i / SR
        f = freq * (1.0 + detune)
        if vib_hz:
            f *= 1.0 + vib_amt * math.sin(TWO_PI * vib_hz * t)
        a = amp
        if lfo_cycles:
            a *= 1.0 - lfo_depth + lfo_depth * (0.5 + 0.5 * math.sin(TWO_PI * lfo_cycles * t / DUR + lfo_phase))
        s = math.sin(TWO_PI * f * t)
        gl = a * math.sqrt(1.0 - pan)
        gr = a * math.sqrt(pan)
        L[i] += s * gl
        R[i] += s * gr


# ---- 层 1:36.7 Hz 亚低音,整循环呼吸 ----
add_sine(36.71, 0.30, lfo_cycles=1, lfo_depth=0.55, pan=0.5)
# ---- 层 2:55 Hz + 55.35 Hz 拍频主体 ----
add_sine(55.0, 0.20, lfo_cycles=2, lfo_depth=0.45, pan=0.45)
add_sine(55.35, 0.16, lfo_cycles=2, lfo_depth=0.45, lfo_phase=1.1, pan=0.55)
# ---- 层 3:82.4 Hz(E1,五度)----
add_sine(82.41, 0.12, lfo_cycles=3, lfo_depth=0.5, lfo_phase=2.0, pan=0.4)
# ---- 层 4:八度微光(合唱式失谐)----
add_sine(110.0, 0.055, lfo_cycles=4, lfo_depth=0.6, lfo_phase=0.5, pan=0.62, vib_hz=0.11, vib_amt=0.004)
add_sine(164.81, 0.040, lfo_cycles=4, lfo_depth=0.65, lfo_phase=2.6, pan=0.35, vib_hz=0.09, vib_amt=0.005)
add_sine(220.6, 0.030, lfo_cycles=4, lfo_depth=0.7, lfo_phase=4.2, pan=0.58, vib_hz=0.07, vib_amt=0.006)
# ---- 层 5:高音泛音点缀 ----
add_sine(329.63, 0.012, lfo_cycles=3, lfo_depth=0.85, lfo_phase=1.7, pan=0.5, vib_hz=0.13, vib_amt=0.008)

# ---- 层 6:低通噪声涌动(结尾 2s 与开头交叉淡化,保证无缝)----
noise = [random.uniform(-1, 1) for _ in range(N)]
XFADE = int(2.0 * SR)
y = 0.0
lp = [0.0] * N
for i in range(N):
    t = i / SR
    fc = 260.0 + 620.0 * (0.5 + 0.5 * math.sin(TWO_PI * 3 * t / DUR + 0.9))
    a = 1.0 - math.exp(-TWO_PI * fc / SR)
    y += a * (noise[i] - y)
    lp[i] = y
for i in range(N):
    t = i / SR
    amp = 0.05 * (0.5 + 0.5 * math.sin(TWO_PI * 3 * t / DUR + 0.9))
    s = lp[i] * amp
    if i < XFADE:
        w = i / XFADE
        s = lp[i] * amp * w + lp[N - XFADE + i] * amp * (1 - w)
    L[i] += s * 0.5
    R[i] += s * 0.55

# ---- 归一化 + 软限幅 ----
peak = max(max(abs(v) for v in L), max(abs(v) for v in R))
gain = 0.50 / peak
out = []
for i in range(N):
    for v in (L[i] * gain, R[i] * gain):
        v = math.tanh(v * 1.4) * 0.92
        out.append(int(max(-32768, min(32767, v * 32767))))

dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'audio', 'ambient-drone.wav')
os.makedirs(os.path.dirname(dst), exist_ok=True)
with wave.open(dst, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<h', s) for s in out))
print(f'OK {dst} ({os.path.getsize(dst)} bytes, {DUR:.0f}s @ {SR}Hz stereo)')
