import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze } from '../extension/analysis/analyze.js';
import { cleanTitle, loadHistory, trimHistory } from '../extension/history.js';

const RATE = 44100;
const midiToHz = (note) => 440 * 2 ** ((note - 69) / 12);

function buildTrack({ seconds = 24, bpm, bassNotes, chords, bassWave, chordDecay = null, drums = true }) {
  const out = new Float32Array(seconds * RATE);
  const beat = (60 / bpm) * RATE;
  const add = (start, length, render) => {
    for (let i = 0; i < length && start + i < out.length; i++) out[start + i] += render(i / RATE);
  };
  const saw = (hz, t, partials = 18) => {
    let v = 0;
    for (let n = 1; n <= partials; n++) if (hz * n < 9000) v += Math.sin(2 * Math.PI * hz * n * t) / n;
    return v;
  };

  const beats = Math.floor(out.length / beat);
  for (let b = 0; b < beats; b++) {
    const start = Math.round(b * beat);
    if (drums) {
      add(start, 0.18 * RATE, (t) => 0.8 * Math.exp(-t * 28) * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-t * 40)) * t));
      if (b % 2) add(start, 0.12 * RATE, (t) => 0.3 * Math.exp(-t * 30) * (Math.random() * 2 - 1));
      for (const off of [0, 0.5]) {
        add(Math.round(start + off * beat), 0.04 * RATE, (t) => 0.08 * Math.exp(-t * 120) * (Math.random() * 2 - 1));
      }
    }
    const hz = midiToHz(bassNotes[Math.floor(b / 4) % bassNotes.length]);
    add(start, beat * 0.9, (t) => 0.3 * (bassWave === 'sine' ? Math.sin(2 * Math.PI * hz * t) : saw(hz, t, 10) * 0.6));

    if (b % 4 === 0) {
      const chord = chords[Math.floor(b / 4) % chords.length];
      const length = Math.round(chordDecay ? beat * 2 : beat * 4);
      for (const note of chord) {
        const noteHz = midiToHz(note);
        add(start, length, (t) => {
          const gain = chordDecay ? Math.exp(-t / chordDecay) : Math.min(1, t / 0.3);
          return 0.07 * gain * saw(noteHz, t);
        });
      }
    }
  }
  return out;
}

const A_MINOR = [
  [57, 60, 64],
  [53, 57, 60],
  [55, 59, 62],
  [52, 55, 59],
];

const sineTrack = () =>
  analyze(buildTrack({ bpm: 124, bassNotes: [33, 29, 31, 28], chords: A_MINOR, bassWave: 'sine' }), RATE);

test('finds tempo and key of a synthetic A minor track', () => {
  const result = sineTrack();
  assert.ok(Math.abs(result.tempo.bpm - 124) < 2, `tempo ${result.tempo.bpm}`);
  assert.equal(result.key.name, 'A minor');
});

test('reports drums, bass and melodic layers', () => {
  const ids = sineTrack().layers.map((layer) => layer.id);
  for (const id of ['drums', 'bass', 'melodic']) assert.ok(ids.includes(id), `missing ${id}: ${ids}`);
});

test('tells a sine bass from a saw bass', () => {
  const trait = (result) => result.layers.find((layer) => layer.id === 'bass').traits[0];
  const saw = analyze(buildTrack({ bpm: 124, bassNotes: [33, 29, 31, 28], chords: A_MINOR, bassWave: 'saw' }), RATE);
  assert.equal(trait(sineTrack()), 'Clean and sub-heavy');
  assert.equal(trait(saw), 'Harmonically rich');
});

test('tells held pads from short plucks', () => {
  const traits = (chordDecay) =>
    analyze(buildTrack({ bpm: 124, bassNotes: [33], chords: A_MINOR, bassWave: 'sine', chordDecay }), RATE)
      .layers.find((layer) => layer.id === 'melodic').traits;
  assert.ok(traits(null).includes('Soft, pad-like shape'), traits(null).join());
  assert.ok(traits(0.12).includes('Short, plucked shape'), traits(0.12).join());
});

