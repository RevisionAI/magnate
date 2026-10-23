// TypeScript mirror of the C# bridge protocol (engine/Magnate.Bridge, bridge-spec §5).
// Every C# DTO record has an interface here with the same camelCase shape; field
// order follows the C# positional order. Conventions (bridge-spec §4.4):
//  - money (C# decimal) is a number rounded half-even to 2 dp (4 dp for unit
//    prices/costs); quantities, shares, quality and brand are plain numbers;
//  - optional C# values are omitted when null, so every optional field is `?:`;
//  - non-finite doubles arrive as `null` (only where the type says `number | null`);
//  - dates are { year, month } with month 1–12.
// When you add a [BridgeMethod] in C#, add its entry to `Methods` below and
// regenerate the contract fixtures (MAGNATE_UPDATE_FIXTURES=1 dotnet test).

/** Protocol major version; the client refuses to run against a different one. */
export const PROTOCOL_VERSION = 1;

// ================================================================== §5.0 envelope

export interface OkEnvelope<T> {
  ok: true;
  result: T;
  revision: number;
  /** Fresh HUD; present on every successful mutating call except `advance` (its result embeds it). */
  hud?: SnapshotDto;
  /** Events produced by this command (stamped with `seq` and `month`). */
  events?: GameEventDto[];
}

export interface ErrorEnvelope {
  ok: false;
  error: BridgeError;
  revision: number;
}

export type Envelope<T> = OkEnvelope<T> | ErrorEnvelope;

export interface BridgeError {
  code: BridgeErrorCode;
  /** English fallback; render from `code` + `details` where possible. */
  message: string;
  /** The offending argument path, e.g. `price`, `at.px`, `initialSlot.productId`. */
  field?: string;
  details?: ErrorDetails;
}

export interface ErrorDetails {
  required?: number;
  available?: number;
  shortfall?: number;
  slotIndex?: number;
  capacity?: number;
  level?: number;
  maxLevel?: number;
  entityKind?: EntityKind;
  entityId?: string;
  productId?: string;
  reason?: string;
  min?: number;
  max?: number;
  missing?: string[];
  feature?: FeatureName;
  schemaVersion?: number;
  minSchemaVersion?: number;
  maxSchemaVersion?: number;
  /** Raw engine text, for bug reports only — never shown to players. */
  devMessage?: string;
}

export type EntityKind =
  | 'scenario'
  | 'city'
  | 'product'
  | 'buildingType'
  | 'building'
  | 'company'
  | 'goal'
  | 'starterPlan'
  | 'save'
  | 'strategy'
  | 'parcel'
  | 'loan';

export type BridgeErrorCode =
  | 'unknown_method'
  | 'bad_request'
  | 'no_game'
  | 'not_initialized'
  | 'not_found'
  | 'invalid_argument'
  | 'invalid_operation'
  | 'internal'
  | 'transport'
  | 'insufficient_funds'
  | 'not_owner'
  | 'slot_out_of_range'
  | 'slot_kind_unsupported'
  | 'slot_empty'
  | 'product_not_allowed'
  | 'geography_mismatch'
  | 'not_upgradeable'
  | 'max_level'
  | 'patent_not_active'
  | 'patent_self_license'
  | 'not_patent_holder'
  | 'invalid_period'
  | 'save_corrupt'
  | 'save_version_unsupported'
  | 'save_content_mismatch'
  // worker save store (bridge-spec §6.3)
  | 'save_not_found'
  | 'storage_quota'
  | 'storage_unavailable'
  | 'tick_failed'
  | 'feature_unavailable'
  | 'plot_occupied'
  | 'plot_out_of_bounds'
  | 'zoning_forbidden'
  | 'parcel_not_owned'
  | 'parcel_not_for_sale'
  | 'under_construction'
  | 'credit_limit_exceeded'
  | 'loan_not_found'
  | 'not_listed'
  | 'already_listed'
  | 'insufficient_shares'
  | 'takeover_blocked';

// ================================================================== §5.1 common types

export interface DateDto {
  year: number;
  month: number;
}

export type PeriodPreset = 'thisMonth' | 'lastMonth' | 'ytd' | 'last12' | 'sinceStart' | 'allTime';

export interface PeriodArgs {
  preset?: PeriodPreset;
  from?: DateDto;
  to?: DateDto;
}

export interface PeriodDto {
  from: DateDto;
  to: DateDto;
  months: number;
  preset: PeriodPreset | 'custom';
}

/** Dense monthly series from `start`; `null` = no data for that month. */
export interface SeriesDto {
  start: DateDto;
  values: (number | null)[];
}

export interface CompanyRefDto {
  companyId: number;
  name: string;
  color: string;
  /** 0 = player; rivals 1–7 (theme tokens own the palette). */
  colorIndex: number;
}

export interface ProductQtyDto {
  productId: string;
  quantity: number;
}

export interface IdCountDto {
  id: string;
  count: number;
}

export type Rotation = 0 | 90 | 180 | 270;

/**
 * Plot position of a building: (px, pz) is the top-left plot of the rotated footprint; (0,0) is the NW corner.
 * `source`: `engine` — a site of the city layout (every game under land rules, E3b); `auto` / `bridge` — the
 * interim grid of Classic worlds (legacy saves); `none` — an order still waiting for a site (not on the map).
 */
export interface PlacementDto {
  px: number;
  pz: number;
  rotation: Rotation;
  source: 'auto' | 'bridge' | 'engine' | 'none';
}

export interface PlotRefDto {
  px: number;
  pz: number;
  rotation?: Rotation;
}

export type SlotKind = 'production' | 'extraction' | 'retail' | 'warehouse' | 'research' | 'none';
export type ProductTier = 'raw' | 'intermediate' | 'finished';
export type AdChannelId = 'tv' | 'newspaper' | 'magazine' | 'radio';
export type Bracket = 'low' | 'middle' | 'high';
export type UiSeverity = 'info' | 'success' | 'warning' | 'danger';
export type NewsSeverity = 'info' | 'notable' | 'major';
/** @deprecated use UiSeverity (kept for code written against the skeleton). */
export type EventSeverity = UiSeverity;
/** Every engine ledger category (econ-audit §4.15), camelCase. */
export type LedgerCategoryId =
  | 'startingCapital'
  | 'constructionCost'
  | 'operatingCost'
  | 'inputPurchase'
  | 'retailRestock'
  | 'productSale'
  | 'exportSale'
  | 'shippingCost'
  | 'advertisingCost'
  | 'patentRoyaltyIncome'
  | 'patentRoyaltyExpense'
  | 'upgradeCost'
  | 'shareIssuance'
  | 'shareIssuanceFee'
  | 'shareBuyback'
  | 'dividendPaid'
  | 'loanDrawdown'
  | 'loanRepayment'
  | 'revolverDraw'
  | 'revolverRepay'
  | 'landPurchase'
  | 'constructionPayment'
  | 'equipmentPurchase'
  | 'assetSale'
  | 'liquidationProceeds'
  | 'otherMaterials'
  | 'productionEnergy'
  | 'wages'
  | 'utilities'
  | 'maintenance'
  | 'insurance'
  | 'propertyTax'
  | 'retailVariable'
  | 'corporateOverhead'
  | 'interestExpense'
  | 'distressInterest'
  | 'interestIncome'
  | 'incomeTax';
export type FeatureName =
  | 'plots'
  | 'landMarket'
  | 'constructionTime'
  | 'demolish'
  | 'loans'
  | 'stockMarket'
  | 'macro'
  | 'productionLog'
  | 'domainEvents'
  | 'demandModel';
export type AiStrategyName = 'simple' | 'adaptive' | 'verticalIntegrator' | 'techLeader';

// ================================================================== §5.3 session, scenarios, catalog, HUD

export interface InitArgs {
  contentRoot: string;
  scenarioDir?: string;
}

export interface InitResult {
  engineVersion: string;
  protocolVersion: number;
  products: number;
  buildingTypes: number;
  cities: number;
  scenarios: number;
  methods: string[];
  features: FeatureFlags;
  contentHash: string;
  saveFormatVersion: number;
  engineSchemaVersion: number;
}

export interface FeatureFlags {
  plots: boolean;
  landMarket: boolean;
  constructionTime: boolean;
  demolish: boolean;
  loans: boolean;
  stockMarket: boolean;
  macro: boolean;
  productionLog: boolean;
  domainEvents: boolean;
  demandModel: boolean;
}

export interface PingResult {
  pong: string;
  revision: number;
  hasGame: boolean;
}

export interface ScenarioSummaryDto {
  id: string;
  name: string;
  description: string;
  startDate: DateDto;
  endDate?: DateDto;
  playerName: string;
  startingCash: number;
  competitors: ScenarioCompetitorDto[];
  /** Goal descriptions (kept for the skeleton; prefer `goalDetails`). */
  goals: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  difficultyBucket: 'easy' | 'normal' | 'hard';
  durationMonths?: number;
  isSandbox: boolean;
  goalDetails: ScenarioGoalDto[];
  /** Tutorial first, then sandbox, then by difficulty, then name. */
  sortKey: number;
  /** Plain-words briefing: starting position, rivals, goals, deadline, how you lose. */
  briefing: string;
}

export interface ScenarioCompetitorDto {
  name: string;
  startingCash: number;
  strategy: AiStrategyName;
}

export type GoalKind =
  | 'corporateValue'
  | 'marketShare'
  | 'ownsBuilding'
  | 'productRetailed'
  | 'adCampaignActive'
  | 'elapsedMonths'
  | 'netIncome'
  | 'topBrand'
  | 'exportRevenue'
  | 'consecutiveProfitable'
  // E2 finance (econ-audit §4.18)
  | 'totalAssets'
  | 'netWorth'
  | 'creditRating'
  | 'loanTaken'
  | 'other';
/** `rating` goals count notches above D (`current`/`target`); the scenario text names the grade. */
export type GoalUnit = 'usd' | 'ratio' | 'count' | 'flag' | 'months' | 'points' | 'rating';
/**
 * D11: `reachOnce` goals latch the first time they are met; `holdAtDeadline` goals are judged
 * live and must be met at the deadline (company-value goals in competitive scenarios).
 */
