// Runs the analysis off the main thread. The audio is transferred to the worker
// and dropped once the worker exits, so it's never written anywhere.
export function runAnalysis(samples, sampleRate, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const finish = (settle, value) => {
      worker.terminate();
      settle(value);
    };
    worker.onerror = (event) => finish(reject, new Error(event.message || 'Analysis failed.'));
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress(data.progress, data.label);
      if (data.type === 'done') finish(resolve, data.result);
      if (data.type === 'error') finish(reject, new Error(data.message));
    };
    worker.postMessage({ samples, sampleRate }, [samples.buffer]);
  });
}
