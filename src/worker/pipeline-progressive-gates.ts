/**
 * I2: Progressive Verification Gates
 *
 * Organizes verification steps into tiers with early termination.
 * Lower tiers must pass before higher tiers are attempted.
 *
 * Tier 1 (Critical):    build_check — compilation must succeed
 * Tier 2 (Functional):  file_check, cli_output_check — outputs must exist
 * Tier 3 (Integration): port_check, http_check, dom_check — runtime behavior
 * Tier 4 (Quality):     vlm_check, desktop_check, visual_regression — UX quality
 */

export type GateTier = 1 | 2 | 3 | 4;

const TIER_MAP: Record<string, GateTier> = {
  build_check: 1,
  file_check: 2,
  cli_output_check: 2,
  port_check: 3,
  http_check: 3,
  dom_check: 3,
  vlm_check: 4,
  desktop_check: 4,
  visual_regression: 4,
};

const TIER_NAMES: Record<GateTier, string> = {
  1: 'Critical (Build)',
  2: 'Functional (Files)',
  3: 'Integration (Runtime)',
  4: 'Quality (Visual)',
};

/**
 * Organize verification steps into progressive tiers.
 */
export function organizeIntoGates(steps: Array<{ type: string; [k: string]: any }>): Map<GateTier, typeof steps> {
  const gates = new Map<GateTier, typeof steps>();

  for (const step of steps) {
    const tier = TIER_MAP[step.type] ?? 2;
    if (!gates.has(tier)) gates.set(tier, []);
    gates.get(tier)!.push(step);
  }

  return gates;
}

/**
 * Get display name for a tier.
 */
export function getTierName(tier: GateTier): string {
  return TIER_NAMES[tier] ?? `Tier ${tier}`;
}

/**
 * Get sorted tier numbers from a gate map.
 */
export function getSortedTiers(gates: Map<GateTier, any[]>): GateTier[] {
  return [...gates.keys()].sort((a, b) => a - b);
}

/**
 * Check if all results in a tier passed (pass or skip).
 */
export function tierPassed(results: Array<{ status: string }>): boolean {
  return results.every(r => r.status === 'pass' || r.status === 'skip');
}

/**
 * Filter steps to only include those up to maxTier.
 * Used when progressive mode wants to skip expensive later checks.
 */
export function filterByMaxTier(
  steps: Array<{ type: string; [k: string]: any }>,
  maxTier: GateTier,
): typeof steps {
  return steps.filter(step => {
    const tier = TIER_MAP[step.type] ?? 2;
    return tier <= maxTier;
  });
}
