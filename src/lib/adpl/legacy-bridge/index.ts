export { convertLegacyHooks } from './hook-converter';
export type { ConvertResult, LegacyHookConfig, LegacyHookEntry } from './hook-converter';
export { mapEventToPlacement } from './phase-mapper';
export type { PhysicalPlacement } from './phase-mapper';
export { buildLegacyEquivalentPipeline, serializeToYaml } from './yaml-generator';
export type { LegacyEquivalentOptions } from './yaml-generator';
export { ensureDefaultPipelineVersion } from './auto-ensure';
