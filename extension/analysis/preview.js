import { HOP, bandEnvelope, fft, framesPerSecond, separate } from './dsp.js';

const CLIP_SECONDS = 5;

// How much of everything else stays audible. Removing it completely leaves
// watery artifacts, so the rest of the mix sits about 20 dB below the part.
const REST_OF_MIX = 0.1;

const LAYERS = {
  drums: { part: 'percussive', loHz: 30, hiHz: 20000 },
  bass: { part: 'harmonic', loHz: 30, hiHz: 250 },
  melodic: { part: 'harmonic', loHz: 250, hiHz: 5000 },
  texture: { part: 'harmonic', loHz: 5000, hiHz: 20000 },
};

// A short clip of one layer, cut from the original audio at its original quality.
export function buildPreview(input, sampleRate, context, layerId) {
  const layer = LAYERS[layerId];
  const { frames, bins } = context;
  const part = bandEnvelope(context[layer.part], frames, bins, layer.loHz, layer.hiHz);
  const whole = bandEnvelope(context.mag, frames, bins, 30, 10500);
  const startFrame = findStandoutMoment(part, whole);
  const startSeconds = startFrame / framesPerSecond;
  const start = Math.round(startSeconds * sampleRate);
  const clip = input.subarray(start, start + CLIP_SECONDS * sampleRate);
  return {
    startSeconds,
    url: toWavDataUrl(emphasize(clip, layer, sampleRate), sampleRate),
  };
}

// Picks the window where the part is the largest share of the mix, ignoring
// windows where the part is quiet, since a share means little in a near-silent gap.
function findStandoutMoment(part, whole) {
  const width = Math.min(part.length, Math.round(CLIP_SECONDS * framesPerSecond));
  const partSums = runningSums(part);
  const wholeSums = runningSums(whole);
  const windowOf = (sums, f) => sums[f + width] - sums[f];

  let loudest = 0;
  for (let f = 0; f + width <= part.length; f++) loudest = Math.max(loudest, windowOf(partSums, f));

  let best = 0;
  let bestShare = -1;
  for (let f = 0; f + width <= part.length; f++) {
    const energy = windowOf(partSums, f);
    if (energy < loudest * 0.5) continue;
    const share = energy / (windowOf(wholeSums, f) || 1);
    if (share > bestShare) {
      bestShare = share;
      best = f;
    }
  }
  return best;
}

function runningSums(envelope) {
  const sums = new Float64Array(envelope.length + 1);
  for (let i = 0; i < envelope.length; i++) sums[i + 1] = sums[i] + envelope[i] ** 2;
  return sums;
}

function smoothStep(value, from, to) {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

// Soft band edges, because sharp cutoffs ring.
function bandWeight(hz, loHz, hiHz) {
  return smoothStep(hz, loHz / 1.3, loHz * 1.3) * (1 - smoothStep(hz, hiHz / 1.3, hiHz * 1.3));
}

// Turns down everything except one layer, then rebuilds the audio.
function emphasize(clip, { part, loHz, hiHz }, sampleRate) {
  const size = sampleRate > 32000 ? 4096 : 2048;
  const hop = size / 4;
  const bins = size / 2 + 1;
  const frames = Math.floor((clip.length - size) / hop) + 1;
  const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));

  const mag = new Float32Array(frames * bins);
  const reals = new Float64Array(frames * bins);
  const imags = new Float64Array(frames * bins);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < size; i++) {
      re[i] = clip[f * hop + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) {
      const index = f * bins + b;
      reals[index] = re[b];
      imags[index] = im[b];
      mag[index] = Math.hypot(re[b], im[b]);
    }
  }

  const target = separate({ mag, frames, bins })[part];
  const weights = Float64Array.from({ length: bins }, (_, b) => bandWeight((b * sampleRate) / size, loHz, hiHz));
  const out = new Float32Array(clip.length);
  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < bins; b++) {
      const index = f * bins + b;
      const share = mag[index] > 0 ? target[index] / mag[index] : 0;
      const gain = REST_OF_MIX + (1 - REST_OF_MIX) * share * weights[b];
      re[b] = reals[index] * gain;
      // Conjugated so the forward FFT runs as an inverse.
      im[b] = -imags[index] * gain;
      if (b > 0 && b < size / 2) {
        re[size - b] = re[b];
        im[size - b] = -im[b];
      }
    }
    fft(re, im);
    // Hann windows overlapping by 3/4 sum to 2.
    for (let i = 0; i < size; i++) out[f * hop + i] += re[i] / size / 2;
  }
  return out;
}

function toWavDataUrl(samples, sampleRate) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const gain = peak > 0 ? 0.9 / peak : 0;
  const fade = Math.min(samples.length / 2, Math.round(0.03 * sampleRate));

  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  writeText(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  writeText(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const edge = Math.min(1, i / fade, (samples.length - 1 - i) / fade);
    view.setInt16(44 + i * 2, Math.round(samples[i] * gain * edge * 32767), true);
  }

  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}
