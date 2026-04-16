import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { tasks, attempts } from '@/lib/db/schema';
import { desc, eq, gte, and } from 'drizzle-orm';
import { loadPrompt, type PromptRole } from '@/lib/harness/prompt-loader';
import { resolveCli } from '@/lib/cli-resolver';
import { getExeca } from '@/lib/execa';

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

    // Parse Gemini response
    let analysis = '';
    let suggestions: EvolveSuggestion[] = [];
    let confidence = 0;

    try {
      // Extract JSON from response (may be wrapped in markdown code fences)
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        analysis = parsed.analysis ?? '';
        confidence = parsed.confidence ?? 0;
        suggestions = (parsed.suggestions ?? []).map((s: Record<string, unknown>) => ({
          id: s.id ?? `s${Math.random().toString(36).slice(2, 6)}`,
          title: s.title ?? '',
          description: s.description ?? '',
          ruleText: s.ruleText ?? '',
          priority: s.priority ?? 'medium',
          selected: s.priority === 'high',
        }));
      } else {
        analysis = '분석 결과를 파싱할 수 없습니다. 원본 응답을 확인하세요.';
      }
    } catch {
      analysis = '분석 결과를 파싱할 수 없습니다.';
    }

    const response: EvolveResponse = {
      stats,
      analysis,
      suggestions,
      confidence,
      currentPrompt: loaded.rawContent,
      role,
    };

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
