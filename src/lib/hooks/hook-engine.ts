import type { PipelineEvent } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HookEvent =
  | 'TaskStart'
  | 'PrePlan'
  | 'PostPlan'
  | 'PlanReview'
  | 'PreCode'
  | 'PostCode'
  | 'PreVerify'
  | 'PostVerify'
  | 'OnRetry'
  | 'OnReplan'
  | 'TaskComplete'
  | 'TaskFail';

export interface HookDefinition {
  name: string;
  type: 'command' | 'script' | 'agent' | 'http';
  // command type
  command?: string;
  // script type
  path?: string;
  // agent type
  prompt?: string;
  llm?: string;
  tools?: string[];
  // http type
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  // common
  timeout?: number;      // seconds (default: 30)
  blocking?: boolean;    // default: true
  failAction?: 'ignore' | 'warn' | 'retry' | 'replan' | 'fail';
}

export interface HookMatcher {
  matcher?: string;      // regex — empty = match all
  hooks: HookDefinition[];
}

export interface HookInput {
  event: HookEvent;
  taskId: string;
  projectDir: string;
  [key: string]: unknown;
}

export interface HookOutput {
  name: string;
  decision: 'allow' | 'deny' | 'modify';
  reason?: string;
  additionalContext?: string;
  issues?: string[];
  updatedInput?: Record<string, unknown>;
  durationMs: number;
  raw?: string;
}

