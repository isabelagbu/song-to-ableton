// Keeps the capture state and opens results. Audio itself lives in the offscreen
// document, because service workers can't hold a media stream.
//
// Keep this file free of imports: with one, Brave failed to start this worker
// after a browser restart. Finished results go to the results page to save.

const IDLE = { phase: 'idle' };

async function getState() {
  const { state } = await chrome.storage.session.get('state');
  return state ?? IDLE;
}

function setState(state) {
  return chrome.storage.session.set({ state });
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA', 'WORKERS'],
    justification: 'Listen to the current tab and analyze the audio locally.',
  });
}

async function closeOffscreen() {
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
}

async function start(tabId) {
  const current = await getState();
  if (current.phase === 'capturing' || current.phase === 'analyzing') return;
  const { title } = await chrome.tabs.get(tabId);
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  await chrome.storage.local.remove('error');
  await setState({ phase: 'capturing', tabId, title, startedAt: Date.now() });
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId });
}

async function finish(save) {
  await save();
  await setState(IDLE);
  await closeOffscreen();
  const url = chrome.runtime.getURL('app.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) await chrome.tabs.update(existing.id, { active: true });
  else await chrome.tabs.create({ url });
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.target !== 'background') return false;
  const handle = {
    start: () => start(message.tabId),
    stop: () => chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }),
    analyzing: async () => setState({ ...(await getState()), phase: 'analyzing', label: 'Starting' }),
    progress: async () => setState({ ...(await getState()), label: message.label, progress: message.progress }),
    done: () =>
      finish(async () => {
        const { title } = await getState();
        await chrome.storage.local.set({ pending: { result: message.result, title }, error: null });
      }),
    failed: () => finish(() => chrome.storage.local.set({ error: message.error })),
  }[message.type];
  handle?.()
    .then(() => reply({ ok: true }))
    .catch((error) => reply({ ok: false, error: error.message }));
  return true;
});
