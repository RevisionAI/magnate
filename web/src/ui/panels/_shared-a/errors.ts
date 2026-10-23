// Player-facing text for bridge errors, rendered from the typed `code` +
// `details` (bridge-spec §4.7) rather than the engine's English fallback.

import type { BridgeErrorCode, ErrorDetails } from '@/bridge/protocol';
import { money } from '@/util/format';

export interface ErrorLike {
  code?: BridgeErrorCode | string;
  message?: string;
  details?: ErrorDetails;
}

const GEOGRAPHY: Record<string, string> = {
  coastal: 'a coastal city',
  arable: 'farmland',
  mineralRich: 'mineral deposits',
  oilRich: 'oil fields',
};

const FEATURE: Record<string, string> = {
  plots: 'Choosing plots',
  landMarket: 'Buying land',
  constructionTime: 'Construction progress',
  demolish: 'Selling and demolishing buildings',
  loans: 'Bank loans',
  stockMarket: 'The stock market',
  macro: 'The economy panel',
};

export function friendlyError(error: ErrorLike): string {
  const d = error.details ?? {};
  switch (error.code) {
    case 'insufficient_funds':
      if (d.shortfall !== undefined) return `Not enough cash: you are ${money(d.shortfall)} short${d.available !== undefined ? ` (you have ${money(d.available)})` : ''}.`;
      return 'Not enough cash for that.';
    case 'geography_mismatch':
      return `This building needs ${GEOGRAPHY[d.reason ?? ''] ?? 'different geography'}; pick another city.`;
    case 'feature_unavailable':
      return `${FEATURE[d.feature ?? ''] ?? 'That feature'} is not available in this version yet.`;
    case 'max_level':
      return 'This building is already at its top level.';
    case 'not_upgradeable':
      return 'This building type cannot be upgraded.';
    case 'slot_out_of_range':
      return d.capacity !== undefined ? `That unit is locked: the building has ${d.capacity} units at this level.` : 'That unit is locked at this level.';
    case 'slot_empty':
      return 'That unit is empty.';
    case 'product_not_allowed':
      return d.reason === 'notFinished' ? 'Stores can only sell finished consumer goods.' : 'This building cannot handle that product.';
    case 'plot_occupied':
      return 'That plot is already taken.';
    case 'plot_out_of_bounds':
      return 'That spot is outside the city.';
    case 'zoning_forbidden':
      return 'The zoning there does not allow this building.';
    case 'under_construction':
      return 'Wait until construction finishes.';
    case 'not_owner':
      return 'You do not own that building.';
    case 'invalid_argument':
      if (d.min !== undefined && d.max !== undefined) return `Enter a value between ${d.min} and ${d.max}.`;
      return error.message ?? 'That value is not valid.';
    default:
      return error.message ?? 'Something went wrong.';
  }
}
