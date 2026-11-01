import type { Texels } from './surfaceTexels';

let painting: Promise<Texels[]> | undefined;
/**
 * Surface texels in SURFACES order. A worker paints them (about 1.5 s of main thread on a
 * phone) while three.js downloads; without workers this thread paints them.
 */
export function paintSurfaces() {
  return (painting ??= new Promise((resolve) => {
    const onThread = () =>
      void import('./surfaceTexels').then(({ SURFACES, surfaceTexels }) =>
        resolve(SURFACES.map(surfaceTexels)),
      );
    try {
      const worker = new Worker(
        new URL('./surfaceTexels.worker.ts', import.meta.url),
      );
      worker.onmessage = ({ data }) => {
        resolve(data);
        worker.terminate();
      };
      worker.onerror = () => {
        worker.terminate();
        onThread();
      };
      worker.postMessage(null);
    } catch {
      onThread();
    }
  }));
}
