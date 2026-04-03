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
import { existsSync } from 'fs';
import { join } from 'path';
import type { PipelineEvent } from '../src/lib/types';

async function main() {
  const projectDir = process.cwd();

  console.log('🔍 Verify Agent — Layer 1 Code Review');
  console.log('');

  // 1. Get changed files
  let changedFiles: string[] = [];
  try {
    const diffOutput = execSync('git diff HEAD~1 --name-only', { cwd: projectDir, encoding: 'utf-8' });
    changedFiles = diffOutput.trim().split('\n').filter(Boolean);
  } catch {
    console.log('⚠ No git diff available');
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
    console.log('⚠ Verify Agent not available (need gemini, codex, or ANTHROPIC_API_KEY)');
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
    modifiedFiles: changedFiles.filter(f => existsSync(join(projectDir, f))),
    projectDir,
    tools: [],
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

  const vr = result.result as any;

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
  const jsonResult = JSON.stringify({
    score: Math.round(vr.score * 15 / 100),
    issues: vr.issues,
    verdict: vr.verdict === 'pass' ? 'ok' : vr.verdict === 'fail' ? 'fail' : 'warn',
  });
  console.log(`VERIFY_AGENT_RESULT=${jsonResult}`);

  // Exit with error if fail
  if (vr.verdict === 'fail') {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Verify Agent error:', err);
  console.log(JSON.stringify({ score: 10, issues: [`Error: ${err}`], verdict: 'warn' }));
});
