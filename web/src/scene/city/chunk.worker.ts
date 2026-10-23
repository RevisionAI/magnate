/// <reference lib="webworker" />
// Chunk worker (art §5.4): holds the decoded layout of the active city and builds chunk geometry on request with the
// deterministic asset factories. Results travel back as transferables, so the main thread never blocks on geometry.
import { CityBuildContext } from './build/CityBuildContext';
import { buildChunk, transferables } from './build/buildChunk';
import type { WorkerRequest, WorkerResponse } from './chunkProtocol';

declare const self: DedicatedWorkerGlobalScope;

let ctx: CityBuildContext | null = null;
let key = '';

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.kind === 'layout') {
    try {
      ctx = new CityBuildContext(msg.layout);
      key = msg.layoutKey;
    } catch (error) {
      ctx = null;
      key = '';
      const out: WorkerResponse = { kind: 'error', layoutKey: msg.layoutKey, jobId: -1, chunk: -1, message: String(error) };
      self.postMessage(out);
    }
    return;
  }
  const job = msg.job;
  if (!ctx || job.layoutKey !== key) {
    const out: WorkerResponse = { kind: 'error', layoutKey: job.layoutKey, jobId: job.jobId, chunk: job.chunk, message: 'stale layout' };
    self.postMessage(out);
    return;
  }
  try {
    const result = buildChunk(ctx, job);
    const out: WorkerResponse = { kind: 'built', result };
    self.postMessage(out, transferables(result));
  } catch (error) {
    const out: WorkerResponse = { kind: 'error', layoutKey: job.layoutKey, jobId: job.jobId, chunk: job.chunk, message: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error) };
    self.postMessage(out);
  }
};
