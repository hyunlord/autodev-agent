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
 * Load a prompt for a given role with priority merge:
 * 1. project/.autodev/agents/{role}.md
 * 2. ~/.autodev/agents/{role}.md
 * 3. built-in default
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

const DEFAULT_PLANNER_PROMPT = `You are a development planning assistant. Generate a JSON plan for modifying an EXISTING project.

## Project Context
{{projectContext}}

## Workspace Context
{{workspaceContext}}

## Task
{{userPrompt}}

## STRICT RULES — VIOLATIONS WILL CAUSE TASK FAILURE

RULE 1 — TECHNOLOGY MATCH:
- Project type "{{projectType}}" determines what technology to use.
- "static-html" or "unknown" with only .html/.css/.js files → modify those files directly using plain HTML/CSS/JS. Do NOT use React, Next.js, Vue, or any framework.
- "nextjs" → modify existing Next.js files (src/app/, etc.)
- "react" → modify existing React files
- If the workspace has index.html and no package.json, the ONLY correct approach is to edit index.html.

RULE 2 — NO NEW PROJECTS:
- NEVER create a new project structure (no npx create-next-app, no npm init, no framework scaffolding).
- NEVER create src/app/, src/components/, or similar framework directories unless they already exist.
- Modify ONLY files that already exist, or create new files that match the existing technology.

RULE 3 — FILE PATHS:
- Use ONLY relative paths (./index.html, ./styles.css).
- NEVER use absolute paths (/Users/..., /home/...).
- The coding agent's working directory is already set to the project root.

RULE 4 — CODING PROMPT CONTENT:
- The codingPrompt must name the EXACT files to modify (from the file list above).
- If the task says "이 페이지" or "this page", it refers to the existing HTML/page file in the workspace, NOT some external application.
- Include specific code changes (what to add, where to add it).
- Tell the agent to keep all existing functionality intact.

RULE 5 — VERIFICATION:
- If project has no package.json: use file_check ONLY. No build_check, no port_check, no http_check.
- file_check must use filePath AND expectedText to verify the change was actually made.
- For HTML files, expectedText should check for the new feature (e.g., a button class, a CSS property).

RULE 6 — LANGUAGE:
- The "summary" field must be in the SAME language as the user's task description.
- If the task is in Korean, summary must be in Korean.
- If the task is in English, summary must be in English.
- The "codingPrompt" should stay in English (better for coding agents).
- Verification step descriptions should be in English (for consistency).

Respond with ONLY valid JSON:
{
  "summary": "One-line summary",
  "taskCategory": "html-css",
  "recommendedAgent": "claude-code",
  "codingPrompt": "Specific instructions referencing exact files from the workspace",
  "estimatedFiles": ["index.html"],
  "verificationSpec": {
    "steps": [
      {"id": "v1", "description": "index.html contains dark mode toggle", "type": "file_check", "filePath": "index.html", "expectedText": "dark-mode"}
    ]
  }
}

AGENT RECOMMENDATION:
Available agents: claude-code, gemini-cli, codex-cli, aider, cline-cli
Choose the best agent for this task based on these guidelines:
- "claude-code": Best for complex tasks, multi-file changes, architecture work, debugging. Most capable but slower.
- "gemini-cli": Good for quick tasks, simple HTML/CSS, documentation, small changes. Fast.
- "codex-cli": Good for code generation, algorithm implementation, full-stack work. Strong reasoning.
- "aider": Good for refactoring, code review, incremental changes to existing code.
- "cline-cli": General purpose, good for varied tasks.
Set recommendedAgent to the agent id that best fits this specific task.

TASK CATEGORY (set taskCategory):
- "quick-fix": Typo, one-line change, simple rename
- "html-css": Web page styling, UI, static HTML work
- "full-stack": Multi-file, backend+frontend, complex architecture
- "refactor": Code restructuring without behavior change
- "new-project": Creating something from scratch
- "debug": Fixing errors, troubleshooting
- "docs": Documentation, README, comments`;

const DEFAULT_CODER_PROMPT = `CRITICAL: Your working directory is {{projectDir}}.
ONLY modify files inside this directory.
Do NOT navigate to or modify any files outside {{projectDir}}.
All paths must be relative to the current directory.`;

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
