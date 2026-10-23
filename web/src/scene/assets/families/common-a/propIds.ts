// Instanced prop family ids used in `AssetOutput.props` by the W3 factories. Each id has a geometry builder in
// `families/props` (PROP_FAMILIES); the chunk manager groups instances by id into partitioned InstancedMeshes.
export const PROP_IDS = [
  'tree.deciduous',
  'tree.conifer',
  'tree.poplar',
  'tree.palm',
  'tree.bare',
  'lamp.street',
  'lamp.path',
  'signal.traffic',
  'bench',
  'busShelter',
  'billboard',
  'hedge',
  'fence',
  'car.parked',
  'car.police',
  'truck.fire',
  'ambulance',
  'van',
  'paperRolls',
] as const;

export type PropId = (typeof PROP_IDS)[number];
