import { cosmiconfig } from 'cosmiconfig';
import { z } from 'zod';

const AutoDevConfigSchema = z.object({
  defaultAgent: z.string().optional(),
  maxRetries: z.number().min(1).max(10).default(3),
  maxBudgetUsd: z.number().positive().optional(),
  screenshotOnEveryStep: z.boolean().default(false),
  verification: z.object({
    enabled: z.boolean().default(true),
    vlmProvider: z.string().optional(),
  }).optional(),
  agents: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
}).strict();

export type AutoDevConfig = z.infer<typeof AutoDevConfigSchema>;

const explorer = cosmiconfig('autodev', {
  searchPlaces: [
    '.autodev.yaml',
    '.autodev.yml',
    '.autodev.json',
    'autodev.config.ts',
    'autodev.config.js',
  ],
});

let cachedConfig: AutoDevConfig | null = null;

export async function loadConfig(searchFrom?: string): Promise<AutoDevConfig> {
  if (cachedConfig) return cachedConfig;

  const result = await explorer.search(searchFrom);

  if (!result || result.isEmpty) {
    cachedConfig = AutoDevConfigSchema.parse({});
    return cachedConfig;
  }

  cachedConfig = AutoDevConfigSchema.parse(result.config);
  return cachedConfig;
}

export function clearConfigCache(): void {
  cachedConfig = null;
}