export interface HookResults {
  outputs: HookOutput[];
  finalDecision: 'allow' | 'deny' | 'modify';
  mergedContext: string;
  mergedIssues: string[];
  updatedInput?: Record<string, unknown>;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class HookEngine {
  private config: Record<string, HookMatcher[]> = {};

  /**
   * Built-in default hooks — always active, overridable by name.
   */
  private loadDefaults(): Record<string, HookMatcher[]> {
    return {
      PostPlan: [{
        matcher: '',
        hooks: [{
          name: 'plan-log',
          type: 'command',
          command: "echo '[Hook] Plan generated: {{taskId}}'",
          blocking: false,
        }],
      }],
      PostCode: [{
        matcher: '',
        hooks: [{
          name: 'file-check',
          type: 'command',
          command: "ls {{projectDir}}/*.html {{projectDir}}/*.js {{projectDir}}/*.ts 2>/dev/null | head -5 || echo 'No output files'",
          blocking: false,
        }],
      }],
      TaskComplete: [{
        matcher: '',
        hooks: [{
          name: 'complete-log',
          type: 'command',
          command: "echo '[Hook] Task {{taskId}} completed'",
          blocking: false,
        }],
      }],
    };
  }

  /**
   * Merge overlay config into base.
   * Same event: hooks are combined (overlay appended after base).
   * Same hook name within an event: overlay replaces base hook.
   */
  private mergeConfig(
    base: Record<string, HookMatcher[]>,
    overlay: Record<string, HookMatcher[]>,
  ): Record<string, HookMatcher[]> {
    const result: Record<string, HookMatcher[]> = { ...base };

    for (const [event, overlayMatchers] of Object.entries(overlay)) {
      if (!result[event]) {
        result[event] = overlayMatchers;
        continue;
      }

      // Names defined in overlay — these replace same-named hooks in base
      const overlayNames = new Set(
        overlayMatchers.flatMap(m => m.hooks.map(h => h.name)),
      );

      // Strip overridden names from base, keep non-empty matchers
      const filteredBase = result[event]
        .map(m => ({ ...m, hooks: m.hooks.filter(h => !overlayNames.has(h.name)) }))
        .filter(m => m.hooks.length > 0);

      result[event] = [...filteredBase, ...overlayMatchers];
    }

    return result;
  }

  /**
   * Load hook config in priority order:
   *   1. Built-in defaults (always active)
   *   2. Global ~/.autodev/hooks.json (overrides defaults)
   *   3. Project {projectDir}/.autodev/hooks.json (overrides global)
   */
  async load(projectDir: string): Promise<void> {
    const { existsSync, readFileSync } = await import('fs');
    const { join } = await import('path');
    const { homedir } = await import('os');

    // 1. defaults
    this.config = this.loadDefaults();

    // 2. global
    const globalFile = join(homedir(), '.autodev', 'hooks.json');
    if (existsSync(globalFile)) {
      try {
        const parsed = JSON.parse(readFileSync(globalFile, 'utf-8'));
        this.config = this.mergeConfig(this.config, (parsed.hooks ?? {}) as Record<string, HookMatcher[]>);
      } catch { /* invalid JSON — skip */ }
    }

    // 3. project
    const projectFile = join(projectDir, '.autodev', 'hooks.json');
    if (existsSync(projectFile)) {
      try {
        const parsed = JSON.parse(readFileSync(projectFile, 'utf-8'));
        this.config = this.mergeConfig(this.config, (parsed.hooks ?? {}) as Record<string, HookMatcher[]>);
      } catch { /* invalid JSON — skip */ }
    }
  }

  /**
   * Execute all matching hooks for an event.
   * Returns merged results — most restrictive decision wins (deny > modify > allow).
   */
  async execute(
    input: HookInput,
    emit: (e: PipelineEvent) => void,
  ): Promise<HookResults> {
    const matchers = this.config[input.event] as HookMatcher[] | undefined;
    if (!matchers || matchers.length === 0) {
      return { outputs: [], finalDecision: 'allow', mergedContext: '', mergedIssues: [] };
    }

    // Collect matching hook definitions
    const matchedHooks: HookDefinition[] = [];
    for (const m of matchers) {
      if (!m.matcher || m.matcher === '') {
        matchedHooks.push(...m.hooks);
      } else {
        try {
          const regex = new RegExp(m.matcher);
          if (regex.test(this.getMatchTarget(input))) {
            matchedHooks.push(...m.hooks);
          }
        } catch {
          /* invalid regex — skip this matcher */
        }
      }
    }

    if (matchedHooks.length === 0) {
      return { outputs: [], finalDecision: 'allow', mergedContext: '', mergedIssues: [] };
    }

    emit({
      type: 'log',
      level: 'info',
      message: `[Hook:${input.event}] ${matchedHooks.length} hook(s) matched`,
    });

    const outputs: HookOutput[] = [];

    for (const hook of matchedHooks) {
      const startTime = Date.now();
      emit({
        type: 'log',
        level: 'info',
        message: `[Hook:${input.event}] Running: ${hook.name} (${hook.type})`,
      });

      let output: HookOutput;

      try {
        switch (hook.type) {
          case 'command':
            output = await this.runCommand(hook, input);
            break;
          case 'script':
            output = await this.runScript(hook, input);
            break;
          case 'agent':
            output = await this.runAgent(hook, input, emit);
            break;
          case 'http':
            output = await this.runHttp(hook, input);
            break;
          default:
            output = {
              name: hook.name,
              decision: 'allow',
              reason: `Unknown hook type: ${hook.type}`,
              durationMs: 0,
            };
        }
      } catch (err) {
        output = {
          name: hook.name,
          decision: hook.failAction === 'fail' ? 'deny' : 'allow',
          reason: `Hook error: ${err}`,
          durationMs: Date.now() - startTime,
        };
      }

      output.durationMs = Date.now() - startTime;
      outputs.push(output);

      const icon =
        output.decision === 'allow' ? '✅' :
        output.decision === 'deny'  ? '❌' : '🔄';

      emit({
        type: 'log',
        level: output.decision === 'deny' ? 'warn' : 'info',
        message: `[Hook:${input.event}] ${icon} ${hook.name}: ${output.decision} (${output.durationMs}ms)${output.reason ? ` — ${output.reason.slice(0, 150)}` : ''}`,
      });
    }

    return this.mergeResults(outputs);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Merge multiple hook outputs — deny > modify > allow.
   * additionalContext and issues are accumulated from all hooks.
   */
  private mergeResults(outputs: HookOutput[]): HookResults {
    let finalDecision: 'allow' | 'deny' | 'modify' = 'allow';
    const mergedContext: string[] = [];
    const mergedIssues: string[] = [];
    let updatedInput: Record<string, unknown> | undefined;

    for (const output of outputs) {
      if (output.decision === 'deny') {
        finalDecision = 'deny';
      } else if (output.decision === 'modify' && finalDecision !== 'deny') {
        finalDecision = 'modify';
      }
      if (output.additionalContext) mergedContext.push(output.additionalContext);
      if (output.issues) mergedIssues.push(...output.issues);
      if (output.updatedInput) updatedInput = { ...updatedInput, ...output.updatedInput };
    }

    return {
      outputs,
      finalDecision,
      mergedContext: mergedContext.join('\n'),
      mergedIssues,
      updatedInput,
    };
  }

  /**
   * Get the string value to test the matcher regex against.
   * PostCode → modified file paths; PostPlan → plan summary; others → agentId.
   */
  private getMatchTarget(input: HookInput): string {
    if (Array.isArray(input.modifiedFiles)) {
      return (input.modifiedFiles as string[]).join(',');
    }
    if (input.plan && typeof (input.plan as Record<string, unknown>).summary === 'string') {
      return (input.plan as Record<string, unknown>).summary as string;
    }
    return typeof input.agentId === 'string' ? input.agentId : '';
  }

  // ─── Runner: command ──────────────────────────────────────────────────────

  private async runCommand(hook: HookDefinition, input: HookInput): Promise<HookOutput> {
    const { getExeca } = await import('../execa');
    const ex = await getExeca();

    // Template variable substitution
    let cmd = (hook.command ?? '').replace(
      /\{\{(\w+)\}\}/g,
      (_, key: string) => (key === 'projectDir' ? input.projectDir : key === 'taskId' ? input.taskId : ''),
    );

    const timeoutMs = (hook.timeout ?? 30) * 1000;

    const result = await ex(cmd, {
      shell: true,
      cwd: input.projectDir,
      reject: false,
      timeout: timeoutMs,
      stdin: 'pipe',
      input: JSON.stringify(input),
    } as any);

    const stdout = (String((result as any).stdout ?? '')).trim();
    const stderr  = (String((result as any).stderr  ?? '')).trim();
    const exitCode = Number((result as any).exitCode ?? 0);

    // exit 2 = deny
    if (exitCode === 2) {
      return { name: hook.name, decision: 'deny', reason: stderr || stdout, durationMs: 0 };
    }

    // JSON stdout → structured response
    if (stdout.startsWith('{')) {
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        return {
          name: hook.name,
          decision: (parsed.decision as 'allow' | 'deny' | 'modify') ?? 'allow',
          reason: parsed.reason as string | undefined,
          additionalContext: parsed.additionalContext as string | undefined,
          issues: parsed.issues as string[] | undefined,
          updatedInput: parsed.updatedInput as Record<string, unknown> | undefined,
          durationMs: 0,
          raw: stdout,
        };
      } catch {
        /* not JSON — treat as plain context text */
      }
    }

    // Plain text stdout → inject as additionalContext
    return {
      name: hook.name,
      decision: 'allow',
      additionalContext: stdout || undefined,
      reason: stderr || undefined,
      durationMs: 0,
    };
  }

  // ─── Runner: script ───────────────────────────────────────────────────────

  private async runScript(hook: HookDefinition, input: HookInput): Promise<HookOutput> {
    const { join } = await import('path');
    const scriptPath = join(input.projectDir, hook.path ?? '');

    return this.runCommand(
      { ...hook, type: 'command', command: `npx tsx "${scriptPath}"` },
      input,
    );
  }

  // ─── Runner: agent ────────────────────────────────────────────────────────

  private async runAgent(
    hook: HookDefinition,
    input: HookInput,
    emit: (e: PipelineEvent) => void,
  ): Promise<HookOutput> {
    const { getExeca } = await import('../execa');
    const { resolveCli } = await import('../cli-resolver');
    const { extractJson } = await import('../utils/json-extractor');
    const ex = await getExeca();

    // Build prompt
    const eventDataSnippet = JSON.stringify(input, null, 2).slice(0, 3000);
    const prompt = [
      hook.prompt ?? '',
      '',
      '## Event Data',
      eventDataSnippet,
      '',
      'Respond with ONLY valid JSON:',
      '{ "ok": true/false, "reason": "explanation", "issues": ["..."], "additionalContext": "context for next agent" }',
    ].join('\n');

    // Select CLI
    const llmPref = hook.llm ?? 'auto';
    let cliPath: string | null = null;

    if (llmPref === 'auto') {
      cliPath = await resolveCli('gemini') ?? await resolveCli('claude');
    } else {
      cliPath = await resolveCli(llmPref.replace(/-cli$/, ''));
    }

    if (!cliPath) {
      emit({
        type: 'log',
        level: 'warn',
        message: `[Hook:agent] No CLI available for hook "${hook.name}" — auto-passing`,
      });
      return { name: hook.name, decision: 'allow', reason: 'No CLI available, auto-pass', durationMs: 0 };
    }

    const isGemini = cliPath.includes('gemini');
    const args = isGemini
      ? ['-p', prompt]
      : ['-p', prompt, '--output-format', 'text', '--max-turns', '2', '--dangerously-skip-permissions'];

    const timeoutMs = (hook.timeout ?? 90) * 1000;

    const result = await ex(cliPath, args, {
      cwd: input.projectDir,
      reject: false,
      timeout: timeoutMs,
    } as any);

    const stdout = String((result as any).stdout ?? '');

    try {
      type AgentResponse = { ok: boolean; reason: string; issues: string[]; additionalContext: string };
      const parsed = extractJson<AgentResponse>(stdout, 'ok');
      return {
        name: hook.name,
        decision: parsed.ok ? 'allow' : 'deny',
        reason: parsed.reason,
        issues: parsed.issues,
        additionalContext: parsed.additionalContext,
        durationMs: 0,
        raw: stdout,
      };
    } catch {
      // Could not parse JSON — treat as allow with raw output as context
      return { name: hook.name, decision: 'allow', reason: stdout.slice(0, 300), durationMs: 0 };
    }
  }

  // ─── Runner: http ─────────────────────────────────────────────────────────

  private async runHttp(hook: HookDefinition, input: HookInput): Promise<HookOutput> {
    const timeoutMs = (hook.timeout ?? 10) * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Substitute env vars in headers
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      for (const [key, val] of Object.entries(hook.headers ?? {})) {
        headers[key] = val.replace(
          /\{\{env\.(\w+)\}\}/g,
          (_, name: string) => process.env[name] ?? '',
        );
      }

      const res = await fetch(hook.url ?? '', {
        method: hook.method ?? 'POST',
        headers,
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      const body = await res.text();

      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        return {
          name: hook.name,
          decision: (parsed.decision as 'allow' | 'deny' | 'modify') ?? (res.ok ? 'allow' : 'deny'),
          reason: parsed.reason as string | undefined,
          issues: parsed.issues as string[] | undefined,
          additionalContext: parsed.additionalContext as string | undefined,
          durationMs: 0,
        };
      } catch {
        return {
          name: hook.name,
          decision: res.ok ? 'allow' : 'deny',
          reason: body.slice(0, 300),
          durationMs: 0,
        };
      }
    } catch (err) {
      return { name: hook.name, decision: 'allow', reason: `HTTP error: ${err}`, durationMs: 0 };
    } finally {
      clearTimeout(timer);
    }
  }
}
