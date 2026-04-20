import { nanoid } from 'nanoid';
import { parseYaml } from './yaml-parser';
import { extractFlat } from './flat-extractor';
import { resolveReferences } from './ref-resolver';
import { buildAdjacency } from './adjacency';
import { detectCycle } from './cycle-detector';
import { CompileCache } from './cache';
import type { CompileResult, CompiledNode, ExecutionPlan, CompiledContext, CompileError } from './types';

export { CompileCache } from './cache';
export type {
  CompileResult,
  CompileSuccess,
  CompileFailure,
  CompileError,
  CompileErrorCode,
  ExecutionPlan,
  CompiledNode,
  CompiledContext,
} from './types';

export class PipelineCompiler {
  private cache: CompileCache;

  constructor(cache?: CompileCache) {
    this.cache = cache ?? new CompileCache();
  }

  async compile(yaml: string, sourcePath?: string): Promise<CompileResult> {
    const cacheKey = sourcePath ? `${sourcePath}:${yaml}` : yaml;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ok: true, plan: cached, warnings: [] };
    }

    const errors: CompileError[] = [];
    const warnings: CompileError[] = [];

    // Step 1: parse YAML + schema validation
    let parsed: Awaited<ReturnType<typeof parseYaml>>;
    try {
      parsed = await parseYaml({ yaml, sourcePath });
    } catch (err) {
      return {
        ok: false,
        errors: [{ code: 'parse_error', message: String(err) }],
        warnings,
      };
    }

    // Step 2: flatten node tree
    let extraction: ReturnType<typeof extractFlat>;
    try {
      extraction = extractFlat(parsed);
    } catch (err) {
      return {
        ok: false,
        errors: [{ code: 'extract_error', message: String(err) }],
        warnings,
      };
    }

    // Step 3: resolve $nodes.X references
    const resolved = resolveReferences(extraction);
    for (const e of resolved.errors) {
      errors.push({ code: e.code, message: e.message, pathId: e.pathId });
    }

    // Step 4: build dependency DAG
    const graph = buildAdjacency(extraction, resolved);

    // Step 5: detect cycles via Kahn's algorithm
    const cycleResult = detectCycle(graph);
    if (cycleResult.hasCycle && cycleResult.error) {
      errors.push({ code: cycleResult.error.code, message: cycleResult.error.message });
    }

    if (errors.length > 0) {
      return { ok: false, errors, warnings };
    }

    // Assemble ExecutionPlan
    const raw = parsed.raw;
    const s = raw.settings ?? {};
    const context: CompiledContext = {
      settings: {
        maxParallel: s.maxParallel ?? 5,
        totalTimeout: s.totalTimeout ?? 7200,
        nodeTimeout: s.nodeTimeout ?? 600,
        allowedEnvKeys: s.allowedEnvKeys ?? [],
      },
      variables: raw.metadata ?? {},
    };

    const nodes = new Map<string, CompiledNode>();
    for (const flatNode of extraction.nodes) {
      nodes.set(flatNode.pathId, {
        pathId: flatNode.pathId,
        userId: flatNode.userId,
        spec: flatNode.spec,
        prerequisites: [...(graph.reverse.get(flatNode.pathId) ?? [])],
        dependents: [...(graph.forward.get(flatNode.pathId) ?? [])],
        depth: flatNode.depth,
      });
    }

    const plan: ExecutionPlan = {
      id: nanoid(),
      pipelineName: raw.name,
      nodes,
      topologicalOrder: cycleResult.topologicalOrder,
      graph,
      context,
      compiledAt: Date.now(),
    };

    this.cache.set(cacheKey, plan);
    return { ok: true, plan, warnings };
  }
}
