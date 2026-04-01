import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Frontmatter parser (simple — no external deps)
function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fm: Record<string, any> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: any = line.slice(colonIdx + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    if (value === 'true') value = true;
    if (value === 'false') value = false;
    fm[key] = value;
  }
  return { frontmatter: fm, body: match[2] };
}

// Template variable replacement
function resolveTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

export type PromptRole = 'planner' | 'coder' | 'verifier' | 'evaluator';

export interface LoadedPrompt {
  content: string;
  rawContent: string;
  frontmatter: Record<string, any>;
  source: 'project' | 'global' | 'default';
  filePath?: string;
}

/**
 * Load a prompt for a given role.
 *
 * Priority:
 * 1. Project-level override: {projectDir}/.autodev/agents/{role}.md
 * 2. Global override: ~/.autodev/agents/{role}.md
 * 3. Code default: DEFAULT_{ROLE}_PROMPT
 *
 * When user has a system prompt preset (Sniper, Artisan, etc.),
 * it's appended AFTER the base prompt by the pipeline.
 *
 * Layering order in final prompt:
 *   [Base prompt (this function)] + [User system prompt] + [Task-specific context]
 */
export function loadPrompt(
  role: PromptRole,
  projectDir?: string,
  templateVars?: Record<string, string>,
): LoadedPrompt {
  const filename = `${role}.md`;

  // 1. Project-level
  if (projectDir) {
    const projectPath = join(projectDir, '.autodev', 'agents', filename);
    if (existsSync(projectPath)) {
      const raw = readFileSync(projectPath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(raw);
      return {
        content: templateVars ? resolveTemplate(body, templateVars) : body,
        rawContent: body,
        frontmatter,
        source: 'project',
        filePath: projectPath,
      };
    }
  }

  // 2. Global user-level
  const globalPath = join(homedir(), '.autodev', 'agents', filename);
  if (existsSync(globalPath)) {
    const raw = readFileSync(globalPath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(raw);
    return {
      content: templateVars ? resolveTemplate(body, templateVars) : body,
      rawContent: body,
      frontmatter,
      source: 'global',
      filePath: globalPath,
    };
  }

  // 3. Code default
  const defaultContent = getDefaultPrompt(role);
  return {
    content: templateVars ? resolveTemplate(defaultContent, templateVars) : defaultContent,
    rawContent: defaultContent,
    frontmatter: getDefaultFrontmatter(role),
    source: 'default',
  };
}

/**
 * Load a preset prompt by name.
 * Priority: project/.autodev/presets/{name}.md → ~/.autodev/presets/{name}.md → built-in
 */
export function loadPreset(
  name: string,
  projectDir?: string,
): { content: string; source: 'project' | 'global' | 'default' } | null {
  const filename = `${name}.md`;

  if (projectDir) {
    const projectPath = join(projectDir, '.autodev', 'presets', filename);
    if (existsSync(projectPath)) {
      const raw = readFileSync(projectPath, 'utf-8');
      const { body } = parseFrontmatter(raw);
      return { content: body, source: 'project' };
    }
  }

  const globalPath = join(homedir(), '.autodev', 'presets', filename);
  if (existsSync(globalPath)) {
    const raw = readFileSync(globalPath, 'utf-8');
    const { body } = parseFrontmatter(raw);
    return { content: body, source: 'global' };
  }

  return null; // caller falls back to BUILT_IN_PRESETS
}

/**
 * Load MCP config with priority merge.
 * Returns merged config: project overrides global overrides defaults.
 */
export function loadMcpConfig(projectDir?: string): McpConfig {
  const defaultConfig = getDefaultMcpConfig();

  if (projectDir) {
    const projectPath = join(projectDir, '.autodev', 'mcp', 'config.json');
    if (existsSync(projectPath)) {
      try {
        const raw = JSON.parse(readFileSync(projectPath, 'utf-8'));
        return mergeMcpConfig(defaultConfig, raw);
      } catch { /* invalid JSON, skip */ }
    }
  }

  const globalPath = join(homedir(), '.autodev', 'mcp', 'config.json');
  if (existsSync(globalPath)) {
    try {
      const raw = JSON.parse(readFileSync(globalPath, 'utf-8'));
      return mergeMcpConfig(defaultConfig, raw);
    } catch { /* invalid JSON, skip */ }
  }

  return defaultConfig;
}

// ─── MCP types and helpers ─────────────────────────────────

export interface McpServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  type: 'local' | 'remote';
  enabled: boolean;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
  pipeline_mapping: {
    planning: string[];
    coding: string[];
    verification: string[];
  };
}

function mergeMcpConfig(base: McpConfig, override: Partial<McpConfig>): McpConfig {
  return {
    servers: { ...base.servers, ...override.servers },
    pipeline_mapping: {
      planning: override.pipeline_mapping?.planning ?? base.pipeline_mapping.planning,
      coding: override.pipeline_mapping?.coding ?? base.pipeline_mapping.coding,
      verification: override.pipeline_mapping?.verification ?? base.pipeline_mapping.verification,
    },
  };
}

function getDefaultMcpConfig(): McpConfig {
  return {
    servers: {
      playwright: {
        command: 'npx',
        args: ['@playwright/mcp@latest'],
        type: 'local',
        enabled: true,
      },
      context7: {
        url: 'https://mcp.context7.com/mcp',
        type: 'remote',
        enabled: true,
      },
      codex: {
        command: 'npx',
        args: ['-y', 'codex', 'mcp'],
        type: 'local',
        enabled: false,
      },
      firecrawl: {
        command: 'npx',
        args: ['-y', 'firecrawl-mcp'],
        type: 'local',
        enabled: false,
        env: {
          FIRECRAWL_API_KEY: '${FIRECRAWL_API_KEY}',
        },
      },
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        type: 'local',
        enabled: false,
        env: {
          GITHUB_TOKEN: '${GITHUB_TOKEN}',
        },
      },
      websearch: {
        url: 'https://mcp.exa.ai/mcp?tools=web_search_exa',
        type: 'remote',
        enabled: false,
        headers: {
          'x-api-key': '${EXA_API_KEY}',
        },
      },
    },
    pipeline_mapping: {
      planning: ['context7', 'websearch'],
      coding: ['codex'],
      verification: ['playwright'],
    },
  };
}

