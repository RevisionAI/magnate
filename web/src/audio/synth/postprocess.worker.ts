/// <reference lib="webworker" />
// Audio DSP worker: the PCM post-processing stage of procedural loop renders (seam bake, BS.1770
// loudness normalisation, lookahead peak limiting) and the shared noise sources, off the main thread,
// so rendering the city's ambience beds and building loops never stalls a frame. Protocol: render.ts
// PostJob → PostResult, with the channel buffers transferred both ways.

import { makeNoise } from './noise';
import { postProcess, type PostJob, type PostResult } from './render';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<PostJob>) => {
  const job = event.data;
  try {
    const out = job.kind === 'noise' ? makeNoise(job.noise, job.frames) : postProcess(job.chans, job.opts);
    const result: PostResult = { id: job.id, chans: out };
    self.postMessage(result, out.map((c) => c.buffer as ArrayBuffer));
  } catch (error) {
    const result: PostResult = { id: job.id, error: String(error) };
    self.postMessage(result);
  }
};
