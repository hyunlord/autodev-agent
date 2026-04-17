import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { tasks, attempts } from '@/lib/db/schema';
import { desc, eq, gte, and } from 'drizzle-orm';
import { loadPrompt, type PromptRole } from '@/lib/harness/prompt-loader';
import { resolveCli } from '@/lib/cli-resolver';
import { getExeca } from '@/lib/execa';
import { extractJson } from '@/lib/utils/json-extractor';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Reserved roles: 예약된 에이전트 역할. 아직 파이프라인에 통합되지 않음.
// 통합 시점에 Set에서 제거하면 자동 활성화.
const RESERVED_ROLES = new Set(['evaluator']);

type EvolveOutput = {
  analysis?: string;
  confidence?: number;
  suggestions?: Array<Record<string, unknown>>;
};

// JSON 강제 재시도용 prefix. planning.ts의 PLAN_RETRY_PREFIX와 동일 패턴이지만
// Evolve 응답 스키마(analysis/confidence/suggestions)에 맞춰 별도 정의.
const EVOLVE_RETRY_PREFIX = `⚠️ CRITICAL: Your previous response was NOT valid JSON.
You must output ONLY a JSON object — starting with { and ending with }.
No markdown code fences. No explanation before or after. No prose.

Valid example format:
{"analysis":"brief summary","confidence":0.8,"suggestions":[{"id":"s1","title":"Short title","description":"Why","ruleText":"Concrete rule","priority":"high"}]}

Now respond to the original request below with ONLY JSON in the same shape:

---

`;