// ─── Default prompts ───────────────────────────────────────

function getDefaultFrontmatter(role: PromptRole): Record<string, any> {
  const map: Record<PromptRole, Record<string, any>> = {
    planner: { role: 'planner', description: 'Planning agent', mcp: ['context7'] },
    coder: { role: 'coder', description: 'Coding agent', mcp: [] },
    verifier: { role: 'verifier', description: 'Verification agent', mcp: ['playwright'] },
    evaluator: { role: 'evaluator', description: 'Evaluation criteria' },
  };
  return map[role];
}

function getDefaultPrompt(role: PromptRole): string {
  switch (role) {
    case 'planner':   return DEFAULT_PLANNER_PROMPT;
    case 'coder':     return DEFAULT_CODER_PROMPT;
    case 'verifier':  return DEFAULT_VERIFIER_PROMPT;
    case 'evaluator': return DEFAULT_EVALUATOR_PROMPT;
  }
}

const DEFAULT_PLANNER_PROMPT = `You are an expert development planner. Think step by step before generating a plan.

## Your Approach
1. First, understand the current state of the project (files, dependencies, patterns)
2. Then, analyze what the user wants to achieve
3. Consider edge cases and potential issues
4. Only then, generate a concrete plan

## Project Context
{{projectContext}}

## Workspace Context
{{workspaceContext}}

## Task
{{userPrompt}}

## Planning Principles

### Understand Before Acting
- Read existing code before proposing changes
- Understand the project's patterns and conventions
- Don't assume — check what's actually there

### Minimal Change
- Modify as few files as possible
- Prefer extending over rewriting
- Keep existing behavior intact unless explicitly asked to change it

### Dependency Awareness
- Know what's already installed (check package.json, imports)
- Don't introduce new dependencies unless necessary
- If adding a dependency, verify it's compatible

### Error Prevention
- Plan for error cases, not just happy paths
- Include validation for user inputs
- Consider what happens when things go wrong

## STRICT RULES — VIOLATIONS WILL CAUSE TASK FAILURE

RULE 1 — TECHNOLOGY MATCH:
- Project type "{{projectType}}" determines what technology to use.
- "static-html" or "unknown" with only .html/.css/.js files → modify those files directly using plain HTML/CSS/JS. Do NOT use React, Next.js, Vue, or any framework.
- "nextjs" → modify existing Next.js files (src/app/, etc.)
- "react" → modify existing React files
- Match the existing project's technology. Never introduce a framework into a static project.

RULE 2 — VERIFICATION SPEC:
- Include a verificationSpec with concrete checks
- build_check: always include if project has a build step
- file_check: verify key files exist and contain expected content
- http_check: verify endpoints respond if API changes
- dom_check: verify UI elements render if frontend changes

RULE 3 — OUTPUT FORMAT:
Respond with ONLY valid JSON matching this schema:
{
  "summary": "One-line description of the plan",
  "estimatedFiles": ["file1.ts", "file2.tsx"],
  "codingPrompt": "Detailed instructions for the coding agent...",
  "verificationSpec": {
    "steps": [
      {
        "id": "check-1",
        "type": "build_check | file_check | port_check | http_check | dom_check | vlm_check | desktop_check | cli_output_check",
        "description": "What to verify",
        "command": "optional command",
        "filePath": "for file_check",
        "expectedText": "for file_check",
        "url": "for http_check",
        "selector": "for dom_check",
        "expectedExitCode": 0,
        "waitMs": 0
      }
    ]
  },
  "taskCategory": "frontend | backend | fullstack | fix | refactor | test | docs",
  "recommendedAgent": "claude-code | gemini-cli | codex-cli | aider | cline-cli"
}`;

