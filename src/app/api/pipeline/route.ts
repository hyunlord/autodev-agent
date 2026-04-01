import { loadPrompt, loadMcpConfig } from '@/lib/harness/prompt-loader';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectDir = url.searchParams.get('projectDir') ?? undefined;

  const mcpConfig = loadMcpConfig(projectDir);

  const agentOverrides = (['planner', 'coder', 'verifier', 'evaluator'] as const).map(role => {
    const loaded = loadPrompt(role, projectDir);
    return { role, source: loaded.source };
  });

  return NextResponse.json({
    stages: [
      { id: 'detect', name: 'Project Detection' },
      { id: 'plan', name: 'Planning', agentPrompt: 'planner.md', mcp: mcpConfig.pipeline_mapping.planning },
      { id: 'review', name: 'Plan Review', skippable: true },
      { id: 'select', name: 'Agent Selection' },
      { id: 'code', name: 'Coding', agentPrompt: 'coder.md', mcp: mcpConfig.pipeline_mapping.coding },
      { id: 'verify', name: 'Verification', agentPrompt: 'verifier.md', mcp: mcpConfig.pipeline_mapping.verification },
      { id: 'complete', name: 'Complete', agentPrompt: 'evaluator.md' },
    ],
    agentOverrides,
    mcpMapping: mcpConfig.pipeline_mapping,
  });
}
