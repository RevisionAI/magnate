// Save thumbnails (UX §6.19: 320×180 city snapshot). The city canvas is created
// with preserveDrawingBuffer: false, so it can only be read in the same frame it
// was rendered: we read it from a requestAnimationFrame callback registered after
// the scene's own frame callback, i.e. right after it rendered.

const WIDTH = 320;
const HEIGHT = 180;

function drawCover(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement): void {
  const sw = source.width;
  const sh = source.height;
  const scale = Math.max(WIDTH / sw, HEIGHT / sh);
  const w = WIDTH / scale;
  const h = HEIGHT / scale;
  ctx.drawImage(source, (sw - w) / 2, (sh - h) / 2, w, h, 0, 0, WIDTH, HEIGHT);
}

/** A small data URL of the city view, or null when there is no canvas / it cannot be read. */
export function captureThumbnail(selector = 'canvas.city-canvas'): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const source = document.querySelector<HTMLCanvasElement>(selector);
    if (!source || source.width === 0 || source.height === 0) return resolve(null);
    const timeout = window.setTimeout(() => resolve(null), 500);
    requestAnimationFrame(() => {
      window.clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        drawCover(ctx, source);
        const webp = canvas.toDataURL('image/webp', 0.78);
        resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.8));
      } catch {
        resolve(null);
      }
    });
  });
}
