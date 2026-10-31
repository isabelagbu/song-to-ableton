import { analyze } from './analyze.js';

self.onmessage = ({ data: { samples, sampleRate } }) => {
  try {
    const result = analyze(samples, sampleRate, (progress, label) => {
      self.postMessage({ type: 'progress', progress, label });
    });
    self.postMessage({ type: 'done', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
