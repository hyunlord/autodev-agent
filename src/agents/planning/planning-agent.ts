import type { IAgent, AgentInput, AgentOutput } from '../interfaces';
import type { PipelineEvent } from '../../lib/types';
import type { PlanningMode } from '../../lib/types';
import { generatePlan, type Plan, type PlanResult } from '../../worker/planning';
import type { ProjectConfig } from '../../lib/detection/project-type';

export interface PlanningOutput extends AgentOutput {
  result: {
    plan: Plan;
    inputTokens: number;
    outputTokens: number;
  };
}

export class PlanningAgent implements IAgent {
  readonly id: string;
  readonly name: string;
  readonly role = 'planning' as const;
  private mode: PlanningMode;

  constructor(mode?: string) {
    this.mode = (mode ?? 'claude-cli') as PlanningMode;
    this.id = `planning-${this.mode}`;
    this.name = `Planning Agent (${this.mode})`;
  }

  async isAvailable(): Promise<boolean> {
    // Planning uses generatePlan which handles CLI resolution internally
    return true;
  }

  async invoke(input: AgentInput): Promise<PlanningOutput> {
    const startTime = Date.now();
    const emit = input.onProgress ?? (() => {});

    const projectConfig = input.context.projectConfig as ProjectConfig | null;
    const workspaceContext = input.context.workspaceContext ?? '';

    const planResult: PlanResult = await generatePlan(
      input.prompt,
      projectConfig,
      this.mode,
      undefined, // manualInput — not used via agent interface
      (msg: string) => emit({ type: 'log', level: 'info', message: msg } as PipelineEvent),
      workspaceContext,
      input.context.projectDir,
      input.config.systemPrompt ?? null,
    );

    return {
      success: true,
      result: {
        plan: planResult.plan,
        inputTokens: planResult.inputTokens,
        outputTokens: planResult.outputTokens,
      },
      costUsd: planResult.costUsd,
      tokenUsage: {
        input: planResult.inputTokens,
        output: planResult.outputTokens,
      },
      durationMs: Date.now() - startTime,
    };
  }
}
