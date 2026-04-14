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
import { existsSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { PipelineEvent } from '../src/lib/types'; // used in onProgress callback

async function main() {
  const projectDir = process.cwd();

  console.log('🔍 Verify Agent — Layer 1 Code Review');
  console.log('');

  // 1. Get changed files (staged + unstaged + untracked, fallback to last commit diff)
  let changedFiles: string[] = [];
  try {
    const statusOutput = execSync('git status --porcelain', { cwd: projectDir, encoding: 'utf-8' });
    changedFiles = statusOutput.split('\n')
      .filter(Boolean)
      .map(line => {
        // git porcelain format: "XY filename" — X=staging, Y=working tree, then space
        // IMPORTANT: don't trim() the full output before split — it eats the leading
        // space of the first line's status code (e.g., " M file" → "M file" → slice(3) drops a char)
        const raw = line.slice(3).trim();
        // Handle git renames: "old -> new" → use new path
        const arrowIdx = raw.indexOf(' -> ');
        const path = arrowIdx !== -1 ? raw.slice(arrowIdx + 4) : raw;
        // Strip quotes from filenames with spaces (git porcelain format)
        return path.replace(/^"|"$/g, '');
      })
      .filter(f => !f.startsWith('.git/'));
  } catch {
    console.log('⚠ No git status available');
  }

  // Fallback: if no uncommitted changes, check last commit (verify.sh calls us after commit)
  if (changedFiles.length === 0) {
    try {
      const diffOutput = execSync('git diff --name-only HEAD~1 HEAD', { cwd: projectDir, encoding: 'utf-8' });
      changedFiles = diffOutput.trim().split('\n')
        .filter(Boolean)
        .filter(f => !f.startsWith('.git/'));
    } catch { /* no previous commit */ }
  }

  // Filter out non-reviewable files (lock files, binaries, generated)
  const SKIP_PATTERNS = [
    /pnpm-lock\.yaml$/,
    /package-lock\.json$/,
    /yarn\.lock$/,
    /\.lock$/,
    /\.min\.(js|css)$/,
    /\.map$/,
    /\.woff2?$/,
    /\.png$/, /\.jpg$/, /\.jpeg$/, /\.gif$/, /\.ico$/, /\.svg$/,
  ];
  changedFiles = changedFiles.filter(f => !SKIP_PATTERNS.some(p => p.test(f)));

  // Prioritize src/ files first, then config files
  changedFiles.sort((a, b) => {
    const aIsSrc = a.startsWith('src/') ? 0 : 1;
    const bIsSrc = b.startsWith('src/') ? 0 : 1;
    return aIsSrc - bIsSrc;
  });

  // Limit to top 10 files to prevent prompt overflow and LLM timeouts
  if (changedFiles.length > 10) {
    console.log(`  ⚠ ${changedFiles.length} files changed — reviewing top 10 (src/ prioritized)`);
    changedFiles = changedFiles.slice(0, 10);
  }

  if (changedFiles.length === 0) {
    console.log('✅ No changed files');
    process.exit(0);
  }

  console.log(`Changed files (${changedFiles.length}):`);
  changedFiles.forEach(f => console.log(`  ${f}`));
  console.log('');

  // 2. Select Verify Agent (different from coding agent)
  const excludeIdx = process.argv.indexOf('--exclude-agent');
  const excludeAgent = excludeIdx !== -1 && process.argv[excludeIdx + 1] ? process.argv[excludeIdx + 1] : 'claude-code';
  const { primary: verifyAgent, fallbacks } = await VerifyAgent.selectDifferentFrom(excludeAgent);
  verifyAgent.fallbackLlms = fallbacks;
  const available = await verifyAgent.isAvailable();

  if (!available) {
    console.log('⚠ Verify Agent not available (need gemini-cli, codex-cli, or claude-cli)');
    console.log('  Skipping LLM review.');
    const warnResult = { score: 25, issues: ['Verify Agent unavailable'], verdict: 'warn' };
    console.log(`VERIFY_AGENT_RESULT=${JSON.stringify(warnResult)}`);
    // verdict.json도 저장 (fallback 경로 일관성) — score를 VERIFY_AGENT_RESULT와 일치시킴
    try {
      const verdictDir = join(process.env.HOME ?? '/tmp', '.autodev');
      mkdirSync(verdictDir, { recursive: true });
      let commitHash = 'unknown';
      try { commitHash = execSync('git rev-parse HEAD', { encoding: 'utf-8', cwd: projectDir }).trim(); } catch { /* */ }
      writeFileSync(join(verdictDir, 'verdict.json'), JSON.stringify({ timestamp: new Date().toISOString(), verdict: 'warn', score: warnResult.score, issues: warnResult.issues, commitHash }, null, 2), 'utf-8');
    } catch { /* verdict 저장 실패는 무시 */ }
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
    modifiedFiles: changedFiles.filter(f => {
      const fullPath = join(projectDir, f);
      return existsSync(fullPath) && statSync(fullPath).isFile();
    }),
    projectDir,
    tools: [],
    skipMechanical: true,
    context: {
      projectDir,
      projectType: 'nextjs',
      files: changedFiles,
    },
    config: {
      timeoutMs: 180_000,
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
  // Score scaled to 50 points for verify.sh integration (50 = max in cross-check step)
  const jsonResult = JSON.stringify({
    score: Math.round(vr.score * 50 / 100),
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

  // Exit with error if not pass — process.exitCode로 설정 (process.exit()는 stdout flush 안 함)
  if (vr.verdict === 'fail' || vr.verdict === 're-code' || vr.verdict === 're-plan') {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Verify Agent error:', err);
  const errResult = { score: 25, issues: [`Error: ${err}`], verdict: 'warn' };
  console.log(`VERIFY_AGENT_RESULT=${JSON.stringify(errResult)}`);
  // verdict.json도 저장 (fallback 경로 일관성) — score를 VERIFY_AGENT_RESULT와 일치시킴
  try {
    const verdictDir = join(process.env.HOME ?? '/tmp', '.autodev');
    mkdirSync(verdictDir, { recursive: true });
    let commitHash = 'unknown';
    try { commitHash = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim(); } catch { /* */ }
    writeFileSync(join(verdictDir, 'verdict.json'), JSON.stringify({ timestamp: new Date().toISOString(), verdict: 'warn', score: 25, issues: errResult.issues, commitHash }, null, 2), 'utf-8');
  } catch { /* verdict 저장 실패는 무시 */ }
  process.exitCode = 1;
});