export type GoalMode = 'reachOnce' | 'holdAtDeadline';

export interface ScenarioGoalDto {
  id: string;
  index: number;
  kind: GoalKind;
  /**
   * What `current` measures: `companyValue` (World.GetCorporateValue, D10) for corporateValue goals,
   * `totalAssets`, `bookEquity`, `ratingNotch`, `loansTaken`, `realisedShare3m` for market share, …
   */
  metric: string;
  description: string;
  target: number;
  unit: GoalUnit;
  productId?: string;
  cityId?: string;
  category?: string;
  mode: GoalMode;
}

export interface CatalogDto {
  products: ProductDto[];
  buildingTypes: BuildingTypeDto[];
  cities: CityDto[];
  adChannels: AdChannelDto[];
  constants: SimConstantsDto;
  events: EventDefDto[];
  starterPlans: StarterPlanDto[];
  contentHash: string;
}

export interface ProductDto {
  id: string;
  name: string;
  tier: ProductTier;
  category: string;
  unit: string;
  baseWorldMarketPrice: number;
  maxTechLevel: number;
  recipe?: RecipeDto;
  /** Building category that extracts this raw product. */
  extractedAt?: string;
  priceElasticity: number;
  baseDemandPerCapita: BracketValues;
  reservationPrice?: BracketValues;
  yieldPerSlotPerMonth?: number;
  outputPerSlotPerMonth?: number;
  feedsInto: string[];
  affectsRetailDemand: boolean;
}

export interface RecipeDto {
  outputQuantity: number;
  inputs: RecipeInputDto[];
  laborUnits: number;
}

export interface RecipeInputDto {
  productId: string;
  quantity: number;
  perSlotPerMonth: number;
}

export interface BracketValues {
  low?: number;
  middle?: number;
  high?: number;
}

export type BuildMenuGroup = 'retail' | 'production' | 'extraction' | 'logistics' | 'media' | 'research';

export interface BuildingTypeDto {
  id: string;
  name: string;
  category: string;
  constructionCost: number;
  monthlyOperatingCost: number;
  footprintWidth: number;
  footprintHeight: number;
  maxUnits: number;
  retail: boolean;
  producibleTiers: ProductTier[];
  maxLevel: number;
  slotKind: SlotKind;
  eligibleProductIds: string[];
  levels: LevelDto[];
  geography?: GeographyReq;
  headcount?: { min: number; max: number };
  buildMenuGroup: BuildMenuGroup;
  mediaChannel?: AdChannelId;
  mediaBonus?: number;
}

export interface LevelDto {
  level: number;
  capacity: number;
  monthlyOperatingCost: number;
  upgradeCost: number;
}

export interface GeographyReq {
  coastal?: boolean;
  arable?: boolean;
  mineralRich?: boolean;
  oilRich?: boolean;
}

export interface CityDto {
  id: string;
  name: string;
  population: number;
  gridWidth: number;
  gridHeight: number;
  coastal: boolean;
  arable: boolean;
  mineralRich: boolean;
  oilRich: boolean;
  baseLandPrice: number;
  demographics: Record<string, number>;
  /** Finished productId → potential units per month. */
  potentialDemand: Record<string, number>;
}

export interface AdChannelDto {
  id: AdChannelId;
  costPerPoint: number;
  mediaBuildingTypeId?: string;
  ownershipBonus: number;
}

export interface SimConstantsDto {
  cyclesPerSlotPerMonth: number;
  interCityShippingFraction: number;
  worldMarketQuality: number;
  extractionQuality: number;
  baseTechLevel: number;
  researchPointsPerSlotPerMonth: number;
  baseResearchThreshold: number;
  patentDurationMonths: number;
  patentRoyaltyRate: number;
  brandDecayRate: number;
  eventBaseProbabilityPerMonth: number;
  bankruptcyGraceMonths: number;
  defaultLowCashThreshold: number;
}

export interface EventDefDto {
  id: string;
  name: string;
  description: string;
  severity: NewsSeverity;
}

export interface StarterPlanDto {
  id: string;
  label: string;
  typeId: string;
  productId: string;
  price?: number;
  target?: number;
  citySelector: 'largestPopulation';
}

export interface NewGameArgs {
  scenarioId: string;
  /** Send a random 31-bit value: crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff. */
  seed?: number;
  /** Hand the player's company to an AI strategy (spectator mode). */
  autopilot?: AiStrategyName;
  companyName?: string;
  /** Required iff scenarioId === 'custom'. */
  custom?: CustomGameDto;
  /** Client clock (ISO 8601) — feeds the game id and save metadata. */
  createdAtIso?: string;
}

export interface CustomGameDto {
  startDate: DateDto;
  endDate?: DateDto;
  playerCash: number;
  competitors: ScenarioCompetitorDto[];
}

export interface SnapshotDto {
  date: DateDto;
  monthIndex: number;
  playerId: number;
  /** Every company, by id. */
  companies: CompanySummaryDto[];
  scenario?: ActiveScenarioDto;
  revision: number;
  gameId: string;
  startDate: DateDto;
  elapsedMonths: number;
  player: PlayerHudDto;
  outcome: OutcomeDto;
  alerts: AlertsDto;
  /** Index of the latest news entry (-1 when none). */
  newsSeq: number;
  /** Sequence of the latest activity-feed event. */
  feedSeq: number;
  autopilot?: AiStrategyName;
  faulted: boolean;
  /** EXT (macro). */
  macro?: MacroHudDto;
}

export interface CompanySummaryDto {
  id: number;
  name: string;
  isPlayer: boolean;
  cash: number;
  totalAssets: number;
  equity: number;
  revenueThisMonth: number;
  netIncomeThisMonth: number;
  buildingCount: number;
  color: string;
  /** Interim (MASTER-PLAN D10): equity + 10 × trailing-12-month net income, until the engine's definition lands. */
  corporateValue: number;
  netIncomeLast12: number;
  /** 0 = player; rivals 1–7. */
  colorIndex: number;
  aiStrategy?: AiStrategyName;
  /** EXT (stockMarket). */
  marketCap?: number;
  /** EXT (stockMarket). */
  sharePrice?: number;
}

export interface ActiveScenarioDto {
  id: string;
  name: string;
  endDate?: DateDto;
  goals: GoalDto[];
  monthsRemaining?: number;
  goalsAchieved: number;
  nextGoalId?: string;
}

export interface PlayerHudDto {
  companyId: number;
  name: string;
  cash: number;
  /** Σ ledger this month (all categories). */
  cashFlowThisMonth: number;
  revenueThisMonth: number;
  netIncomeThisMonth: number;
  netIncomeLast12: number;
  totalAssets: number;
  equity: number;
  corporateValue: number;
  buildings: number;
  idleBuildings: number;
  activeCampaigns: number;
  /** Months of cash at the last three months' operating burn; absent when not burning. */
  cashRunwayMonths?: number;
  /** EXT (loans). */
  creditRating?: string;
}

export type OutcomeStatus = 'playing' | 'won' | 'lost';
export type OutcomeReason = 'allGoals' | 'bankruptcy' | 'deadline' | 'insolvency';

export interface OutcomeDto {
  status: OutcomeStatus;
  reason?: OutcomeReason;
  at?: DateDto;
}

export interface AlertsDto {
  lowCash: boolean;
  negativeCashMonths: number;
  /** Months left in the insolvency cure window ("INSOLVENT IN N MONTHS"). */
  bankruptcyInMonths?: number;
  bankruptcyGraceMonths: number;
}

/** EXT (macro): HUD chip. */
export interface MacroHudDto {
  phase: string;
  interestRate: number;
}

export interface SettingsDto {
  lowCashThreshold: number;
  autosaveEveryMonths: number;
  bankruptcyGraceMonths: number;
  feedCapacity: number;
}

export interface UpdateSettingsArgs {
  lowCashThreshold?: number;
  /** 0 disables autosave. */
  autosaveEveryMonths?: number;
}

export interface AutopilotArgs {
  /** `null` turns the autopilot off (refused with invalid_operation until the engine can unregister an AI). */
  strategy: AiStrategyName | null;
}

// ================================================================== §5.4 time

export interface AdvanceArgs {
  /** 1–24. */
  months: number;
  /** Event kinds that end a multi-month batch early (skip-to-event). */
  stopOn?: GameEventKind[];
  /** Include a city view (delta when `viewSince` matches the last served revision). */
  viewCityId?: string;
  viewSince?: number;
}

export interface TickResultDto {
  months: number;
  events: GameEventDto[];
  snapshot: SnapshotDto;
  monthSummaries: MonthCloseDto[];
  playerActivity: BuildingActivityDto[];
  cityView?: CityViewDto;
  stoppedBy?: GameEventKind;
  /** The worker should autosave before answering the next request. */
  autosaveDue: boolean;
  engineMs: number;
  bridgeMs: number;
}

export interface MonthCloseDto {
  month: DateDto;
  revenue: number;
  cogs: number;
  opex: number;
  netIncome: number;
  cashStart: number;
  cashEnd: number;
  unitsSold: number;
  exportUnits: number;
}

export interface BuildingActivityDto {
  buildingId: number;
  cityId: string;
  revenue: number;
  unitsSold: number;
  exportUnits: number;
  netIncome: number;
}

// ================================================================== §7.1 events

