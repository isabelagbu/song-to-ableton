import { EDITIONS, EDITION_LABELS } from './analysis/catalog.js';
import { loadHistory, removeFromHistory, savePendingResult } from './history.js';

const $ = (id) => document.getElementById(id);

let edition = 'lite';
let history = [];
let current = null;
let playing = null;

const player = new Audio();
player.addEventListener('ended', () => stopPreview());

function fitLabel(score) {
  if (score >= 0.75) return 'Strong match';
  if (score >= 0.55) return 'Good match';
  return 'Possible match';
}

const ownedIn = (matchEdition) => EDITIONS.indexOf(matchEdition) <= EDITIONS.indexOf(edition);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function formatTime(totalSeconds) {
  const rounded = Math.round(totalSeconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function showPlaying() {
  for (const card of document.querySelectorAll('.match')) {
    const active = card.dataset.key === playing;
    card.classList.toggle('playing', active);
    const button = card.querySelector('.play');
    if (button) button.textContent = active ? 'Stop' : 'Hear it';
  }
}

function stopPreview() {
  player.pause();
  playing = null;
  showPlaying();
}

function togglePreview(key, url) {
  if (playing === key) {
    stopPreview();
    return;
  }
  player.src = url;
  playing = key;
  showPlaying();
  player.play().catch(stopPreview);
}

function renderMatch(match, layer) {
  const owned = ownedIn(match.edition);
  const card = element('article', owned ? 'match' : 'match locked');
  const top = element('div', 'match-top');
  top.append(
    element('h3', '', match.name),
    element('span', 'fit', fitLabel(match.score)),
    element('span', 'owned', owned ? 'In your edition' : `Needs ${EDITION_LABELS[match.edition]}`),
  );
  if (layer.preview) {
    const key = `${layer.id}:${match.name}`;
    card.dataset.key = key;
    card.classList.add('playable');
    top.append(element('button', 'play', 'Hear it'));
    card.addEventListener('click', () => togglePreview(key, layer.preview.url));
  }
  card.append(top, element('p', '', match.why), element('p', 'start', `Start here: ${match.start}`));
  return card;
}

function renderHistory() {
  $('history').hidden = history.length === 0;
  const rows = history.map((entry) => {
    const row = element('li', entry.id === current?.id ? 'entry selected' : 'entry');
    const open = element('button', 'entry-open');
    const date = new Date(entry.finishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    open.append(
      element('strong', '', entry.title),
      element('span', '', `${date} · ${Math.round(entry.tempo.bpm)} BPM · ${entry.key.name}`),
    );
    if (entry.id === current?.id) open.setAttribute('aria-current', 'true');
    open.addEventListener('click', () => chrome.storage.local.set({ selectedId: entry.id }));
    const remove = element('button', 'entry-remove', '×');
    remove.setAttribute('aria-label', `Delete ${entry.title}`);
    remove.addEventListener('click', () => removeFromHistory(entry.id));
    row.append(open, remove);
    return row;
  });
  $('history-list').replaceChildren(...rows);
}

function render() {
  renderHistory();
  $('results').hidden = !current;
  $('empty').hidden = Boolean(current) || !$('error').hidden;
  if (!current) return;

  $('song-title').textContent = current.title;
  $('no-clips').hidden = current.layers.every((layer) => layer.preview);
  // Slow readings are often half the felt tempo, and fast ones double it.
  const bpm = Math.round(current.tempo.bpm);
  const alternate = bpm < 90 ? bpm * 2 : bpm > 160 ? Math.round(bpm / 2) : null;
  $('tempo').textContent = alternate ? `${bpm} or ${alternate} BPM` : `${bpm} BPM`;
  $('key').textContent = current.key.name;
  $('length').textContent = formatTime(current.seconds);

  const layers = current.layers.map((layer) => {
    const section = element('section', 'layer');
    section.append(element('h2', '', layer.name), element('p', 'traits', layer.traits.join(' · ')));
    if (layer.preview) {
      const moment = formatTime(layer.preview.startSeconds);
      section.append(
        element('p', 'moment', `Click any instrument to hear this part from ${moment} of the audio. They all play the same moment.`),
      );
    }
    if (layer.note) section.append(element('p', 'note', layer.note));
    const sorted = [...layer.matches].sort((a, b) => ownedIn(b.edition) - ownedIn(a.edition) || b.score - a.score);
    section.append(...sorted.map((match) => renderMatch(match, layer)));
    return section;
  });
  if (current.vocals === 'likely') {
    const section = element('section', 'layer');
    section.append(
      element('h2', '', 'Vocals'),
      element('p', 'traits', 'Likely present. Ableton’s instruments don’t recreate a voice, so these aren’t matched to one.'),
    );
    layers.push(section);
  }
  $('layers').replaceChildren(...layers);
  showPlaying();
}

function showError(message) {
  $('error').textContent = message ?? '';
  $('error').hidden = !message;
  render();
}

$('edition').addEventListener('change', () => {
  edition = $('edition').value;
  chrome.storage.local.set({ edition });
  render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.pending?.newValue) savePendingResult();
  else if (changes.history || changes.selectedId || changes.result?.newValue) loadSelection();
  else if (changes.error) showError(changes.error.newValue);
});

async function loadSelection() {
  const stored = await loadHistory();
  history = stored.history;
  const selected = history.find((entry) => entry.id === stored.selectedId) ?? history[0] ?? null;
  if (selected?.id !== current?.id) stopPreview();
  current = selected;
  const { error } = await chrome.storage.local.get('error');
  showError(error);
}

chrome.storage.local.get('edition').then((stored) => {
  edition = stored.edition ?? 'lite';
  $('edition').value = edition;
  savePendingResult().then(loadSelection);
});
