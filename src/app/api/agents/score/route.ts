import { NextResponse } from 'next/server';
import { AgentScorer } from '@/agents/agent-scorer';
import { estimateComplexity } from '@/agents/tags-extractor';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { taskPrompt, costPreference } = body as {
      taskPrompt?: string;
      costPreference?: 'cheap' | 'balanced' | 'quality';
    };

    if (!taskPrompt) {
      return NextResponse.json({ error: 'taskPrompt is required' }, { status: 400 });
    }

    const scores = await AgentScorer.scoreAll({
      taskPrompt,
      costPreference,
      estimatedComplexity: estimateComplexity(taskPrompt),
    });

    return NextResponse.json({ scores });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, scores: [] }, { status: 500 });
  }
}