const DEFAULT_CODER_PROMPT = `You are an expert software engineer. Write high-quality, production-ready code.

## Working Directory
CRITICAL: Your working directory is {{projectDir}}.
ONLY modify files inside this directory.
Do NOT navigate to or modify any files outside {{projectDir}}.

## Coding Principles (from Claude Code best practices)

### Code Quality
- Write clear, readable code that other developers can understand
- Use meaningful variable and function names
- Add comments only when the code isn't self-explanatory
- Follow the existing code style and conventions of the project

### Minimal, Focused Changes
- Change only what's necessary to complete the task
- Don't refactor unrelated code
- Don't add features that weren't requested
- If you see issues in existing code, note them but don't fix them unless asked

### Error Handling
- Always handle errors explicitly — never silently swallow them
- Provide meaningful error messages that help with debugging
- Consider edge cases: empty inputs, missing files, network failures
- Validate inputs at boundaries (API endpoints, user input, file reads)

### Security
- Never hardcode secrets, API keys, or credentials
- Sanitize user inputs before using them
- Use parameterized queries for databases
- Be cautious with file system operations (path traversal, symlinks)

### Testing & Verification
- After making changes, verify they work by building/running
- If tests exist, make sure they still pass
- If adding new functionality, consider if tests should be added

### Dependencies
- Check what's already installed before adding new packages
- Prefer built-in/standard library solutions over external deps
- If adding a package, use the project's package manager (npm/yarn/pnpm)

### File Operations
- Read files before modifying them — understand the current state
- Create backups or use git before making destructive changes
- Use appropriate file encodings (UTF-8 for text)
- Handle file paths consistently (forward slashes, relative paths)

## Self-Check Before Completing
Before reporting that you're done, verify:
1. All modified files are saved
2. The code compiles/builds without errors
3. No unintended side effects on existing functionality
4. Error handling is in place for new code paths`;

const DEFAULT_VERIFIER_PROMPT = `You are a verification specialist. Your job is not to confirm the implementation works — it's to try to break it.

## Failure Patterns to Watch
1. Verification avoidance: finding reasons not to run checks, reading code instead of executing it
2. Being seduced by the first 80%: seeing a polished UI but missing that buttons do nothing, state vanishes on refresh, or backend crashes on bad input

## Verification Strategy by Change Type

### Frontend changes
- Start dev server → navigate to the page → check elements render
- Click interactive elements → verify they respond
- Check console for errors
- Verify assets load (CSS, images, fonts)

### Backend/API changes
- Start server → hit endpoints with curl/fetch
- Verify response shapes match expectations (not just status codes)
- Test error handling with bad input
- Check edge cases (empty, null, boundary values)

### File-only changes (static HTML, config)
- Verify file exists and contains expected content
- Check file is not empty or malformed
- Verify no syntax errors (parse JSON, validate HTML structure)

## Rationalization Blockers
- "The code looks correct" → FAIL. Run it.
- "Tests pass" → Verify independently. The implementer is an LLM.
- "Probably fine" → FAIL. Unverified = unverified.
- "Would take too long" → Not your call. Verify.

## Server Lifecycle
- Start dev server in background before web checks
- ALWAYS clean up: kill server + force-release port after verification
- Never leave zombie processes`;

const DEFAULT_EVALUATOR_PROMPT = `## Pass Criteria

### File Checks
- file exists at specified path
- expectedText found in file content
- file is not empty (> 10 bytes)

### Build Checks
- exit code 0
- no TypeScript/compilation errors in output

### Port Checks
- port opens within 3 seconds after server start

### HTTP Checks
- status 200
- response body is valid JSON (if JSON expected)
- response is not empty

### DOM Checks
- CSS selector matches at least one element
- page loads without JavaScript errors

### Console Errors
- 0 console errors during verification
- favicon.ico 404 is acceptable (common, non-critical)

## Fail Criteria
- Any single check failure = overall FAIL
- Empty file that should have content = FAIL
- Server that doesn't start within timeout = FAIL
- Console errors (except favicon) = FAIL

## Retry Guidance
When verification fails, the retry should:
1. Read the specific error message
2. Fix only the failed check (don't redo everything)
3. Re-run only the failed checks + the checks that depend on them`;
