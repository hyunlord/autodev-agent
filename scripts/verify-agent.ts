/**
 * Verify Agent for Layer 1 — AutoDev development process
 *
 * Usage: npx tsx scripts/verify-agent.ts
 *
 * Reads git diff, collects changed file contents,
 * and asks the Verify Agent (different LLM) to review.
 */

import { VerifyAgent } from '../src/agents/verify/verify-agent';
import { execSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { PipelineEvent } from '../src/lib/types';

async function main() {
  const projectDir = process.cwd();

  console.log('🔍 Verify Agent — Layer 1 Code Review');
  console.log('');

  // 1. Get changed files (staged + unstaged + untracked)
  let changedFiles: string[] = [];
  try {
    const statusOutput = execSync('git status --porcelain', { cwd: projectDir, encoding: 'utf-8' });
    changedFiles = statusOutput.trim().split('\n')
      .filter(Boolean)
      .map(line => line.slice(3).trim())  // Remove status prefix (e.g. "M ", "?? ", "A ")
      .filter(f => !f.startsWith('.git/'));
  } catch {
    console.log('⚠ No git status available');
    process.exit(0);
  }

  if (changedFiles.length === 0) {
    console.log('✅ No changed files');
    process.exit(0);
  }

  console.log(`Changed files (${changedFiles.length}):`);
  changedFiles.forEach(f => console.log(`  ${f}`));
  console.log('');

  // 2. Select Verify Agent (different from Claude Code)
  const verifyAgent = await VerifyAgent.selectDifferentFrom('claude-code');
  const available = await verifyAgent.isAvailable();

  if (!available) {
    console.log('⚠ Verify Agent not available (need gemini-cli, codex-cli, or claude-cli)');
    console.log('  Skipping LLM review.');
    console.log(JSON.stringify({ score: 10, issues: ['Verify Agent unavailable'], verdict: 'warn' }));
    process.exit(0);
  }

  console.log(`Using: ${verifyAgent.name}`);
  console.log('');

  // 3. Build prompt with changed file contents
  const prompt = `You are reviewing code changes to the AutoDev Agent project.
AutoDev Agent is a universal AI development orchestrator built with Next.js, TypeScript, SQLite.

Review these changes for:
1. TypeScript type errors or missing types
2. Logic bugs or edge cases
3. Missing error handling
4. Regressions — does this break existing functionality?
5. Security issues (hardcoded secrets, path traversal, etc.)
6. Code quality (naming, structure, unnecessary complexity)

Be critical — your job is to find problems, not confirm the code works.`;

  // 4. Invoke Verify Agent
  const result = await verifyAgent.invoke({
    prompt: 'Review the code changes',
    originalPrompt: prompt,
    // TODO: 삭제된 파일도 리뷰 대상에 포함 (현재는 existsSync로 필터)
    // TODO: review 지시를 prompt 필드로 이동 (현재는 originalPrompt에 있음)
    modifiedFiles: changedFiles.filter(f => existsSync(join(projectDir, f))),
    projectDir,
    tools: [],
    skipMechanical: true,
    context: {
      projectDir,
      projectType: 'nextjs',
      files: changedFiles,
    },
    config: {
      timeoutMs: 120_000,
    },
    onProgress: (event: PipelineEvent) => {
      if (event.type === 'log') {
        console.log(`  [${event.level}] ${event.message}`);
      }
    },
  } as any);

  const vr = result.result as any; // TODO: IAgent 제네릭 리팩터 후 as any 제거

  // 5. Output result
  console.log('');
  console.log('─'.repeat(60));
  console.log(`Verdict: ${vr.verdict.toUpperCase()}`);
  console.log(`Score: ${vr.score}/100`);
  console.log(`Reason: ${vr.reason}`);

  if (vr.issues.length > 0) {
    console.log('');
    console.log('Issues:');
    vr.issues.forEach((issue: string, i: number) => console.log(`  ${i + 1}. ${issue}`));
  }

  if (vr.suggestions.length > 0) {
    console.log('');
    console.log('Suggestions:');
    vr.suggestions.forEach((s: string, i: number) => console.log(`  ${i + 1}. ${s}`));
  }

  console.log('─'.repeat(60));

  // 6. Output JSON for verify.sh
  // Score scaled to 15 points for verify.sh integration (15 = max in cross-check step)
  const jsonResult = JSON.stringify({
    score: Math.round(vr.score * 15 / 100),
    issues: vr.issues,
    verdict: vr.verdict === 'pass' ? 'ok' : vr.verdict === 'fail' ? 'fail' : 'warn',
  });
  console.log(`VERIFY_AGENT_RESULT=${jsonResult}`);

  // 7. Save verdict to ~/.autodev/verdict.json (pre-commit hook에서 참조)
  try {
    const verdictDir = join(process.env.HOME ?? '/tmp', '.autodev');
    mkdirSync(verdictDir, { recursive: true });
    let commitHash = 'unknown';
    try {
      commitHash = execSync('git rev-parse HEAD', { encoding: 'utf-8', cwd: projectDir }).trim();
    } catch { /* 커밋 없는 초기 상태 */ }
    writeFileSync(
      join(verdictDir, 'verdict.json'),
      JSON.stringify({
        timestamp: new Date().toISOString(),
        verdict: vr.verdict,
        score: vr.score,
        issues: vr.issues,
        commitHash,
      }, null, 2),
      'utf-8',
    );
  } catch {
    // verdict 저장 실패는 무시 (핵심 기능 아님)
  }

  // Exit with error if not pass
  if (vr.verdict === 'fail' || vr.verdict === 're-code' || vr.verdict === 're-plan') {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Verify Agent error:', err);
  console.log(JSON.stringify({ score: 10, issues: [`Error: ${err}`], verdict: 'warn' }));
});