export type GameEventKind =
  | 'monthClosed'
  | 'firstSale'
  | 'recordMonth'
  | 'buildingSales'
  | 'exportSales'
  | 'netIncomeFlip'
  | 'lossStreak'
  | 'cashLow'
  | 'lowRunway'
  | 'cashNegative'
  | 'bankruptcyWarning'
  | 'goalAchieved'
  | 'goalLost'
  | 'scenarioWon'
  | 'scenarioLost'
  | 'news'
  | 'priceEffectEnded'
  | 'buildingConstructed'
  | 'buildingUpgraded'
  | 'slotConfigured'
  | 'slotCleared'
  | 'priceChanged'
  | 'techLevelUp'
  | 'patentGranted'
  | 'patentExpired'
  | 'patentBlocked'
  | 'licenseGranted'
  | 'licenseRevoked'
  | 'revenueMilestone'
  | 'rivalEnteredMarket'
  | 'rivalUndercut'
  | 'shareRankFirst'
  | 'shareMilestone'
  | 'campaignStarted'
  | 'campaignChanged'
  | 'campaignCancelled'
  | 'brandMilestone'
  | 'brandFading'
  | 'belowCostPrice'
  | 'autosaved'
  // game feel (UX §8; the audio router's keys): cash back above zero, quarter close
  // (amount = quarter NI, newValue = revenue, reason = "Q2 2026"), #1 seller position lost
  | 'cashRecovered'
  | 'quarterClosed'
  | 'marketLeaderLost'
  // per-line operating warnings (E10). Until the engine reports demand per slot they are
  // detected from month-end stock: stockout = a retail line ended empty after selling
  // (units = sold), overstock = more than 3 months of cover (units = excess, months = cover),
  // inputShortage = a producer under 50% utilisation with an input out of stock
  | 'stockout'
  | 'overstock'
  | 'inputShortage'
  // EXT (§8) — emitted by the land, finance, equity and macro workstreams
  | 'constructionStarted'
  | 'constructionCompleted'
  | 'buildingDemolished'
  | 'landPurchased'
  | 'loanTaken'
  | 'loanRepaid'
  | 'loanDenied'
  | 'loanPaymentMissed'
  | 'creditRatingChanged'
  // E2 finance (GoalTracker): distress opened (reason default), cured, or bankrupt
  | 'insolvency'
  | 'taxPaid'
  | 'dividendPaid'
  | 'ipoEligible'
  | 'ipoCompleted'
  | 'sharePriceMove'
  | 'indexMove'
  | 'takeoverBid'
  | 'stakeAlert'
  | 'macroShift'
  | 'policyRateChanged'
  | 'companyBankrupt';

/** 0 = ambient only, 1 = feed, 2 = toast-worthy, 3 = must interrupt (VO / auto-pause candidate). */
export type EventPriority = 0 | 1 | 2 | 3;

/**
 * A game event (tick or command). Flat: which optional fields are set depends
 * on `kind` (bridge-spec §7.2). Events with priority ≥ 1 also go to the persisted
 * activity feed. Within a month the order is news, rival construction, rival moves,
 * player sales, milestones, cash, goals, outcome — and `monthClosed` last.
 */
export interface GameEventDto {
  kind: GameEventKind;
  severity: UiSeverity;
  /** English fallback text. */
  message: string;
  amount?: number;
  buildingId?: number;
  cityId?: string;
  productId?: string;
  seq: number;
  month: DateDto;
  priority: EventPriority;
  companyId?: number;
  isPlayer?: boolean;
  units?: number;
  level?: number;
  maxLevel?: number;
  typeId?: string;
  goalId?: string;
  newsSeq?: number;
  reason?: string;
  oldValue?: number;
  newValue?: number;
  threshold?: number;
  months?: number;
  placement?: PlacementDto;
}

// ================================================================== §5.5 city view, world map, flows, build preview

export interface CityViewArgs {
  cityId: string;
  /** Revision of the view you hold; a match returns only changed buildings. */
  since?: number;
}

export interface CityViewDto {
  cityId: string;
  revision: number;
  full: boolean;
  /** Full: every building in the city; delta: upserts only. */
  buildings: BuildingVisualDto[];
  /** Delta only (EXT demolish/sell). */
  removedIds: number[];
  /** Always full, columnar, aligned to `activity.ids`. */
  activity: CityActivityDto;
  /** EXT (plots). */
  layout?: CityLayoutRefDto;
}

export type BuildingStatus =
  | 'operating'
  | 'idle'
  | 'passive'
  | 'starved'
  | 'soldOut'
  | 'underConstruction'
  | 'closed'
  | 'forSale';

export interface BuildingVisualDto {
  id: number;
  typeId: string;
  category: string;
  slotKind: SlotKind;
  ownerId: number;
  isPlayer: boolean;
  color: string;
  /** 0 = player; rivals 1–7 (art §3.4). */
  colorIndex: number;
  level: number;
  /** Unrotated type footprint, in plots. */
  footprintW: number;
  footprintH: number;
  placement: PlacementDto;
  status: BuildingStatus;
  /** Distinct slot products in slot order (signage). */
  products: string[];
  /** Changes only when something visible changes — rebuild the mesh only then. */
  visualRev: number;
  /** EXT (constructionTime). */
  construction?: ConstructionDto;
}

export interface CityActivityDto {
  month: DateDto;
  ids: number[];
  revenue: number[];
  unitsSold: number[];
  exportUnits: number[];
  netIncome: number[];
  /** Producers only (v1 approximation; exact with E10): drives smoke and animation. */
  utilization: (number | null)[];
  transfersIn: number[];
  transfersOut: number[];
}

export interface WorldMapDto {
  cities: CityOverviewDto[];
}

export type CityClimate = 'temperate' | 'warm' | 'cold' | 'arid';

export interface CityOverviewDto {
  cityId: string;
  name: string;
  population: number;
  demographics: Record<string, number>;
  geography: { coastal: boolean; arable: boolean; mineralRich: boolean; oilRich: boolean };
  gridW: number;
  gridH: number;
  baseLandPrice: number;
  buildingsByOwner: { companyId: number; count: number }[];
  playerBuildings: number;
  totalBuildings: number;
  /** Mean realised unit share last month over the finished products the player retails here. */
  playerAvgShare: number;
  topDemand: ProductQtyDto[];
  /** Art §5.3 request (reserved). */
  climate?: CityClimate;
  seed?: number;
}

export interface SupplyFlowsArgs {
  cityId?: string;
  buildingId?: number;
}

export interface SupplyFlowsDto {
  month: DateDto;
  flows: FlowDto[];
}

export interface FlowDto {
  kind: 'transfer' | 'import' | 'export' | 'retail';
  productId: string;
  fromBuildingId?: number;
  toBuildingId?: number;
  fromCityId?: string;
  toCityId?: string;
  /** Exact for transfers, exports and retail; absent for imports until the engine records quantities (E11). */
  quantity?: number;
  amount?: number;
}

export interface PreviewBuildArgs {
  typeId: string;
  cityId: string;
  at?: PlotRefDto;
}

/**
 * Why a site is refused (most fundamental first). Bridge-spec codes plus the E3b site rules (caplab §5.9):
 * `water`, `needsRoad` (frontage), `needsCoast`, `needsDeposit`, `notArable`, `slope`, and `noSite` (no free
 * site in the whole city can take the type — previews without `at` only).
 */
export type PlacementIssue =
  | 'outOfBounds'
  | 'occupied'
  | 'road'
  | 'zoning'
  | 'water'
  | 'needsRoad'
  | 'needsCoast'
  | 'needsDeposit'
  | 'notArable'
  | 'slope'
  | 'noSite';

/** One failed placement rule (E3b). `px`/`pz`: the offending plot, when the rule fails at one plot. */
export interface PlacementIssueDto {
  code: PlacementIssue;
  message: string;
  px?: number;
  pz?: number;
}

/** What a site offers (E3b, caplab §5.9 step 4). */
export interface SiteDto {
  /** Mean customer-traffic index over the footprint, 0–100. */
  traffic: number;
  peakTraffic: number;
  /** econ §4.3 location factor: clamp(traffic / median urban traffic, 0.3, 2.5). */
  locationFactor: number;
  /** Footprint centre to the CBD centre, in plots. */
  distanceToCbd: number;
  /** Best adjacent road class; absent when none. */
  frontage?: LayoutRoadClass;
  district: LayoutDistrict;
  /** Steepest slope class under the footprint (0–3). */
  maxSlope: number;
  waterfront: boolean;
  /** Mean land value of the footprint plots, whole dollars. */
  landValuePerPlot: number;
  parcelIds: number[];
  depositId?: number;
  depositQuality?: number;
  depositReserve?: number;
}

export interface BuildPreviewDto {
  typeId: string;
  cityId: string;
  constructionCost: number;
  /** EXT (landMarket). */
  landCost?: number;
  totalCost: number;
  monthlyOpex: number;
  capacity: number;
  affordable: boolean;
  shortfall: number;
  cashAfter: number;
  runwayMonthsAfter?: number;
  geographyOk: boolean;
  geographyIssues: ('coastal' | 'arable' | 'mineralRich' | 'oilRich')[];
  eligibleProductIds: string[];
  footprintW: number;
  footprintH: number;
  placementOk: boolean;
  /** The first of `placementIssues`. */
  placementIssue?: PlacementIssue;
  /**
   * The site `construct` would auto-pick (best affordable, else the cheapest valid one). Under land rules it is
   * only computed when `at` is omitted (a city-wide search), so a ghost preview with `at` stays cheap.
   */
  suggestedPlacement?: PlacementDto;
  /** EXT (constructionTime): build duration in months (0 = instant). */
  constructionMonths?: number;
  /** EXT (plots). */
  catchment?: CatchmentDto;
  // ---- E3b, under engine land rules only.
  // Costs: landCost = land + buy-out of ambient buildings; totalCost = landCost + constructionCost.
  // affordable / shortfall compare `upfrontCost` with the funds available; cashAfter = cash − totalCost.
  /** Due when the order is placed: land + buy-out + deposit. */
  upfrontCost?: number;
  /** Buy-out of ambient buildings on the parcels touched (included in `landCost`). */
  redevelopmentCost?: number;
  /** Construction deposit paid at the start (the whole cost when instant). */
  deposit?: number;
  /** Each monthly instalment after the deposit (absent when instant). */
  monthlyInstalment?: number;
  /** Projected opening month if ordered now. */
  opensAt?: DateDto;
  /** Every failed rule, most fundamental first (empty when the site is valid). */
  placementIssues?: PlacementIssueDto[];
  site?: SiteDto;
}

