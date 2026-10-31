// Saved analyses, newest first. Clips use about 2 MB per song, so only the
// newest songs keep theirs.
const MAX_SONGS = 25;
const SONGS_WITH_CLIPS = 5;

const LAST_WORDS = /\s*[-–—|·]\s*(YouTube Music|YouTube|SoundCloud|Bandcamp|Spotify|Deezer|Apple Music|Audiomack)\s*$/i;
const VIDEO_TAGS =
  /\s*[([]\s*(official\s+)?(music\s+|lyrics?\s+|hd\s+|4k\s+)?(video|audio|visuali[sz]er|lyrics?|mv|hd|4k)\s*[)\]]/gi;

export function cleanTitle(raw) {
  const title = (raw ?? '')
    .replace(/^\(\d+\)\s*/, '')
    .replace(/^Stream\s+(.+?)\s*\|\s*Listen online.*$/i, '$1')
    .replace(LAST_WORDS, '')
    .replace(VIDEO_TAGS, '')
    .trim();
  return title || 'Untitled song';
}

function withoutClips(entry) {
  return { ...entry, layers: entry.layers.map(({ preview, ...layer }) => layer) };
}

export function trimHistory(entries) {
  return entries
    .slice(0, MAX_SONGS)
    .map((entry, index) => (index < SONGS_WITH_CLIPS ? entry : withoutClips(entry)));
}

export async function loadHistory() {
  const { history, selectedId, result } = await chrome.storage.local.get(['history', 'selectedId', 'result']);
  if (!result) return { history: history ?? [], selectedId };

  // Saved by a version without history. A background script from one can outlive
  // an update until the extension is reloaded, so this can happen at any time.
  const entry = { ...result, id: crypto.randomUUID(), title: 'Earlier analysis' };
  const updated = trimHistory([entry, ...(history ?? [])]);
  await chrome.storage.local.set({ history: updated, selectedId: entry.id });
  await chrome.storage.local.remove('result');
  return { history: updated, selectedId: entry.id };
}

async function addToHistory(result, title) {
  const { history } = await loadHistory();
  const entry = {
    ...result,
    id: crypto.randomUUID(),
    title: cleanTitle(title),
    finishedAt: Date.now(),
  };
  await chrome.storage.local.set({
    history: trimHistory([entry, ...history]),
    selectedId: entry.id,
    error: null,
  });
}

// Saves a tab capture that the background script handed over.
export async function savePendingResult() {
  const { pending } = await chrome.storage.local.get('pending');
  if (!pending) return;
  await chrome.storage.local.remove('pending');
  await addToHistory(pending.result, pending.title);
}

export async function removeFromHistory(id) {
  const { history, selectedId } = await loadHistory();
  const index = history.findIndex((entry) => entry.id === id);
  const remaining = history.filter((entry) => entry.id !== id);
  const nextSelected = selectedId === id ? remaining[Math.min(index, remaining.length - 1)]?.id : selectedId;
  await chrome.storage.local.set({ history: remaining, selectedId: nextSelected ?? null });
}