test('leaves out drums when there are none', () => {
  const result = analyze(
    buildTrack({ bpm: 100, bassNotes: [33], chords: A_MINOR, bassWave: 'sine', drums: false }),
    RATE,
  );
  assert.ok(!result.layers.some((layer) => layer.id === 'drums'));
});

test('every match names a Live edition, a reason and a starting point', () => {
  for (const layer of sineTrack().layers) {
    assert.ok(layer.matches.length > 0, layer.id);
    for (const match of layer.matches) {
      assert.ok(['lite', 'intro', 'standard', 'suite'].includes(match.edition));
      assert.ok(match.why && match.start);
    }
  }
});

function decodePreview(layer) {
  const bytes = Buffer.from(layer.preview.url.split(',')[1], 'base64');
  const samples = [];
  for (let i = 44; i + 1 < bytes.length; i += 2) samples.push(bytes.readInt16LE(i) / 32768);
  return Float32Array.from(samples);
}

// Energy in a one-sample difference grows with pitch, so low clips score near zero.
function brightness(samples) {
  let change = 0;
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    change += (samples[i] - samples[i - 1]) ** 2;
    total += samples[i] ** 2;
  }
  return change / total;
}

test('makes a 5-second preview clip for every layer', () => {
  for (const layer of sineTrack().layers) {
    assert.match(layer.preview.url, /^data:audio\/wav;base64,/);
    assert.equal(decodePreview(layer).length, 5 * RATE);
    assert.equal(Buffer.from(layer.preview.url.split(',')[1], 'base64').readUInt32LE(24), RATE);
    assert.ok(layer.preview.startSeconds >= 0);
  }
});

test('previews keep their own layer and drop the others', () => {
  const { layers } = sineTrack();
  const clip = (id) => decodePreview(layers.find((layer) => layer.id === id));
  assert.ok(brightness(clip('bass')) < brightness(clip('melodic')) / 5);
});

test('turns tab titles into song names', () => {
  const cases = {
    '(3) Artist - Song (Official Music Video) - YouTube': 'Artist - Song',
    'Artist - Song [Official Audio] - YouTube Music': 'Artist - Song',
    'Stream Song by Artist | Listen online for free on SoundCloud': 'Song by Artist',
    'Song (Live at Wembley) - YouTube': 'Song (Live at Wembley)',
    '': 'Untitled song',
  };
  for (const [raw, expected] of Object.entries(cases)) assert.equal(cleanTitle(raw), expected);
  assert.equal(cleanTitle(undefined), 'Untitled song');
});

test('history keeps 25 songs and clips for the newest 5', () => {
  const entries = Array.from({ length: 30 }, (_, id) => ({ id, layers: [{ id: 'bass', preview: { url: 'x' } }] }));
  const trimmed = trimHistory(entries);
  assert.equal(trimmed.length, 25);
  assert.equal(trimmed.filter((entry) => entry.layers[0].preview).length, 5);
  assert.ok(trimmed[4].layers[0].preview);
  assert.equal(trimmed[5].layers[0].id, 'bass');
});

test('adds results saved by an older background script to history', async () => {
  const saved = {
    history: [{ id: 'old', title: 'Song', layers: [] }],
    selectedId: 'old',
    result: { key: { name: 'B minor' }, layers: [] },
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(keys.map((key) => [key, saved[key]])),
        set: async (values) => Object.assign(saved, values),
        remove: async (key) => delete saved[key],
      },
    },
  };
  const { history } = await loadHistory();
  assert.deepEqual(history.map((entry) => entry.title), ['Earlier analysis', 'Song']);
  assert.equal(saved.selectedId, history[0].id);
  assert.equal(saved.result, undefined);
});

test('rejects silence and clips that are too short', () => {
  assert.throws(() => analyze(new Float32Array(RATE * 12), RATE), /silent/);
  assert.throws(() => analyze(new Float32Array(RATE * 2).fill(0.1), RATE), /at least/);
});