/**
 * EXT (plots): demand and competition near a site. `score` is the location factor (0.3–2.5); for stores
 * `potentialUnitsPerMonth` is the city's potential demand for the best-selling product the store may carry
 * (`productId`) scaled by that factor — an indicator, not a forecast; `rivalsWithinRadius` counts other
 * companies' buildings of the same kind (any store, for a store) within `radiusPlots` of the footprint.
 */
export interface CatchmentDto {
  score: number;
  potentialUnitsPerMonth: number;
  rivalsWithinRadius: number;
  productId?: string;
  traffic?: number;
  radiusPlots?: number;
}

/** EXT (constructionTime). `progress` is month-granular (interpolate days with the clock). */
export interface ConstructionDto {
  started: DateDto;
  /** Projected completion (moves out while the project waits for a site or cannot fund an instalment). */
  completesAt: DateDto;
  progress: number;
  costPaid: number;
  costRemaining: number;
  monthsTotal?: number;
  monthsRemaining?: number;
  /** Due at the next month close. */
  nextInstalment?: number;
  /** A rival's order still waiting for a free, affordable site (nothing paid yet). */
  awaitingSite?: boolean;
  /** Months the works stood still for lack of funds. */
  pausedMonths?: number;
  /** Cash `cancelConstruction` would return now: the recoverable share of the works plus the site at market value. */
  cancelRefund?: number;
}

// ================================================================== §5.5 buildings

export interface BuildingsArgs {
  cityId?: string;
  ownerId?: number;
  sort?: 'id' | 'city' | 'category' | 'cashflow' | 'netIncome';
}

export interface BuildingSummaryDto {
  id: number;
  typeId: string;
  category: string;
  ownerId: number;
  cityId: string;
  level: number;
  configuredSlots: number;
  /** Level-aware slot capacity. */
  capacity: number;
  name: string;
  slotKind: SlotKind;
  status: BuildingStatus;
  products: string[];
  monthlyOpex: number;
  cashFlowThisMonth: number;
  netIncomeThisMonth: number;
  topStock: ProductQtyDto[];
  placement: PlacementDto;
  colorIndex: number;
}

export interface BuildingRefArgs {
  buildingId: number;
}

export interface BuildingDetailDto {
  id: number;
  typeId: string;
  typeName: string;
  category: string;
  slotKind: SlotKind;
  ownerId: number;
  ownerName: string;
  isPlayer: boolean;
  cityId: string;
  cityName: string;
  level: number;
  maxLevel: number;
  capacity: number;
  slotsUsed: number;
  /** −1 when every slot is configured. */
  nextFreeSlotIndex: number;
  monthlyOpex: number;
  constructionCost: number;
  /** Construction + upgrades. */
  bookValue: number;
  openedAt?: DateDto;
  autoExport: boolean;
  autoExportApplies: boolean;
  upgrade?: UpgradeOptionDto;
  workforce?: WorkforceDto;
  slots: SlotDetailDto[];
  inventory: InventoryRowDto[];
  inventoryTotals: InventoryTotalsDto;
  pnl: BuildingPnlDto;
  supply: SupplyDto;
  actions: BuildingActionsDto;
  placement: PlacementDto;
  construction?: ConstructionDto;
  /** What `bookValue` is made of (E2 asset register + E3b land). */
  book?: BookValueDto;
}

/** Carrying value of a building: gross PP&E (construction + upgrades + equipment) − depreciation + land + CIP. */
export interface BookValueDto {
  grossPpe: number;
  accumulatedDepreciation: number;
  land: number;
  constructionInProgress: number;
  upgradeCost: number;
}

export interface UpgradeOptionDto {
  toLevel: number;
  cost: number;
  capacity: number;
  monthlyOpex: number;
  affordable: boolean;
}

export interface WorkforceDto {
  perSlotMin: number;
  perSlotMax: number;
  estimatedMin: number;
  estimatedMax: number;
}

export interface SlotDetailDto {
  index: number;
  kind: SlotKind;
  productId: string;
  productName: string;
  tier: ProductTier;
  retail?: RetailSlotDto;
  warehouse?: WarehouseSlotDto;
  production?: ProductionSlotDto;
  extraction?: ExtractionSlotDto;
  research?: ResearchSlotDto;
  /** Set when configuring replaced a different product at this index. */
  replacedProductId?: string;
}

export interface RetailSlotDto {
  price: number;
  restockTarget: number;
  onHand: number;
  unitCost: number;
  effectiveWorldPrice: number;
  lastMonthUnits: number;
  lastMonthRevenue: number;
  lastMonthAvgPrice?: number;
  cheapestRivalPrice?: number;
  rivalCount: number;
  /** Model forecast for next month, not capped by stock. */
  modelDemandUnits: number;
  belowCost: boolean;
  /** E10. */
  lastMonthDemand?: number;
  /** E10. */
  lastMonthLostUnits?: number;
}

export interface WarehouseSlotDto {
  targetStock: number;
  onHand: number;
  unitCost: number;
}

export interface ProductionSlotDto {
  cyclesPerMonth: number;
  outputPerMonth: number;
  inputs: InputSupplyDto[];
  lastMonthOutput?: number;
  utilization?: number;
  unitCost?: number;
  effectiveWorldPrice: number;
  exportsAtLoss: boolean;
}

export interface InputSupplyDto {
  productId: string;
  perMonth: number;
  onHand: number;
  source: 'own' | 'ownOtherCity' | 'worldMarket';
  sourceBuildingId?: number;
  sourceCityId?: string;
  effectiveWorldPrice: number;
}

export interface ExtractionSlotDto {
  yieldPerMonth: number;
  onHand: number;
  quality: number;
}

export interface ResearchSlotDto {
  tech: number;
  maxTech: number;
  progress: number;
  threshold: number;
  companyPointsPerMonth: number;
  etaMonths?: number;
  blocked: boolean;
  patentHolderId?: number;
}

export interface InventoryRowDto {
  productId: string;
  name: string;
  tier: ProductTier;
  quantity: number;
  cost: number;
  unitCost: number;
  quality: number;
}

export interface InventoryTotalsDto {
  raw: TierTotal;
  intermediate: TierTotal;
  finished: TierTotal;
}

export interface TierTotal {
  units: number;
  cost: number;
}

export interface BuildingPnlDto {
  thisMonth: PnlWindowDto;
  last12: PnlWindowDto;
  sinceOpen: PnlWindowDto;
  monthlyNetIncome: SeriesDto;
}

export interface PnlWindowDto {
  from: DateDto;
  to: DateDto;
  revenue: number;
  cogs: number;
  grossProfit: number;
  opex: number;
  netIncome: number;
}

export interface SupplyDto {
  sources: SupplyLinkDto[];
  destinations: SupplyLinkDto[];
}

export interface SupplyLinkDto {
  kind: 'transfer' | 'marketPurchase' | 'export' | 'retailSale';
  productId: string;
  quantity?: number;
  amount?: number;
  counterpartyBuildingId?: number;
  counterpartyCityId?: string;
}

export interface BuildingActionsDto {
  canUpgrade: boolean;
  canAddSlot: boolean;
  canConfigure: boolean;
  canToggleAutoExport: boolean;
  canDemolish: boolean;
  eligibleProductIds: string[];
}

export interface ConstructArgs {
  typeId: string;
  cityId: string;
  /** Configured atomically with the construction (validated before any money moves). */
  initialSlot?: SlotConfigArgs;
  /** Player-chosen plot; omitted = auto-sited. */
  at?: PlotRefDto;
}

/** Kind-specific values: price + restockTarget for retail, targetStock for warehouses (required unless re-configuring the same product). */
export interface SlotConfigArgs {
  productId: string;
  slotIndex?: number;
  price?: number;
  restockTarget?: number;
  targetStock?: number;
}

export interface StarterPlanArgs {
  planId: string;
}

export interface ConfigureSlotArgs {
  buildingId: number;
  slotIndex: number;
  productId: string;
  price?: number;
  restockTarget?: number;
  targetStock?: number;
}

export interface SlotRefArgs {
  buildingId: number;
  slotIndex: number;
}

export interface SetRetailPriceArgs {
  buildingId: number;
  slotIndex: number;
  price: number;
}

export interface SetRestockTargetArgs {
  buildingId: number;
  slotIndex: number;
  restockTarget: number;
}

export interface SetWarehouseTargetArgs {
  buildingId: number;
  slotIndex: number;
  targetStock: number;
}

export interface SetAutoExportArgs {
  buildingId: number;
  enabled: boolean;
}

export interface UpgradeResultDto {
  buildingId: number;
  level: number;
  capacity: number;
  monthlyOpex: number;
  cost: number;
}

/**
 * EXT (demolish, E2): result or preview of a disposal. `bookValue` is everything derecognised
 * (ppe + land + constructionInProgress + inventory); `gainOrLoss = proceeds − bookValue`.
 */
export interface DisposalResultDto {
  buildingId: number;
  proceeds: number;
  bookValue: number;
  gainOrLoss: number;
  kind?: 'sale' | 'demolition' | 'liquidation';
  ppe?: number;
  land?: number;
  constructionInProgress?: number;
  inventory?: number;
}

export interface DisposalPreviewArgs {
  buildingId: number;
  /** Default `sale`. */
  kind?: 'sale' | 'demolition';
}

// ================================================================== §5.6 marketing

export interface AdCampaignArgs {
  productId: string;
  cityId: string;
  channel: AdChannelId;
  /** 0 cancels. */
  monthlyBudget: number;
}

export interface AdKeyArgs {
  productId: string;
  cityId: string;
  channel: AdChannelId;
}

export interface AdCampaignDto {
  productId: string;
  cityId: string;
  channel: AdChannelId;
  monthlyBudget: number;
  brand: number;
  mediaBonus: number;
  projectedBrand: number;
  /** False when the player sells the product nowhere in that city (a trap). */
  hasRetailPresence: boolean;
}

