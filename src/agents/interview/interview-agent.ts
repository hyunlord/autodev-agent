import type { IAgent, AgentInput, AgentOutput } from '../interfaces';
import type { PipelineEvent } from '../../lib/types';
import { resolveCli } from '../../lib/cli-resolver';
import { getExeca } from '../../lib/execa';
import { extractJson } from '../../lib/utils/json-extractor';

export interface InterviewOutput extends AgentOutput {
  result: {
    questions: string[];
  };
}

export class InterviewAgent implements IAgent {
  readonly id = 'interview';
  readonly name = 'Interview Agent';
  readonly role = 'interview' as const;
  private llm: string;

  constructor(llm?: string) {
    this.llm = llm ?? 'claude-cli';
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async invoke(input: AgentInput): Promise<InterviewOutput> {
    const startTime = Date.now();
    const emit = input.onProgress ?? (() => {});

    const interviewPrompt = `The user wants to build something but needs more detail. Generate 3-5 clarifying questions.

User request: "${input.prompt}"

IMPORTANT RULES:
- Do NOT ask about things already mentioned in the request
- If they said "React" → don't ask about tech stack
- If they described specific features → don't ask about features
- Only ask about genuinely MISSING information
- Questions should be in Korean if the user's request is in Korean

Respond with ONLY a JSON array of question strings:
["Question 1?", "Question 2?", "Question 3?"]`;

    let questions: string[] = [];

    try {
      const ex = await getExeca();
      let stdout = '';

      if (this.llm === 'claude-cli' || this.llm === 'auto') {
        const cliPath = await resolveCli('claude');
        if (cliPath) {
          const result = await ex(cliPath, ['-p', interviewPrompt, '--output-format', 'text', '--max-turns', '2', '--dangerously-skip-permissions'], {
            cwd: input.context.projectDir, reject: false, timeout: 60_000,
          });
          stdout = result.stdout;
        }
      } else if (this.llm === 'gemini-cli') {
        const cliPath = await resolveCli('gemini');
        if (cliPath) {
          const result = await ex(cliPath, ['-p', interviewPrompt], {
            cwd: input.context.projectDir, reject: false, timeout: 60_000,
          });
          stdout = result.stdout;
        }
      }

      if (stdout) {
        try {
          questions = extractJson<string[]>(stdout);
          if (!Array.isArray(questions)) questions = [];
        } catch {
          const lines = stdout.split('\n').filter((l: string) => l.trim().endsWith('?'));
          questions = lines.slice(0, 5).map((l: string) => l.replace(/^\d+[.)]\s*/, '').trim());
        }
      }
    } catch (err) {
      emit({ type: 'log', level: 'warn', message: `Interview question generation failed: ${err}` } as PipelineEvent);
    }

    if (questions.length === 0) {
      questions = [
        '어떤 기능이 필요한가요? 구체적으로 설명해주세요.',
        '어떤 기술 스택을 선호하나요? (React, Vue, 순수 HTML 등)',
        '디자인이나 UI에 대한 선호가 있나요?',
        '프로젝트의 규모나 범위는 어느 정도인가요?',
      ];
    }

    return {
      success: true,
      result: { questions },
      costUsd: 0,
      tokenUsage: { input: 0, output: 0 },
      durationMs: Date.now() - startTime,
    };
  }

  /** Check if prompt is specific enough to skip interview */
  static shouldSkip(prompt: string): boolean {
    const words = prompt.split(/\s+/).length;
    const hasStack = /react|vue|next|angular|html|python|node|typescript|flutter/i.test(prompt);
    const hasAction = /만들|생성|추가|수정|구현|개발|build|create|add|fix|implement/i.test(prompt);
    return words > 15 || (hasStack && hasAction);
  }
}
