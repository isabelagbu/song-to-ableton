import { runAnalysis } from './analysis/run-worker.js';

// Long enough for a full song while keeping memory use modest.
const MAX_SECONDS = 300;

let session = null;

const notify = (message) => chrome.runtime.sendMessage({ target: 'background', ...message });

async function start(streamId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
  });
  const context = new AudioContext();
  await context.audioWorklet.addModule('capture-worklet.js');
  const source = context.createMediaStreamSource(stream);
  const collector = new AudioWorkletNode(context, 'capture-collector', { numberOfOutputs: 0 });
  // Capturing a tab mutes it, so send the audio back to the speakers.
  source.connect(context.destination);
  source.connect(collector);

  const blocks = [];
  session = { stream, context, blocks, total: 0 };
  const limit = MAX_SECONDS * context.sampleRate;

  collector.port.onmessage = ({ data }) => {
    if (!session) return;
    blocks.push(data);
    session.total += data.length;
    if (session.total >= limit) stop();
  };
  // Fires when the tab closes or the capture is taken away.
  stream.getAudioTracks()[0].addEventListener('ended', stop);
}

async function stop() {
  if (!session) return;
  const { stream, context, blocks, total } = session;
  session = null;
  stream.getTracks().forEach((track) => track.stop());
  const sampleRate = context.sampleRate;
  await context.close();
  await notify({ type: 'analyzing' });

  const samples = new Float32Array(total);
  let offset = 0;
  for (const block of blocks) {
    samples.set(block, offset);
    offset += block.length;
  }
  blocks.length = 0;

  try {
    const result = await runAnalysis(samples, sampleRate, (progress, label) => {
      notify({ type: 'progress', progress, label });
    });
    await notify({ type: 'done', result });
  } catch (error) {
    await notify({ type: 'failed', error: error.message });
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;
  if (message.type === 'start') {
    start(message.streamId).catch((error) => notify({ type: 'failed', error: error.message }));
  }
  if (message.type === 'stop') stop();
});