export interface AdCampaignsDto {
  campaigns: AdCampaignDto[];
  totalMonthlySpend: number;
  brandDecayRate: number;
}

export interface AdPreviewDto {
  currentBrand: number;
  projectedBrand: number;
  lift: number;
  costPerPoint: number;
  mediaBonus: number;
  effectiveBudget: number;
  saturation: number;
  existingBudget: number;
  hasRetailPresence: boolean;
}

export interface CancelResultDto {
  cancelled: boolean;
}

// ================================================================== §5.7 research and patents

export interface ResearchTreeDto {
  nodes: ResearchNodeDto[];
  pointsPerSlotPerMonth: number;
  baseThreshold: number;
}

export interface ResearchNodeDto {
  productId: string;
  name: string;
  tier: ProductTier;
  tech: number;
  maxTech: number;
  progress: number;
  threshold: number;
  researchingSlots: number;
  pointsPerMonth: number;
  etaMonths?: number;
  etaToMaxMonths?: number;
  blocked: boolean;
  patent?: PatentRefDto;
  bestRival?: RivalTechDto;
  inputs: string[];
  feedsInto: string[];
  /** Only finished goods' tech reaches consumers today; other research only earns patents. */
  affectsRetailDemand: boolean;
}

export interface PatentRefDto {
  holderId: number;
  mine: boolean;
  expiresAt: DateDto;
  monthsRemaining: number;
  licensedToMe: boolean;
}

export interface RivalTechDto {
  companyId: number;
  name: string;
  tech: number;
}

export interface PatentsDto {
  mine: MyPatentDto[];
  rivals: RivalPatentDto[];
  royaltyRate: number;
  durationMonths: number;
}

export interface MyPatentDto {
  productId: string;
  expiresAt: DateDto;
  monthsRemaining: number;
  licensees: CompanyRefDto[];
  candidates: CompanyRefDto[];
  royaltiesLast12: number;
}

export interface RivalPatentDto {
  holderId: number;
  holderName: string;
  productId: string;
  expiresAt: DateDto;
  monthsRemaining: number;
  licensedToMe: boolean;
  blocksMyResearch: boolean;
}

export interface LicenseArgs {
  licenseeId: number;
  productId: string;
}

// ================================================================== §5.8 finance reports

export interface CompanyPeriodArgs {
  period?: PeriodArgs;
  /** Defaults to the player; rivals allowed for incomeStatement, balanceSheet and cashFlow. */
  companyId?: number;
  byMonth?: boolean;
}

export interface IncomeStatementDto {
  period: PeriodDto;
  companyId: number;
  revenue: number;
  productSales: number;
  exportSales: number;
  royaltyIncome: number;
  cogs: number;
  grossProfit: number;
  opex: number;
  operatingCosts: number;
  advertising: number;
  royaltyExpense: number;
  netIncome: number;
  grossMargin?: number;
  netMargin?: number;
  months?: IncomeMonthDto[];
  /** EXT (finance). */
  depreciation?: number;
  interestExpense?: number;
  incomeTax?: number;
  otherIncome?: number;
}

export interface IncomeMonthDto {
  month: DateDto;
  revenue: number;
  cogs: number;
  opex: number;
  netIncome: number;
}

export interface BalanceSheetArgs {
  companyId?: number;
  drilldown?: boolean;
}

export interface BalanceSheetDto {
  asOf: DateDto;
  companyId: number;
  cash: number;
  inventoryValue: number;
  /** PP&E at net book value: construction + upgrades − accumulated depreciation (E2). */
  buildingValue: number;
  totalAssets: number;
  liabilities: number;
  equity: number;
  startingCapital: number;
  retainedEarnings: number;
  /** The engine's own building value (equal to buildingValue now that upgrades are capitalised). */
  engineBuildingValue: number;
  /** equity − (paid-in capital + Σ net income + distributions); 0 when the books close. */
  drift: number;
  booksClose: boolean;
  buildings?: BuildingValueDto[];
  inventoryByBuilding?: BuildingInventoryDto[];
  /** Finance rules only (E2): term loans and the revolving credit line. */
  liabilityLines?: LiabilityLineDto[];
  /** Finance rules only (E2): land at cost (never depreciated). */
  landValue?: number;
  /** Finance rules only (E2). */
  accumulatedDepreciation?: number;
  /** Finance rules only (E2): construction in progress. */
  cip?: number;
  /** Finance rules only (E2): PP&E at historical cost. */
  grossPpe?: number;
  /** Finance rules only (E2): term-loan principal outstanding. */
  termLoans?: number;
  /** Finance rules only (E2): revolving credit drawn. */
  revolver?: number;
}

export interface BuildingValueDto {
  buildingId: number;
  typeName: string;
  cityId: string;
  constructionCost: number;
  upgradeCost: number;
  bookValue: number;
}

export interface BuildingInventoryDto {
  buildingId: number;
  typeName: string;
  cityId: string;
  rows: InventoryRowDto[];
  total: number;
}

export interface LiabilityLineDto {
  kind: 'loan' | 'bond' | 'payable' | 'tax';
  label: string;
  amount: number;
}

export interface CashFlowDto {
  period: PeriodDto;
  companyId: number;
  beginningCash: number;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChange: number;
  endingCash: number;
  /** endingCash matches the ledger and every category was classified. */
  reconciles: boolean;
}

export interface CashFlowSection {
  lines: CashFlowLineDto[];
  net: number;
}

/**
 * One line; `category` is the spec line name (productSales, exportSales, royaltyIncome,
 * operatingCosts, advertising, inputPurchases, retailRestock, shipping, royaltyExpense,
 * construction, upgrades, equityInjections, …) or a camelCase ledger category.
 */
export interface CashFlowLineDto {
  category: string;
  amount: number;
}

export interface ProductProfitabilityDto {
  period: PeriodDto;
  rows: ProductPnlRowDto[];
}

export interface ProductPnlRowDto {
  productId: string;
  name: string;
  revenue: number;
  cogs: number;
  grossMargin: number;
  marketing: number;
  netMargin: number;
  netMarginPct?: number;
  /** COGS quantity: retail + export units. */
  unitsSold: number;
}

export interface ExportsDto {
  period: PeriodDto;
  totalRevenue: number;
  totalUnits: number;
  byProduct: ExportProductRowDto[];
  byBuilding: ExportBuildingRowDto[];
}

export interface ExportProductRowDto {
  productId: string;
  revenue: number;
  units: number;
  avgPrice?: number;
}

export interface ExportBuildingRowDto {
  buildingId: number;
  typeId: string;
  cityId: string;
  revenue: number;
  units: number;
}

export interface LedgerArgs {
  period?: PeriodArgs;
  categories?: LedgerCategoryId[];
  buildingId?: number;
  productId?: string;
  offset?: number;
  /** ≤ 500 (default 200). */
  limit?: number;
}

export interface LedgerPageDto {
  total: number;
  offset: number;
  /** Newest first. */
  rows: LedgerRowDto[];
}

export interface LedgerRowDto {
  seq: number;
  date: DateDto;
  category: LedgerCategoryId;
  amount: number;
  memo?: string;
  productId?: string;
  buildingId?: number;
}

export interface ExplainArgs {
  base?: PeriodArgs;
  compare?: PeriodArgs;
}

export interface ExplainDto {
  base: PeriodDto;
  compare: PeriodDto;
  baseNetIncome: number;
  compareNetIncome: number;
  /** Sum exactly to compareNetIncome − baseNetIncome. */
  drivers: VarianceLineDto[];
}

export interface VarianceLineDto {
  driver:
    | 'volume'
    | 'price'
    | 'unitCost'
    | 'opexExisting'
    | 'opexNewBuildings'
    | 'advertising'
    | 'exports'
    | 'royalties'
    // E2 finance: below the operating line
    | 'depreciation'
    | 'interest'
    | 'tax'
    | 'other';
  productId?: string;
  buildingId?: number;
  amount: number;
}

// ================================================================== §5.9 market intelligence

export interface MarketIntelArgs {
  cityId?: string;
  productId?: string;
  playerOnly?: boolean;
  competitorsOnly?: boolean;
  significantOnly?: boolean;
  sort?: 'share' | 'price' | 'city' | 'demand';
}

export interface MarketIntelDto {
  rows: MarketRowDto[];
}

export interface MarketRowDto {
  cityId: string;
  cityName: string;
  productId: string;
  productName: string;
  potentialDemand: number;
  retailerCount: number;
  playerPresent: boolean;
  playerPrice?: number;
  playerModelShare: number;
  /** Retail units sold last month ÷ all retail units (absent when nothing sold). */
  playerRealisedShare?: number;
  cheapestRivalPrice?: number;
  topRival?: CompanyShareDto;
  rivalCount: number;
  /**
   * Engine demand model only: the incumbent local competition's share (last month's realised
   * units when the market traded, else its model share of category demand).
   */
  incumbentShare?: number;
}

export interface CompanyShareDto {
  companyId: number;
  name: string;
  share: number;
}

export interface MarketKeyArgs {
  cityId: string;
  productId: string;
}

export interface MarketDetailDto {
  cityId: string;
  productId: string;
  potentialDemand: number;
  elasticity: number;
  baseWorldPrice: number;
  effectiveWorldPrice: number;
  brackets: BracketDemandDto[];
  retailers: RetailerRowDto[];
  playerRealisedShareHistory: SeriesDto;
  /**
   * The engine's goal share (World.GetMarketShare): under the engine model, realised trailing-3-month
   * units ÷ all units including the incumbents.
   */
  engineGoalShare: number;
  modelSource: 'bridgeReplica' | 'engine';
  /** The permanent local competition (engine demand model only, econ-audit §4.2). */
  incumbent?: IncumbentDto;
}

