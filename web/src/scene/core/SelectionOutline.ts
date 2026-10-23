// Selection/hover outline that survives post-pipeline rebuilds (tier switches): it keeps the object list and
// re-applies it to whichever OutlineEffect is current (art §5.13).
//
// Contract for the interaction workstream (W6):
// - Pass either the real building meshes or dedicated proxies. Proxies may live on LAYER_SELECTION only (not on
//   layer 0): the main camera then never draws them, and OutlineSelection below keeps it that way.
// - Hover ≈ strength 0.6, selected = 1.0.
import type * as THREE from 'three';
import { Selection, type OutlineEffect } from 'postprocessing';
import type { SelectionOutline } from '../SceneContext';

/**
 * postprocessing's Selection hides the selected objects from the outline's depth pass by disabling layer 0 and
 * afterwards *enables* layer 0 on every one of them — which would make LAYER_SELECTION-only proxies appear in the
 * main render. This variant saves each object's layer mask and restores it exactly. It also hides the objects from
 * `hiddenLayer` (the occluder layer the outline's depth camera uses), so a selected building does not occlude itself.
 */
export class OutlineSelection extends Selection {
  private readonly saved = new Map<THREE.Object3D, number>();

  constructor(layer: number, private readonly hiddenLayer: number) {
    super(undefined, layer);
  }

  override setVisible(visible: boolean): this {
    if (!visible) {
      this.saved.clear();
      for (const object of this) {
        this.saved.set(object, object.layers.mask);
        object.layers.disable(0);
        object.layers.disable(this.hiddenLayer);
      }
    } else {
      for (const object of this) {
        const mask = this.saved.get(object);
        if (mask !== undefined) object.layers.mask = mask;
      }
      this.saved.clear();
    }
    return this;
  }
}

export class OutlineController implements SelectionOutline {
  private objects: THREE.Object3D[] = [];
  private effect: OutlineEffect | null = null;
  private opacity = 1;

  /** Bind to the current pipeline's effect (null on the minimal pipeline). */
  attach(effect: OutlineEffect | null): void {
    this.effect = effect;
    this.apply();
  }

  set(objects: readonly THREE.Object3D[]): void {
    this.objects = [...objects];
    this.apply();
  }

  clear(): void {
    this.objects = [];
    this.apply();
  }

  get strength(): number {
    return this.opacity;
  }

  set strength(v: number) {
    this.opacity = Math.min(1, Math.max(0, v));
    if (this.effect) this.effect.blendMode.opacity.value = this.opacity;
  }

  private apply(): void {
    const e = this.effect;
    if (!e) return;
    e.selection.clear();
    for (const o of this.objects) e.selection.add(o);
    e.blendMode.opacity.value = this.opacity;
  }
}
