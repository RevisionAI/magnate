// Quality knobs for headless tests: the LOW tier's base knobs (what the UHD 630 runs).
import { TIER_SETTINGS, baseKnobs, type QualityKnobs } from '../../core/Quality';

export const DEFAULT_QUALITY_KNOBS_FOR_TESTS: QualityKnobs = baseKnobs(TIER_SETTINGS.low);
