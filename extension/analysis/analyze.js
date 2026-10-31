import {
  ANALYSIS_RATE,
  bandEnvelope,
  binOfHz,
  findOnsets,
  framesPerSecond,
  hzOfBin,
  mean,
  percentile,
  resample,
  separate,
  stft,
} from './dsp.js';
import { matchInstruments } from './catalog.js';
import { buildPreview } from './preview.js';

export const MIN_SECONDS = 8;

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function analyze(input, sampleRate, onProgress = () => {}) {
  const seconds = input.length / sampleRate;
  if (seconds < MIN_SECONDS) {
    throw new Error(`Need at least ${MIN_SECONDS} seconds of audio, but only got ${seconds.toFixed(1)}.`);
  }
  if (rootMeanSquare(input) < 1e-4) {
    throw new Error('The audio was silent. The site may be blocking capture, or nothing was playing.');
  }

  onProgress(0.05, 'Preparing audio');
  const samples = resample(input, sampleRate, ANALYSIS_RATE);
  onProgress(0.2, 'Reading the spectrum');
  const spectrum = stft(samples);
  onProgress(0.35, 'Separating drums from notes');
  const { harmonic, percussive } = separate(spectrum, (p) => onProgress(0.35 + p * 0.4, 'Separating drums from notes'));
  onProgress(0.8, 'Measuring each layer');

  const context = { ...spectrum, harmonic, percussive };
  const tempo = estimateTempo(context);
  const key = estimateKey(context);
  const features = {
    drums: analyzeDrums(context),
    bass: analyzeBass(context),
    melodic: analyzeMelodic(context),
    texture: analyzeTexture(context),
  };
  const vocals = estimateVocals(context);

  onProgress(0.9, 'Making preview clips');
  const layers = matchInstruments(features, { vocals }).map((layer) => ({
    ...layer,
    preview: buildPreview(input, sampleRate, context, layer.id),
  }));
  return { seconds, tempo, key, vocals, layers };
}

function rootMeanSquare(input) {
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
  return Math.sqrt(sum / input.length);
}

function estimateTempo({ percussive, frames, bins }) {
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    let sum = 0;
    for (let b = 0; b < bins; b++) {
      const rise =
        Math.log1p(percussive[f * bins + b] * 10) - Math.log1p(percussive[(f - 1) * bins + b] * 10);
      if (rise > 0) sum += rise;
    }
    flux[f] = sum;
  }
  const average = mean(flux);
  for (let f = 0; f < frames; f++) flux[f] -= average;

  const correlate = (lag) => {
    let sum = 0;
    for (let f = lag; f < frames; f++) sum += flux[f] * flux[f - lag];
    return sum / (frames - lag);
  };
  const zeroLag = correlate(0) || 1;
  const minLag = Math.floor((60 * framesPerSecond) / 200);
  const maxLag = Math.ceil((60 * framesPerSecond) / 60);

  const raw = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) raw[lag] = correlate(lag);

  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (raw[lag] < raw[lag - 1] || raw[lag] < raw[lag + 1]) continue;
    // Autocorrelation peaks at multiples of the beat, so lean toward common tempos.
    const bpm = (60 * framesPerSecond) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    if (raw[lag] * prior > bestScore) {
      bestScore = raw[lag] * prior;
      bestLag = lag;
    }
  }
  const before = raw[bestLag - 1];
  const peak = raw[bestLag];
  const after = raw[bestLag + 1];
  const curve = before - 2 * peak + after;
  const refined = curve === 0 ? bestLag : bestLag + (0.5 * (before - after)) / curve;
  return {
    bpm: Math.round((600 * framesPerSecond) / refined) / 10,
    confidence: clamp(peak / zeroLag),
  };
}

function estimateKey({ harmonic, frames, bins }) {
  const chroma = new Float64Array(12);
  const lo = binOfHz(110);
  const hi = binOfHz(2000);
  for (let f = 0; f < frames; f++) {
    for (let b = lo; b <= hi; b++) {
      const pitch = Math.round(12 * Math.log2(hzOfBin(b) / 440)) + 9;
      chroma[((pitch % 12) + 12) % 12] += harmonic[f * bins + b] ** 2;
    }
  }
  const ranked = [];
  for (let root = 0; root < 12; root++) {
    ranked.push({ root, mode: 'major', score: pearson(chroma, MAJOR_PROFILE, root) });
    ranked.push({ root, mode: 'minor', score: pearson(chroma, MINOR_PROFILE, root) });
  }
  ranked.sort((a, b) => b.score - a.score);
  const [best, second] = ranked;
  return {
    name: `${NOTE_NAMES[best.root]} ${best.mode}`,
    confidence: clamp((best.score - second.score) * 4),
  };
}