/** The "white slice" of a market: unmodelled local retailers that never run out of stock. */
export interface IncumbentDto {
  /** Local competition's shelf price (the city's reference price). */
  price: number;
  /** Attractiveness mass A₀ (equivalent reference-store slots). */
  mass: number;
  /** Units it would sell next month at today's offers (incl. spill). */
  modelUnits: number;
  /** Its share of category demand at today's offers; with every retailer's modelShare it sums to 1. */
  modelShare: number;
  /** Units it sold last month (absent before the first tick). */
  lastMonthUnits?: number;
}

export interface BracketDemandDto {
  bracket: Bracket;
  population: number;
  perCapita: number;
  demand: number;
  reservationPrice?: number;
  eligibleRetailers: number;
}

export interface RetailerRowDto {
  buildingId: number;
  slotIndex: number;
  ownerId: number;
  ownerName: string;
  isPlayer: boolean;
  price: number;
  quality: number;
  tech: number;
  brand: number;
  weight: number;
  modelDemandUnits: number;
  modelShare: number;
  onHand: number;
  lastMonthUnits: number;
  lastMonthRevenue: number;
  lastMonthRealisedShare: number;
  excludedBrackets: Bracket[];
}

export interface MarketOpportunitiesDto {
  enter: EnterOpportunityDto[];
  defend: DefendPressureDto[];
}

export interface EnterOpportunityDto {
  cityId: string;
  productId: string;
  potentialDemand: number;
  rivalCount: number;
  cheapestRivalPrice?: number;
  score: number;
}

export interface DefendPressureDto {
  cityId: string;
  productId: string;
  playerShare: number;
  topRivalShare: number;
  topRivalName: string;
  score: number;
}

export interface PriceSuggestionDto {
  buildingId: number;
  slotIndex: number;
  unitCost: number;
  effectiveWorldPrice: number;
  rivalMin?: number;
  rivalMedian?: number;
  ceilings: { bracket: Bracket; price: number }[];
  suggested: number;
  expectedUnitsAt: { price: number; units: number; revenue: number; grossProfit: number }[];
  modelSource: 'bridgeReplica' | 'engine';
}

// ================================================================== §5.10 news, feed, history, monthly report, stats

export interface NewsArgs {
  sinceSeq?: number;
  limit?: number;
}

export interface NewsDto {
  entries: NewsEntryDto[];
  latestSeq: number;
  activePriceEffects: PriceEffectDto[];
}

export interface NewsEntryDto {
  seq: number;
  date: DateDto;
  eventId: string;
  headline: string;
  description: string;
  severity: NewsSeverity;
  effects: EffectDto[];
}

export interface EffectDto {
  kind: 'priceMultiplier' | 'brandShift' | 'headline';
  productId?: string;
  cityId?: string;
  multiplier?: number;
  months?: number;
  delta?: number;
}

export interface PriceEffectDto {
  productId: string;
  multiplier: number;
  remainingMonths: number;
  basePrice: number;
  effectivePrice: number;
}

export interface FeedArgs {
  sinceSeq?: number;
  limit?: number;
  kinds?: GameEventKind[];
  /** Case-insensitive substring over `message`. */
  search?: string;
}

export interface FeedDto {
  /** Newest last. */
  events: GameEventDto[];
  latestSeq: number;
}

export type HistorySeries =
  | 'cash'
  | 'revenue'
  | 'netIncome'
  | 'corporateValue'
  | 'totalAssets'
  | 'equity'
  | 'inventoryValue'
  | 'buildingValue'
  | 'buildings'
  | 'topBrand'
  | 'topTech';

export interface HistoryArgs {
  series: HistorySeries[];
  /** Defaults to [player]; rivals allowed. */
  companyIds?: number[];
  from?: DateDto;
  to?: DateDto;
}

export interface HistoryDto {
  start: DateDto;
  months: number;
  companies: CompanySeriesDto[];
}

export interface CompanySeriesDto {
  companyId: number;
  series: Partial<Record<HistorySeries, (number | null)[]>>;
  /** Series that start late (legacy saves): data exists from this month. */
  missingBefore: Partial<Record<HistorySeries, DateDto>>;
}

export interface MonthlyReportArgs {
  from?: DateDto;
  to?: DateDto;
}

export interface MonthlyReportDto {
  months: MonthSummaryDto[];
}

export interface MonthSummaryDto {
  month: DateDto;
  revenue: number;
  /** Operating costs + advertising. */
  expenses: number;
  netCash: number;
  cogs: number;
  /** Royalty income + royalty expense (net). */
  royalties: number;
  netIncome: number;
  unitsSold: number;
  newBuildings: number;
  adCampaigns: number;
  cumulativeCash: number;
  cumulativeNetIncome: number;
  topBuildings: BuildingNiDto[];
  noteworthy: NoteworthyDto[];
}

export interface BuildingNiDto {
  buildingId: number;
  typeName: string;
  cityId: string;
  netIncome: number;
}

export interface NoteworthyDto {
  seq: number;
  category: LedgerCategoryId;
  productId?: string;
  amount: number;
}

export interface StatsDashboardDto {
  cash: number;
  corporateValue: number;
  totalAssets: number;
  netIncomeThisMonth: number;
  corporateValueSeries: SeriesDto;
  shareHeatmap: ShareHeatmapDto;
  rdLeaderboard: TechBoardDto[];
  brandTop: BrandBoardDto[];
  topByRevenue: BuildingMoneyDto[];
  topByOpex: BuildingMoneyDto[];
}

export interface ShareHeatmapDto {
  cityIds: string[];
  productIds: string[];
  /** share[city][product]; null where there is no market. */
  share: (number | null)[][];
}

export interface TechBoardDto {
  productId: string;
  maxTech: number;
  rows: CompanyValueDto[];
}

export interface BrandBoardDto {
  productId: string;
  rows: BrandRowDto[];
}

export interface BrandRowDto {
  companyId: number;
  cityId: string;
  brand: number;
}

export interface CompanyValueDto {
  companyId: number;
  value: number;
}

export interface BuildingMoneyDto {
  buildingId: number;
  typeId: string;
  cityId: string;
  amount: number;
}

// ================================================================== §5.11 goals, outcome, advisor

export interface GoalDto {
  /** Full text (always present today; may be omitted in HUD goals in a later release — join on `id`). */
  description?: string;
  /** Met right now. */
  achieved: boolean;
  progress: number;
  detail?: string;
  id: string;
  index: number;
  kind: GoalKind;
  metric: string;
  current: number;
  target: number;
  unit: GoalUnit;
  /** The latch (D11): first month the goal was met. */
  achievedAt?: DateDto;
  productId?: string;
  cityId?: string;
  category?: string;
  mode: GoalMode;
}

export interface GoalsDto {
  goals: GoalDto[];
  outcome: OutcomeDto;
  deadline?: DateDto;
  monthsRemaining?: number;
  nextGoalId?: string;
}

export type AdvisorCode =
  | 'firstRevenue'
  | 'activateIdle'
  | 'needRetail'
  | 'restoreProfit'
  | 'buildBrand'
  | 'addResearch'
  | 'scale'
  | 'lowRunway'
  // the cure window is open: params.monthsLeft (month closes before bankruptcy), params.cash
  | 'insolvency'
  | 'sellingBelowCost'
  | 'exportingAtLoss'
  | 'unsellableRetail'
  | 'rivalPatentBlocksYou'
  | 'adsWithoutStore'
  | 'idleBuilding'
  | 'losingBuilding'
  | 'rivalUndercut'
  | 'unservedOpportunity'
  | 'patentLeverage'
  | 'techGap';

export interface AdvisorDto {
  priority: AdvisorItemDto;
  /** Ranked: severity, then $/month impact. */
  hints: AdvisorItemDto[];
}

export interface AdvisorItemDto {
  code: AdvisorCode;
  severity: UiSeverity;
  /** English fallback; localise from code + params. */
  message: string;
  params: Record<string, string>;
  buildingIds?: number[];
  cityId?: string;
  productId?: string;
  /** Estimated $/month at stake. */
  impactPerMonth?: number;
  /** One-click fix: call `method` with `argsJson`. */
  fix?: AdvisorFixDto;
}

export interface AdvisorFixDto {
  method: MethodName;
  argsJson: string;
  label: string;
}

// ================================================================== §5.12 persistence, §5.13 dev

export interface LoadGameArgs {
  /** A web save envelope (JSON) or a legacy engine save (schema v1–v9). */
  data: string;
}

export interface SaveArgs {
  slotKind?: 'manual' | 'autosave' | 'quicksave';
  label?: string;
  createdAtIso?: string;
  /**
   * The client's own presentation state as a JSON document (≤ 2 MB UTF-8; the worker store
   * uses `ClientSaveDoc`). Opaque to the bridge: it is stored in the save envelope
   * (`"client"`) so exported files round-trip it, and returned by `InspectSave`.
   */
  client?: string;
}

export interface SaveGameResult {
  /** The web save envelope (dev/tests; the browser uses the binary path). */
  data: string;
  schemaVersion: number;
  scenarioId?: string;
  scenarioName?: string;
  companyName: string;
  date: DateDto;
  cash: number;
  meta?: SaveMetaDto;
}

export interface LoadArgs {
  expectedGameId?: string;
  /**
   * The bytes come from this browser's own save store (written by the bridge, or imported after
   * `InspectSave` checked them): skip the content-id scan when the save's content hash is the
   * installed one. Never set it for files from outside.
   */
  trustContent?: boolean;
}

export interface SaveMetaDto {
  formatVersion: number;
  engineSchemaVersion: number;
  gameId: string;
  scenarioId?: string;
  scenarioName?: string;
  companyName: string;
  date: DateDto;
  elapsedMonths: number;
  cash: number;
  startingCapital: number;
  corporateValue: number;
  buildingsByCategory: IdCountDto[];
  topProducts: { productId: string; revenue: number }[];
  goalsAchieved: number;
  goalsTotal: number;
  outcomeStatus: OutcomeStatus;
  contentHash: string;
  label?: string;
  slotKind: 'manual' | 'autosave' | 'quicksave';
  createdAtIso?: string;
  rawBytes: number;
  compressedBytes: number;
}

