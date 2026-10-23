// Company trucks on the real supply chains (art §3.16, §5.16): every `supplyFlows` transfer of the last closed month
// becomes clamp(ceil(qty / payload), 1, 6) trips spread over the visual month, driven by A* on the road graph from the
// source building's frontage to the destination's, cab (or box) in the owner colour and the trailer by product.
// Imports and exports run between the building and the port quay (a seaport in the city) or the nearest map-edge
// exit, in neutral white livery; inter-city transfers drive to or from the nearest exit. Retail flows are shoppers,
// not trucks. Pure scheduling here; TrafficModule spawns the vehicles.
import type { FlowDto } from '@/bridge/protocol';
import { factoryFamily, trailerFor } from '../assets/families/common-b/products';
import { hash3 } from '../env/rng';

/** Units per truckload used for the trip count (engine units of the content; a monthly flow of 400 → 1 truck). */
export const TRUCK_PAYLOAD = 400;
export const MAX_TRIPS_PER_LINK = 6;

export type TruckModel = 'boxTruck' | 'truckBox' | 'truckReefer' | 'truckTanker' | 'truckHopper';

export interface TruckTrip {
  /** 0..1 position in the visual month at which the truck departs. */
  at: number;
  kind: FlowDto['kind'];
  productId: string;
  /** Building ids at either end; null = off-city end (port or highway exit). */
  from: number | null;
  to: number | null;
  model: TruckModel;
  /** Stable key (flow index + trip) for de-duplication. */
  key: string;
}

const RAW_TRAILERS: Readonly<Record<string, TruckModel>> = {
  crude_oil: 'truckTanker',
  iron_ore: 'truckHopper',
  wheat: 'truckHopper',
  sugarcane: 'truckHopper',
  coffee_beans: 'truckHopper',
  hops: 'truckHopper',
  cotton: 'truckBox',
  sugar: 'truckHopper',
  flour: 'truckHopper',
  malt: 'truckHopper',
};

/** Truck model for a product: rigid box truck for store deliveries, otherwise a semi with the product's trailer. */
export function truckModelFor(productId: string, toRetail: boolean): TruckModel {
  if (toRetail) return 'boxTruck';
  return RAW_TRAILERS[productId] ?? trailerFor(factoryFamily([productId], 0));
}

/** Trips for a month of flows in a city. `isRetail(id)` tells whether a building is a store. */
export function planTrips(flows: readonly FlowDto[], cityId: string, inCity: (id: number) => boolean, isRetail: (id: number) => boolean, monthSeed: number): TruckTrip[] {
  const trips: TruckTrip[] = [];
  flows.forEach((f, index) => {
    if (f.kind === 'retail') return;
    const fromIn = f.fromBuildingId !== undefined && inCity(f.fromBuildingId) && (f.fromCityId === undefined || f.fromCityId === cityId);
    const toIn = f.toBuildingId !== undefined && inCity(f.toBuildingId) && (f.toCityId === undefined || f.toCityId === cityId);
    if (!fromIn && !toIn) return;
    let n: number;
    if (f.quantity !== undefined && f.quantity > 0) n = Math.ceil(f.quantity / TRUCK_PAYLOAD);
    else if (f.amount !== undefined && f.amount > 0) n = Math.ceil(f.amount / 250_000);
    else n = 1;
    n = Math.min(MAX_TRIPS_PER_LINK, Math.max(1, n));
    const toRetail = toIn && isRetail(f.toBuildingId!);
    const model = truckModelFor(f.productId, toRetail);
    for (let k = 0; k < n; k++) {
      const jitter = hash3(index, k, monthSeed, 911) - 0.5;
      trips.push({
        at: Math.min(0.999, Math.max(0, (k + 0.5 + jitter * 0.6) / n)),
        kind: f.kind,
        productId: f.productId,
        from: fromIn ? f.fromBuildingId! : null,
        to: toIn ? f.toBuildingId! : null,
        model,
        key: `${index}:${k}`,
      });
    }
  });
  trips.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
  return trips;
}

/**
 * Releases trips as the visual month progresses. A new month (or new flows) restarts the schedule; trips whose
 * departure time has long passed when the schedule starts are skipped rather than released in a burst.
 */
export class TripScheduler {
  private trips: TruckTrip[] = [];
  private cursor = 0;
  private lastProgress = 0;

  /** Replace the schedule (new month of flows) starting at the current month progress. */
  reset(trips: TruckTrip[], monthProgress: number): void {
    this.trips = trips;
    this.cursor = 0;
    // catch up at most 15 % of a month (the flows arrive shortly after the month starts)
    while (this.cursor < trips.length && trips[this.cursor].at < monthProgress - 0.15) this.cursor++;
    this.lastProgress = monthProgress;
  }

  /** Trips due by `monthProgress` (wraps to a new visual month: the same flows repeat until fresh ones arrive). */
  due(monthProgress: number): TruckTrip[] {
    const out: TruckTrip[] = [];
    if (monthProgress < this.lastProgress - 0.5) this.cursor = 0;   // the visual month rolled over
    this.lastProgress = monthProgress;
    while (this.cursor < this.trips.length && this.trips[this.cursor].at <= monthProgress) out.push(this.trips[this.cursor++]);
    return out;
  }

  get pending(): number {
    return this.trips.length - this.cursor;
  }
}
