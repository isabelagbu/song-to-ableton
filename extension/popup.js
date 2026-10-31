const MIN_SECONDS = 8;

const message = document.getElementById('message');
const timer = document.getElementById('timer');
const bar = document.getElementById('bar');
const action = document.getElementById('action');
const open = document.getElementById('open');

let state = { phase: 'idle' };
let needsReload = false;

const send = (payload) => chrome.runtime.sendMessage({ target: 'background', ...payload });

function render() {
  const capturing = state.phase === 'capturing';
  const analyzing = state.phase === 'analyzing';
  timer.hidden = !capturing;
  bar.hidden = !analyzing;
  action.hidden = analyzing;
  action.textContent = capturing ? 'Stop and analyze' : 'Start listening';
  if (capturing) {
    const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
    timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    action.disabled = seconds < MIN_SECONDS;
    message.textContent =
      seconds < MIN_SECONDS ? 'Listening. Keep the song playing.' : 'Listening. 30 to 60 seconds gives good results.';
  } else if (analyzing) {
    message.textContent = `${state.label ?? 'Analyzing'}…`;
    bar.firstElementChild.style.width = `${Math.round((state.progress ?? 0) * 100)}%`;
  } else if (needsReload) {
    action.disabled = false;
    action.textContent = 'Open extensions page';
    message.textContent = 'Update ready. Click the reload arrow on the Song to Ableton card, then come back.';
  } else {
    action.disabled = false;
    message.textContent = 'Play a song in this tab, skip any ads, then start listening.';
  }
}

action.addEventListener('click', async () => {
  if (state.phase === 'capturing') {
    await send({ type: 'stop' });
    return;
  }
  if (needsReload) {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const response = await send({ type: 'start', tabId: tab.id });
  if (!response?.ok) message.textContent = response?.error ?? 'Could not listen to this tab.';
});

open.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }));

chrome.storage.session.onChanged.addListener((changes) => {
  if (!changes.state) return;
  state = changes.state.newValue ?? { phase: 'idle' };
  render();
});

// Pages pick up edited files right away, but the background script keeps running
// its old code until a reload, and the two then disagree about where results go.
async function checkForUpdate() {
  const onDisk = await (await fetch(chrome.runtime.getURL('manifest.json'))).json();
  needsReload = onDisk.version !== chrome.runtime.getManifest().version;
  render();
}

chrome.storage.session.get('state').then((stored) => {
  state = stored.state ?? state;
  render();
  checkForUpdate();
  setInterval(() => state.phase === 'capturing' && render(), 500);
});