export interface InspectResultDto {
  meta: SaveMetaDto;
  loadable: boolean;
  problem?: BridgeErrorCode;
  /** The `SaveArgs.client` document stored with the save (absent for legacy saves). */
  client?: string;
  /** Written against different content files (not fatal: content ids decide loadability). */
  contentChanged: boolean;
}

export interface EngineJsonDto {
  json: string;
}

export interface DebugStatsDto {
  ledgerEntries: number;
  cogsEntries: number;
  transferEntries: number;
  buildings: number;
  companies: number;
  lastTickMs: number;
  lastBridgeMs: number;
  indexCatchUpMs: number;
  revision: number;
  faulted: boolean;
  protocolVersion: string;
  /** Facade time per phase of the last `advance` (index, history, events, goals, snapshot, …). */
  lastAdvancePhasesMs?: Record<string, number>;
  /** Wall time per phase of the last binary save: engine, meta, sidecar, envelope, gzip. */
  lastSavePhasesMs?: Record<string, number>;
  /** Wall time per phase of the last load: gunzip, scan, engine, sidecar, install, backfill (legacy), snapshot. */
  lastLoadPhasesMs?: Record<string, number>;
}

// ================================================================== §8 extension points (EXT)

// §8.1 City layout — generated by the city-generator workstream (E3a, GameSession.CityLayout.cs) with the
// art-rendering §5.3 additive requests (terrain, water kind/shore, extended ambient kinds, climate, seed); live
// in a game under land rules (E3b): parcel owners/buildings/listings, cleared ambient development and the
// monthly land-value / traffic fields change with `layoutRev`. Field order mirrors the C# record.

export interface CityLayoutArgs {
  cityId: string;
  /** Preview seed, honoured only without a game in progress (a game uses its own layout seed). */
  seed?: number;
}

export interface CityLayoutDto {
  cityId: string;
  /**
   * 1 when generated; bumps when a building takes or leaves a site, land is bought or sold, or the monthly
   * land-value / traffic recompute changes the fields. Cache by gameId + cityId + layoutRev; `cityView.layout`
   * carries the current value.
   */
  layoutRev: number;
  gridW: number;
  gridH: number;
  roads: RoadDto[];
  parcels: ParcelDto[];
  water: WaterRectDto[];
  /** One entry per developed parcel; parcels whose structure was bought out, or under a company building, have none. */
  ambient: AmbientDto[];
  /** Generator seed for this city (the game's layout seed). */
  seed: number;
  climate: CityClimate;
  /** (gridW+1)·(gridH+1) corner heights in metres, row-major from the NW corner (hilly cities only). */
  terrain?: { heights: number[] };
  plots: LayoutPlotsDto;
  landmarks: LayoutLandmarkDto[];
  deposits: LayoutDepositDto[];
  /** CBD centre in plot space (plot centres sit at +0.5). */
  cbd: { x: number; z: number };
  /** Urban radius R_u in plots. */
  urbanRadius: number;
  /** Median urban traffic: the denominator of the location factor. */
  medianTraffic: number;
  generatorVersion: number;
  /** City id, or `generic` for modded cities. */
  profile: string;
  /** Plot edge in metres (24). */
  plotSize: number;
}

/**
 * Per-plot data, row-major (`i = pz·gridW + px`). Strings carry one character per plot:
 * - `kinds`: `p` parcel, `r` road, `b` bridge, `s` sea, `v` river, `l` lake, `h` beach, `o` open land;
 * - `roads`: `0` none, `1` local, `2` collector, `3` arterial, `4` highway;
 * - `districts`: `.` none, `C` CBD, `c` commercial, `m` mixed, `a` apartments, `h` houses, `i` industrial,
 *   `p` port, `g` rural, `k` park, `v` civic;
 * - `slopes`: slope class `0`–`3` (hilly cities only).
 */
export interface LayoutPlotsDto {
  kinds: string;
  roads: string;
  districts: string;
  /** Whole dollars per plot (0 on roads, water and beaches); live under land rules. */
  landValue: number[];
  /** Customer-traffic index 0–100, one decimal; live under land rules. */
  traffic: number[];
  slopes?: string;
}

export type LandmarkKind =
  | 'cityHall'
  | 'stockExchange'
  | 'bank'
  | 'investmentBank'
  | 'port'
  | 'university'
  | 'stadium'
  | 'hospital'
  | 'centralPark';

export interface LayoutLandmarkDto {
  kind: LandmarkKind;
  parcelId: number;
  px: number;
  pz: number;
  w: number;
  h: number;
}

export interface LayoutDepositDto {
  id: number;
  resource: 'iron' | 'oil';
  px: number;
  pz: number;
  w: number;
  h: number;
  /** 35–85. */
  quality: number;
  /** Recoverable reserve (tonnes of ore or barrels of crude). */
  reserve: number;
  /** Offshore fields are visual only (rigs). */
  offshore: boolean;
}

export interface CityLayoutRefDto {
  layoutRev: number;
}

export type RoadKind = 'highway' | 'arterial' | 'street';
export type LayoutRoadClass = 'local' | 'collector' | 'arterial' | 'highway';
export type LayoutDistrict =
  | 'cbd'
  | 'commercial'
  | 'mixed'
  | 'apartments'
  | 'houses'
  | 'industrial'
  | 'port'
  | 'rural'
  | 'park'
  | 'civic';

/** A plot on a road path (no rotation). */
export interface LayoutPlotDto {
  px: number;
  pz: number;
}

/** A straight segment; segments overlap at intersections and every road plot is listed. */
export interface RoadDto {
  id: number;
  kind: RoadKind;
  /** Every plot of the segment, from the west or north end. */
  path: LayoutPlotDto[];
  lanes: number;
  /** `street` splits into `local` and `collector`. */
  roadClass: LayoutRoadClass;
  /** True when the segment crosses water. */
  bridge?: boolean;
}

export type ZoneKind = 'residential' | 'commercial' | 'industrial' | 'agricultural' | 'port' | 'park' | 'civic';

export interface ParcelDto {
  id: number;
  px: number;
  pz: number;
  w: number;
  h: number;
  zone: ZoneKind;
  /** Mean land value per plot, whole dollars (current under land rules). */
  landValuePerPlot: number;
  /** The company holding the land (built on or held). */
  ownerId?: number;
  /** A company building on the parcel. */
  buildingId?: number;
  /** Listed on the land market: a vacant lot, rural land or a cleared lot, entirely free. */
  forSale: boolean;
  /** Price of the whole parcel when listed, whole dollars. */
  askingPrice?: number;
  /** Mean customer-traffic index 0–100 (drives store catchment). */
  traffic: number;
  district: LayoutDistrict;
  /** Street-facing side, art §3.2 order: 0 S, 1 E, 2 N, 3 W (seaport land faces the water). */
  facing: 0 | 1 | 2 | 3;
  frontage?: LayoutRoadClass;
  /** No structure stands on it (building needs no buy-out). */
  vacant: boolean;
  depositId?: number;
  landmark?: LandmarkKind;
}

export interface WaterRectDto {
  px: number;
  pz: number;
  w: number;
  h: number;
  kind?: 'sea' | 'river' | 'lake';
  shore?: 'beach' | 'quay';
}

export type CivicKind =
  | 'hall'
  | 'exchange'
  | 'bank'
  | 'school'
  | 'hospital'
  | 'police'
  | 'fire'
  | 'university'
  | 'stadium'
  | 'church'
  | 'port';

/** Unknown kinds fall back to `house` (built) or `park` (open). */
export type AmbientKind =
  | 'house'
  | 'apartment'
  | 'office'
  | 'shop'
  | 'park'
  | 'field'
  | 'rowhouse'
  | 'villa'
  | 'midrise'
  | 'strip_mall'
  | `civic:${CivicKind}`
  | 'forest'
  | 'orchard'
  | 'vineyard'
  | 'pasture'
  | 'scrub'
  | 'plaza'
  | 'parking'
  | 'factory'
  | 'warehouse'
  | 'tank_farm'
  | `deposit:${string}`;

export interface AmbientDto {
  parcelId: number;
  kind: AmbientKind;
  floors: number;
  variant: number;
}

// §8.2 land market (E3b; games under land rules — a Classic world answers feature_unavailable)
export interface ParcelsArgs {
  cityId: string;
  /** `forSale` (listed), `owned` (the player's: held or built on), `vacant` (no structure); omitted = all. */
  filter?: 'all' | 'forSale' | 'owned' | 'vacant';
}

export interface ParcelRefArgs {
  cityId: string;
  parcelId: number;
}

// §8.4 loans and credit (E2 finance, econ-audit §4.10/§4.14). Rates are decimal fractions (0.072 = 7.2 %).
export type SolvencyId = 'solvent' | 'distress' | 'bankrupt';

export interface CreditProfileDto {
  /** Reported rating ("NR" while unrated — younger than 12 months). */
  rating: string;
  /** Total debt lenders will carry. */
  creditLimit: number;
  /** Term loans + revolver. */
  outstanding: number;
  /** Weighted annual rate on the debt outstanding (the revolver rate when there is none). */
  interestRate: number;
  /** Debt ÷ book equity; absent when equity ≤ 0 with debt outstanding. */
  debtToEquity?: number;
  /** EBIT ÷ interest, trailing 12 months; absent without interest expense. */
  interestCoverage?: number;
  nextReview: DateDto;
  /** The grade loans are priced at (BBB/BB for unrated companies). */
  pricingRating: string;
  seasoned: boolean;
  termDebt: number;
  revolverDrawn: number;
  revolverLimit: number;
  revolverRate: number;
  /** Largest new term loan available now (0 while in distress). */
  newLoanMax: number;
  minTermMonths: number;
  maxTermMonths: number;
  policyRate: number;
  ebitdaTtm: number;
  /** Scheduled term-loan payments due next month. */
  nextPayment: number;
  solvency: SolvencyId;
  taxRate: number;
  lossCarryForward: number;
  taxPaidYtd: number;
  bookEquity: number;
  /** World.GetCorporateValue (D10). */
  companyValue: number;
  netDebtToEbitda?: number;
  lastReview?: DateDto;
  /** In distress: month closes left to cure before bankruptcy. */
  cureMonthsLeft?: number;
}

