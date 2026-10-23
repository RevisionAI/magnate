// Reference implementation from docs/overhaul/research/art-rendering.md Appendix A (types/n8ao.d.ts).
// Verified to type-check against three 0.186 / postprocessing 6.39.5 / camera-controls 3.1.2.
// n8ao 2.0.1 ships no type declarations — minimal shim for the parts Magnate uses (HIGH tier only).
declare module 'n8ao' {
  import type { Camera, Scene, Color } from 'three';
  import { Pass } from 'postprocessing';
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number; distanceFalloff: number; intensity: number; color: Color; halfRes: boolean;
      depthAwareUpsampling: boolean; gammaCorrection: boolean; screenSpaceRadius: boolean; aoSamples: number;
      denoiseSamples: number; denoiseRadius: number; transparencyAware: boolean; accumulate: boolean;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setDisplayMode(mode: 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO'): void;
  }
}