async function dumpEvolveDebug(
  role: string,
  rawStdout: string,
  phase: 'first' | 'retry',
): Promise<void> {
  try {
    const debugDir = path.join(os.homedir(), '.autodev', 'debug');
    await fs.mkdir(debugDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(
      path.join(debugDir, `evolve-${role}-${phase}-${ts}.txt`),
      rawStdout,
      'utf-8',
    );
  } catch {
    /* debug dump 실패는 비본질 — 무시 */
  }
}

interface EvolveSuggestion {
  id: string;
  title: string;
  description: string;
  ruleText: string;
  priority: 'high' | 'medium' | 'low';
  selected: boolean;
}

interface EvolveResponse {
  stats: {
    totalTasks: number;
    failedCount: number;
    avgScore: number | null;
    uniqueIssues: string[];
  };
  analysis: string;
  suggestions: EvolveSuggestion[];
  confidence: number;
  currentPrompt: string;
  role: string;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { role, projectDir, lookbackDays = 30, minTasks = 3 } = body;

    if (!role) {
      return NextResponse.json({ error: 'role is required' }, { status: 400 });
    }

    if (RESERVED_ROLES.has(role)) {
      return NextResponse.json(
        { error: `Role "${role}" is reserved and not yet integrated into the pipeline.` },
        { status: 400 },
      );
    }

    // 1. Query recent tasks
    const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const conditions = [gte(tasks.createdAt, cutoff.toISOString())];
    if (projectDir) {
      conditions.push(eq(tasks.projectDir, projectDir));
    }

    const recentTasks = db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.createdAt))
      .limit(50)
      .all();

    if (recentTasks.length < minTasks) {
      return NextResponse.json({
        error: `분석에 필요한 최소 작업 수(${minTasks}개)에 미달합니다. 현재: ${recentTasks.length}개`,
      }, { status: 400 });
    }

    // 2. For each task, get attempts and extract verify issues
    const allIssues: string[] = [];
    let totalScore = 0;
    let scoreCount = 0;
    let failedCount = 0;

    for (const task of recentTasks) {
      if (task.status === 'failed' || task.status === 'escalated') {
        failedCount++;
      }

      const taskAttempts = db
        .select()
        .from(attempts)
        .where(eq(attempts.taskId, task.id))
        .all();

      for (const attempt of taskAttempts) {
        if (!attempt.output) continue;

        try {
          const output = typeof attempt.output === 'string'
            ? JSON.parse(attempt.output)
            : attempt.output;

          // Extract score
          if (typeof output?.score === 'number') {
            totalScore += output.score;
            scoreCount++;
          }

          // Extract issues
          if (Array.isArray(output?.issues)) {
            for (const issue of output.issues) {
              const issueText = typeof issue === 'string' ? issue : issue?.description ?? issue?.message ?? '';
              if (issueText) allIssues.push(issueText);
            }
          }

          // Also check errorLog
          if (attempt.status === 'error' && attempt.errorLog) {
            allIssues.push(attempt.errorLog.slice(0, 200));
          }
        } catch {
          // output is not valid JSON, skip
        }
      }
    }

    // 3. Build statistics
    const uniqueIssues = [...new Set(allIssues)].slice(0, 20);
    const avgScore = scoreCount > 0 ? Math.round((totalScore / scoreCount) * 10) / 10 : null;

    const stats = {
      totalTasks: recentTasks.length,
      failedCount,
      avgScore,
      uniqueIssues,
    };

    // 4. Load current prompt
    const loaded = loadPrompt(role as PromptRole, projectDir);

    // 5. Call Gemini CLI for analysis
    const geminiPath = await resolveCli('gemini');
    if (!geminiPath) {
      return NextResponse.json(
        { error: 'Gemini CLI를 찾을 수 없습니다. gemini CLI가 설치되어 있는지 확인하세요.' },
        { status: 500 },
      );
    }

    const analysisPrompt = `You are a prompt engineering expert. Analyze the following task history and suggest improvements to the agent's system prompt.

## Current Prompt (role: ${role})
${loaded.rawContent.slice(0, 2000)}

## Task Statistics
- Total tasks analyzed: ${stats.totalTasks}
- Failed tasks: ${stats.failedCount}
- Average verification score: ${avgScore ?? 'N/A'}

## Common Issues Found
${uniqueIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

## Instructions
Based on the patterns above, suggest 3-5 concrete rules or guidelines to add to the system prompt that would prevent these issues from recurring.

Respond with ONLY valid JSON:
{
  "analysis": "Brief summary of patterns found (2-3 sentences in Korean)",
  "suggestions": [
    {
      "id": "s1",
      "title": "Short title in Korean",
      "description": "Why this rule is needed (Korean)",
      "ruleText": "The actual rule text to add to the prompt (Korean)",
      "priority": "high" | "medium" | "low"
    }
  ],
  "confidence": 0.0-1.0
}`;

    const execa = await getExeca();
    const { stdout } = await execa(geminiPath, ['-p', analysisPrompt], {
      timeout: 120_000,
      reject: false,
      env: { ...process.env },
    });

    // Debug dump: 모든 응답을 postmortem용으로 저장 (비본질 — 실패 시 무시)
    await dumpEvolveDebug(role, stdout, 'first');

    // Parse Gemini response — extractJson 5-stage fallback 사용
    let analysis = '';
    let suggestions: EvolveSuggestion[] = [];
    let confidence = 0;
    let parsed: EvolveOutput | null = null;
    let parseError: Error | null = null;
    let rawForPreview = stdout;

    try {
      parsed = extractJson<EvolveOutput>(stdout, 'analysis');
    } catch (err) {
      parseError = err instanceof Error ? err : new Error(String(err));
    }

    // 1차 실패 → JSON 강제 prefix 붙여 1회 retry
    if (!parsed) {
      const retryPrompt = EVOLVE_RETRY_PREFIX + analysisPrompt;
      const retryResult = await execa(geminiPath, ['-p', retryPrompt], {
        timeout: 120_000,
        reject: false,
        env: { ...process.env },
      });
      await dumpEvolveDebug(role, retryResult.stdout, 'retry');
      try {
        parsed = extractJson<EvolveOutput>(retryResult.stdout, 'analysis');
        parseError = null;
        rawForPreview = retryResult.stdout;
      } catch (err) {
        parseError = err instanceof Error ? err : new Error(String(err));
        rawForPreview = retryResult.stdout;
      }
    }

    if (parsed) {
      analysis = parsed.analysis ?? '';
      confidence = parsed.confidence ?? 0;
      suggestions = (parsed.suggestions ?? []).map((s: Record<string, unknown>) => ({
        id: (s.id as string) ?? `s${Math.random().toString(36).slice(2, 6)}`,
        title: (s.title as string) ?? '',
        description: (s.description as string) ?? '',
        ruleText: (s.ruleText as string) ?? '',
        priority: ((s.priority as 'high' | 'medium' | 'low') ?? 'medium'),
        selected: s.priority === 'high',
      }));
    } else {
      const rawPreview = rawForPreview.slice(0, 500).replace(/\s+/g, ' ');
      analysis = `파싱 실패: ${parseError?.message ?? 'unknown'}\n원본 미리보기: ${rawPreview}`;
    }

    const response: EvolveResponse & { debug?: { parseError?: string; rawPreview?: string } } = {
      stats,
      analysis,
      suggestions,
      confidence,
      currentPrompt: loaded.rawContent,
      role,
      ...(parsed ? {} : {
        debug: {
          parseError: parseError?.message,
          rawPreview: rawForPreview.slice(0, 500),
        },
      }),
    };

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
