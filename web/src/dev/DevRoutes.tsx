// Dev-only pages, selected with ?dev=<name>. Each page is owned by one workstream:
//   assets → W4 (AssetGallery), scene → W1 (SceneLab), audio → A1 (AudioLab), ui → U1 (UiKit), city → W2 (CityPreview).
import { lazy, Suspense } from 'react';

const pages = {
  assets: lazy(() => import('./AssetGallery').then((m) => ({ default: m.AssetGallery }))),
  scene: lazy(() => import('./SceneLab').then((m) => ({ default: m.SceneLab }))),
  audio: lazy(() => import('./AudioLab').then((m) => ({ default: m.AudioLab }))),
  ui: lazy(() => import('./UiKit').then((m) => ({ default: m.UiKit }))),
  city: lazy(() => import('./CityPreview').then((m) => ({ default: m.CityPreview }))),
} as const;

export type DevPage = keyof typeof pages;

export function devPageFromUrl(): DevPage | null {
  const name = new URLSearchParams(window.location.search).get('dev');
  return name && name in pages ? (name as DevPage) : null;
}

export function DevRoute({ page }: { page: DevPage }) {
  const Page = pages[page];
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <Page />
    </Suspense>
  );
}