function pearson(chroma, profile, root) {
  const chromaMean = mean(chroma);
  const profileMean = mean(profile);
  let top = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < 12; i++) {
    const x = chroma[(i + root) % 12] - chromaMean;
    const y = profile[i] - profileMean;
    top += x * y;
    left += x * x;
    right += y * y;
  }
  return top / (Math.sqrt(left * right) || 1);
}

// How long a band stays above half its level after each attack.
function measureEnvelope(envelope, onsets) {
  const attacks = [];
  const decays = [];
  for (let i = 0; i < onsets.length; i++) {
    const start = onsets[i];
    const stop = i + 1 < onsets.length ? onsets[i + 1] : Math.min(envelope.length, start + 200);
    let peakAt = start;
    for (let f = start; f < Math.min(stop, start + 20); f++) {
      if (envelope[f] > envelope[peakAt]) peakAt = f;
    }
    let end = peakAt;
    while (end < stop && envelope[end] > envelope[peakAt] * 0.5) end++;
    attacks.push((peakAt - start) / framesPerSecond);
    decays.push((end - peakAt) / framesPerSecond);
  }
  return {
    attack: percentile(attacks, 0.5),
    decay: percentile(decays, 0.5),
  };
}

// Share of frames in which the band is sounding.
function sustainOf(envelope) {
  const level = percentile(envelope, 0.95) * 0.25;
  let active = 0;
  for (let i = 0; i < envelope.length; i++) if (envelope[i] > level) active++;
  return active / (envelope.length || 1);
}

function totalEnergy(spec) {
  let sum = 0;
  for (let i = 0; i < spec.length; i++) sum += spec[i] ** 2;
  return sum || 1;
}

function analyzeDrums({ mag, percussive, harmonic, frames, bins }) {
  const percussiveShare = totalEnergy(percussive) / (totalEnergy(percussive) + totalEnergy(harmonic));
  const low = bandEnvelope(percussive, frames, bins, 30, 150);
  const body = bandEnvelope(percussive, frames, bins, 200, 2500);
  const high = bandEnvelope(percussive, frames, bins, 6000, 10500);
  const kicks = findOnsets(low, 8);
  const snares = findOnsets(body, 8);
  const hats = findOnsets(high, 4);
  const seconds = frames / framesPerSecond;

  return {
    present: percussiveShare > 0.06 && (kicks.length + snares.length + hats.length) / seconds > 0.5,
    strength: clamp(percussiveShare * 3),
    kickRate: kicks.length / seconds,
    snareRate: snares.length / seconds,
    hatRate: hats.length / seconds,
    kickDecay: measureEnvelope(bandEnvelope(mag, frames, bins, 30, 150), kicks).decay,
  };
}

function analyzeBass({ harmonic, frames, bins }) {
  const envelope = bandEnvelope(harmonic, frames, bins, 30, 250);
  const level = percentile(envelope, 0.95);
  const lo = binOfHz(30);
  const hi = binOfHz(250);
  const ratios = [];

  for (let f = 0; f < frames; f += 4) {
    if (envelope[f] < level * 0.3) continue;
    const row = f * bins;
    let peak = lo;
    for (let b = lo; b <= hi; b++) if (harmonic[row + b] > harmonic[row + peak]) peak = b;
    const fundamental = harmonic[row + peak] ** 2;
    if (fundamental <= 0) continue;
    let overtones = 0;
    for (let n = 2; n <= 6; n++) {
      const bin = peak * n;
      if (bin + 1 >= bins) break;
      overtones += Math.max(harmonic[row + bin - 1], harmonic[row + bin], harmonic[row + bin + 1]) ** 2;
    }
    ratios.push(overtones / fundamental);
  }

  const share = bandShare(harmonic, frames, bins, 30, 250);
  const onsets = findOnsets(envelope, 6);
  return {
    present: share > 0.04 && ratios.length > 20,
    strength: clamp(share * 2.5),
    // Sine-like basses sit near 0 and saw-like ones well above it.
    richness: clamp(percentile(ratios, 0.5) / 0.6),
    sustain: sustainOf(envelope),
    ...measureEnvelope(envelope, onsets),
  };
}

