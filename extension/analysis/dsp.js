// Small signal-processing helpers. No dependencies, so this runs in a browser
// worker and in Node tests alike.

export const ANALYSIS_RATE = 22050;
export const FFT_SIZE = 2048;
export const HOP = 512;

// Windowed-sinc low-pass followed by linear interpolation.
export function resample(input, fromRate, toRate = ANALYSIS_RATE) {
  if (fromRate === toRate) return Float32Array.from(input);
  const ratio = fromRate / toRate;
  const filtered = ratio > 1 ? lowPass(input, 0.45 / ratio) : input;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, filtered.length - 1);
    const frac = pos - left;
    out[i] = filtered[left] * (1 - frac) + filtered[right] * frac;
  }
  return out;
}

function lowPass(input, cutoff) {
  const halfWidth = 32;
  const taps = new Float32Array(halfWidth * 2 + 1);
  let sum = 0;
  for (let i = -halfWidth; i <= halfWidth; i++) {
    const sinc = i === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * i) / (Math.PI * i);
    const window = 0.5 + 0.5 * Math.cos((Math.PI * i) / (halfWidth + 1));
    taps[i + halfWidth] = sinc * window;
    sum += taps[i + halfWidth];
  }
  const out = new Float32Array(input.length);
  for (let n = 0; n < input.length; n++) {
    let acc = 0;
    for (let k = 0; k < taps.length; k++) {
      const index = n + k - halfWidth;
      if (index >= 0 && index < input.length) acc += input[index] * taps[k];
    }
    out[n] = acc / sum;
  }
  return out;
}

// In-place radix-2 FFT.
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

// Magnitude spectrogram stored as one flat array: mag[frame * bins + bin].
export function stft(samples) {
  const bins = FFT_SIZE / 2 + 1;
  const frames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP) + 1);
  const mag = new Float32Array(frames * bins);
  const window = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (let f = 0; f < frames; f++) {
    const offset = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = samples[offset + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    const row = f * bins;
    for (let b = 0; b < bins; b++) mag[row + b] = Math.hypot(re[b], im[b]);
  }
  return { mag, frames, bins };
}

function median(values, length) {
  // Insertion sort is fastest for the short windows used here.
  for (let i = 1; i < length; i++) {
    const v = values[i];
    let j = i - 1;
    while (j >= 0 && values[j] > v) {
      values[j + 1] = values[j];
      j--;
    }
    values[j + 1] = v;
  }
  return values[length >> 1];
}

// Harmonic/percussive separation by median filtering. Sustained notes form
// horizontal lines in a spectrogram and drum hits form vertical ones.
export function separate({ mag, frames, bins }, onProgress = () => {}) {
  // A note must outlast timeSpan frames (~120 ms) to count as harmonic, so plucks survive.
  const timeSpan = 5;
  const binSpan = 8;
  const harmonicMedian = new Float32Array(mag.length);
  const percussiveMedian = new Float32Array(mag.length);
  const scratch = new Float32Array(Math.max(timeSpan, binSpan) * 2 + 1);

  for (let f = 0; f < frames; f++) {
    const row = f * bins;
    for (let b = 0; b < bins; b++) {
      let count = 0;
      for (let t = Math.max(0, f - timeSpan); t <= Math.min(frames - 1, f + timeSpan); t++) {
        scratch[count++] = mag[t * bins + b];
      }
      harmonicMedian[row + b] = median(scratch, count);
      count = 0;
      for (let k = Math.max(0, b - binSpan); k <= Math.min(bins - 1, b + binSpan); k++) {
        scratch[count++] = mag[row + k];
      }
      percussiveMedian[row + b] = median(scratch, count);
    }
    if (f % 500 === 0) onProgress(f / frames);
  }

  const harmonic = new Float32Array(mag.length);
  const percussive = new Float32Array(mag.length);
  for (let i = 0; i < mag.length; i++) {
    const h = harmonicMedian[i] ** 2;
    const p = percussiveMedian[i] ** 2;
    const total = h + p;
    if (total > 0) {
      harmonic[i] = mag[i] * (h / total);
      percussive[i] = mag[i] * (p / total);
    }
  }
  return { harmonic, percussive };
}

export const binOfHz = (hz) => Math.round((hz * FFT_SIZE) / ANALYSIS_RATE);
export const hzOfBin = (bin) => (bin * ANALYSIS_RATE) / FFT_SIZE;
export const framesPerSecond = ANALYSIS_RATE / HOP;

// Per-frame energy of one band.
export function bandEnvelope(spec, frames, bins, loHz, hiHz) {
  const lo = binOfHz(loHz);
  const hi = Math.min(binOfHz(hiHz), bins - 1);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const row = f * bins;
    for (let b = lo; b <= hi; b++) sum += spec[row + b] ** 2;
    env[f] = Math.sqrt(sum);
  }
  return env;
}

export function mean(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

export function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

// Frame indexes where an envelope jumps clearly above its recent level.
export function findOnsets(envelope, minGapFrames = 5) {
  const flux = new Float32Array(envelope.length);
  for (let i = 1; i < envelope.length; i++) flux[i] = Math.max(0, envelope[i] - envelope[i - 1]);
  const threshold = mean(flux) + 1.5 * Math.sqrt(mean(flux.map((v) => v * v)));
  const onsets = [];
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] < threshold || flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue;
    if (onsets.length && i - onsets[onsets.length - 1] < minGapFrames) continue;
    onsets.push(i);
  }
  return onsets;
}