export interface LoanOffersArgs {
  /** Defaults to the largest loan available; capped at it. */
  amount?: number;
}

export interface LoanOfferDto {
  /** `"<term>m-<cents>"`, accepted by takeLoan. */
  offerId: string;
  amount: number;
  termMonths: number;
  annualRate: number;
  monthlyPayment: number;
  rating: string;
  totalInterest: number;
}

export interface LoanDto {
  loanId: number;
  principal: number;
  outstanding: number;
  annualRate: number;
  termMonths: number;
  monthsRemaining: number;
  monthlyPayment: number;
  taken: DateDto;
  inDefault: boolean;
  missedPayments: number;
}

export interface TakeLoanArgs {
  offerId?: string;
  amount?: number;
  termMonths?: number;
}

export interface RepayLoanArgs {
  loanId: number;
  amount: number;
}

// §8.5 stock market
export interface StockQuoteDto {
  companyId: number;
  ticker: string;
  listed: boolean;
  sharePrice: number;
  sharesOutstanding: number;
  marketCap: number;
  pe?: number;
  dividendYield: number;
  changePctMonth: number;
  priceHistory: SeriesDto;
}

export interface HolderDto {
  companyId?: number;
  name: string;
  shares: number;
  pct: number;
}

export interface HoldingsArgs {
  companyId?: number;
}

export interface IpoArgs {
  shares: number;
  price: number;
}

export interface BuybackArgs {
  shares: number;
}

export interface TradeSharesArgs {
  companyId: number;
  shares: number;
  side: 'buy' | 'sell';
}

export interface DividendArgs {
  perShareQuarterly: number;
}

// §8.6 macro economy
export interface MacroDto {
  gdpIndex: number;
  inflation: number;
  interestRate: number;
  unemployment: number;
  phase: 'expansion' | 'peak' | 'recession' | 'recovery';
  cities: CityMacroDto[];
  gdpHistory: SeriesDto;
}

export interface CityMacroDto {
  cityId: string;
  population: number;
  incomeIndex: number;
  landPriceIndex: number;
  growthRate: number;
}

// ================================================================== §5.14 method map

type NoArgs = Record<never, never>;

/** Every bridge method: its args and result types. Keep in sync with the C# [BridgeMethod]s. */
export interface Methods {
  init: { args: InitArgs; result: InitResult };
  ping: { args: NoArgs; result: PingResult };
  listScenarios: { args: NoArgs; result: ScenarioSummaryDto[] };
  catalog: { args: NoArgs; result: CatalogDto };
  newGame: { args: NewGameArgs; result: SnapshotDto };
  snapshot: { args: NoArgs; result: SnapshotDto };
  companies: { args: NoArgs; result: CompanySummaryDto[] };
  settings: { args: NoArgs; result: SettingsDto };
  updateSettings: { args: UpdateSettingsArgs; result: SettingsDto };
  setAutopilot: { args: AutopilotArgs; result: SnapshotDto };
  advance: { args: AdvanceArgs; result: TickResultDto };
  cityView: { args: CityViewArgs; result: CityViewDto };
  worldMap: { args: NoArgs; result: WorldMapDto };
  buildings: { args: BuildingsArgs; result: BuildingSummaryDto[] };
  building: { args: BuildingRefArgs; result: BuildingDetailDto };
  supplyFlows: { args: SupplyFlowsArgs; result: SupplyFlowsDto };
  previewBuild: { args: PreviewBuildArgs; result: BuildPreviewDto };
  construct: { args: ConstructArgs; result: BuildingSummaryDto };
  buildStarterPlan: { args: StarterPlanArgs; result: BuildingSummaryDto };
  configureSlot: { args: ConfigureSlotArgs; result: SlotDetailDto };
  clearSlot: { args: SlotRefArgs; result: BuildingSummaryDto };
  setRetailPrice: { args: SetRetailPriceArgs; result: SlotDetailDto };
  setRestockTarget: { args: SetRestockTargetArgs; result: SlotDetailDto };
  setWarehouseTarget: { args: SetWarehouseTargetArgs; result: SlotDetailDto };
  setAutoExport: { args: SetAutoExportArgs; result: BuildingSummaryDto };
  upgradeBuilding: { args: BuildingRefArgs; result: UpgradeResultDto };
  demolishBuilding: { args: BuildingRefArgs; result: DisposalResultDto }; // EXT demolish (E2)
  sellBuilding: { args: BuildingRefArgs; result: DisposalResultDto }; // EXT demolish (E2)
  previewDisposal: { args: DisposalPreviewArgs; result: DisposalResultDto }; // EXT demolish (E2)
  adCampaigns: { args: NoArgs; result: AdCampaignsDto };
  previewAdCampaign: { args: AdCampaignArgs; result: AdPreviewDto };
  setAdCampaign: { args: AdCampaignArgs; result: AdCampaignDto };
  cancelAdCampaign: { args: AdKeyArgs; result: CancelResultDto };
  researchTree: { args: NoArgs; result: ResearchTreeDto };
  patents: { args: NoArgs; result: PatentsDto };
  grantLicense: { args: LicenseArgs; result: PatentsDto };
  revokeLicense: { args: LicenseArgs; result: PatentsDto };
  incomeStatement: { args: CompanyPeriodArgs; result: IncomeStatementDto };
  balanceSheet: { args: BalanceSheetArgs; result: BalanceSheetDto };
  cashFlow: { args: CompanyPeriodArgs; result: CashFlowDto };
  productProfitability: { args: CompanyPeriodArgs; result: ProductProfitabilityDto };
  exports: { args: CompanyPeriodArgs; result: ExportsDto };
  ledger: { args: LedgerArgs; result: LedgerPageDto };
  explainNetIncome: { args: ExplainArgs; result: ExplainDto };
  marketIntel: { args: MarketIntelArgs; result: MarketIntelDto };
  marketDetail: { args: MarketKeyArgs; result: MarketDetailDto };
  marketOpportunities: { args: NoArgs; result: MarketOpportunitiesDto };
  suggestPrice: { args: SlotRefArgs; result: PriceSuggestionDto };
  goals: { args: NoArgs; result: GoalsDto };
  advisor: { args: NoArgs; result: AdvisorDto };
  history: { args: HistoryArgs; result: HistoryDto };
  monthlyReport: { args: MonthlyReportArgs; result: MonthlyReportDto };
  statsDashboard: { args: NoArgs; result: StatsDashboardDto };
  news: { args: NewsArgs; result: NewsDto };
  activityFeed: { args: FeedArgs; result: FeedDto };
  saveGame: { args: NoArgs | SaveArgs; result: SaveGameResult }; // dev/tests
  loadGame: { args: LoadGameArgs; result: SnapshotDto };
  exportEngineJson: { args: NoArgs; result: EngineJsonDto }; // dev
  debugStats: { args: NoArgs; result: DebugStatsDto };
  // EXT (§8): registered from day one; `feature_unavailable` until their flag is on.
  cityLayout: { args: CityLayoutArgs; result: CityLayoutDto };
  parcels: { args: ParcelsArgs; result: ParcelDto[] };
  buyLand: { args: ParcelRefArgs; result: ParcelDto };
  sellLand: { args: ParcelRefArgs; result: ParcelDto };
  cancelConstruction: { args: BuildingRefArgs; result: DisposalResultDto };
  creditProfile: { args: NoArgs; result: CreditProfileDto };
  loanOffers: { args: LoanOffersArgs; result: LoanOfferDto[] };
  loans: { args: NoArgs; result: LoanDto[] };
  takeLoan: { args: TakeLoanArgs; result: LoanDto };
  repayLoan: { args: RepayLoanArgs; result: LoanDto };
  stockMarket: { args: NoArgs; result: StockQuoteDto[] };
  holdings: { args: HoldingsArgs; result: HolderDto[] };
  ipo: { args: IpoArgs; result: StockQuoteDto };
  issueShares: { args: IpoArgs; result: StockQuoteDto };
  buybackShares: { args: BuybackArgs; result: StockQuoteDto };
  tradeShares: { args: TradeSharesArgs; result: HolderDto[] };
  setDividend: { args: DividendArgs; result: StockQuoteDto };
  macro: { args: NoArgs; result: MacroDto };
}

export type MethodName = keyof Methods;
export type MethodArgs<M extends MethodName> = Methods[M]['args'];
export type MethodResult<M extends MethodName> = Methods[M]['result'];

/**
 * Methods that change game state: they bump `revision` and their envelope carries
 * `hud` (except `advance`, whose result embeds the snapshot) and `events`.
 * Everything else is a pure query (safe to cache per revision and to coalesce).
 */
export const MUTATING_METHODS: ReadonlySet<MethodName> = new Set<MethodName>([
  'init',
  'newGame',
  'updateSettings',
  'setAutopilot',
  'advance',
  'construct',
  'buildStarterPlan',
  'configureSlot',
  'clearSlot',
  'setRetailPrice',
  'setRestockTarget',
  'setWarehouseTarget',
  'setAutoExport',
  'upgradeBuilding',
  'demolishBuilding',
  'sellBuilding',
  'setAdCampaign',
  'cancelAdCampaign',
  'grantLicense',
  'revokeLicense',
  'loadGame',
  'buyLand',
  'sellLand',
  'cancelConstruction',
  'takeLoan',
  'repayLoan',
  'ipo',
  'issueShares',
  'buybackShares',
  'tradeShares',
  'setDividend',
]);

/** Queries whose result for a closed period never changes (cache by gameId + method + argsJson). */
export const CLOSED_PERIOD_METHODS: ReadonlySet<MethodName> = new Set<MethodName>([
  'incomeStatement',
  'cashFlow',
  'productProfitability',
  'exports',
  'monthlyReport',
  'explainNetIncome',
]);