function bandShare(spec, frames, bins, loHz, hiHz) {
  const envelope = bandEnvelope(spec, frames, bins, loHz, hiHz);
  let sum = 0;
  for (let i = 0; i < envelope.length; i++) sum += envelope[i] ** 2;
  return sum / totalEnergy(spec);
}

function analyzeMelodic({ harmonic, frames, bins }) {
  const lo = binOfHz(250);
  const hi = binOfHz(5000);
  const envelope = bandEnvelope(harmonic, frames, bins, 250, 5000);
  const level = percentile(envelope, 0.95);
  const centroids = [];
  const voices = [];
  const flatness = [];

  for (let f = 0; f < frames; f += 4) {
    if (envelope[f] < level * 0.25) continue;
    const row = f * bins;
    let weighted = 0;
    let total = 0;
    let logSum = 0;
    const chroma = new Float64Array(12);
    for (let b = lo; b <= hi; b++) {
      const power = harmonic[row + b] ** 2;
      weighted += hzOfBin(b) * power;
      total += power;
      logSum += Math.log(power + 1e-12);
      // Only spectral peaks count, or one note smears into neighbouring pitches.
      const isPeak = harmonic[row + b] > harmonic[row + b - 1] && harmonic[row + b] >= harmonic[row + b + 1];
      if (isPeak && hzOfBin(b) < 2000) {
        const pitch = Math.round(12 * Math.log2(hzOfBin(b) / 440)) + 9;
        chroma[((pitch % 12) + 12) % 12] += power;
      }
    }
    if (total <= 0) continue;
    centroids.push(weighted / total);
    flatness.push(Math.exp(logSum / (hi - lo + 1)) / (total / (hi - lo + 1)));
    const loudest = Math.max(...chroma);
    // A single saw's strongest other pitch class, its fifth, stays under this line.
    voices.push(chroma.filter((v) => v > loudest * 0.15).length);
  }

  const brightness = percentile(centroids, 0.5);
  const slow = movingAverage(centroids, 43);
  const spread = percentile(slow, 0.9) - percentile(slow, 0.1);
  const onsets = findOnsets(envelope, 6);
  // Compare peaks, not totals, or short plucks vanish beside a sustained bass.
  const peakLevel = level / (percentile(bandEnvelope(harmonic, frames, bins, 30, 10500), 0.95) || 1);
  return {
    present: peakLevel > 0.12 && centroids.length > 20,
    strength: clamp(peakLevel * 1.5),
    brightness,
    polyphony: percentile(voices, 0.75),
    noisiness: clamp(percentile(flatness, 0.5) * 4),
    // Filter sweeps and wavetable motion shift the tone over seconds. The 2-second
    // average hides ordinary melody movement.
    motion: clamp(spread / (brightness || 1)),
    sustain: sustainOf(envelope),
    ...measureEnvelope(envelope, onsets),
  };
}

function movingAverage(values, width) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= width) sum -= values[i - width];
    if (i >= width - 1) out.push(sum / width);
  }
  return out;
}

function analyzeTexture({ harmonic, frames, bins }) {
  const envelope = bandEnvelope(harmonic, frames, bins, 5000, 10500);
  const share = bandShare(harmonic, frames, bins, 5000, 10500);
  return {
    present: share > 0.015 && sustainOf(envelope) > 0.5,
    strength: clamp(share * 10),
    sustain: sustainOf(envelope),
  };
}

// Sung words pulse at roughly 3-8 Hz inside the speech band. Synth arpeggios can
// do the same, so this only ever produces a hint for the results page.
function estimateVocals({ harmonic, frames, bins }) {
  const envelope = bandEnvelope(harmonic, frames, bins, 300, 3400);
  const average = mean(envelope) || 1;
  let inside = 0;
  let total = 0;
  for (let hz = 0.5; hz <= 20; hz += 0.5) {
    const lag = (2 * Math.PI * hz) / framesPerSecond;
    let re = 0;
    let im = 0;
    for (let f = 0; f < frames; f++) {
      const v = envelope[f] / average - 1;
      re += v * Math.cos(lag * f);
      im += v * Math.sin(lag * f);
    }
    const power = re * re + im * im;
    total += power;
    if (hz >= 3 && hz <= 8) inside += power;
  }
  const score = total ? inside / total : 0;
  if (score > 0.5) return 'likely';
  if (score > 0.35) return 'possible';
  return 'unlikely';
}

function clamp(value) {
  return Math.min(1, Math.max(0, value));
}
