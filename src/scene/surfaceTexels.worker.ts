import { SURFACES, surfaceTexels } from './surfaceTexels';

self.onmessage = () => {
  const all = SURFACES.map((kind) => surfaceTexels(kind));
  self.postMessage(all, {
    transfer: all.flatMap((t) => [
      t.color.buffer,
      t.normal.buffer,
      t.rough.buffer,
    ]),
  });
};
