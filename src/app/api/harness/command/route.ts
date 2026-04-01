import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { resolveCli } from '@/lib/cli-resolver';

export async function POST(req: Request) {
  const { command, cliMode, projectDir } = await req.json();

  if (!command) {
    return NextResponse.json({ error: 'command required' }, { status: 400 });
  }

  const autodevDir = projectDir
    ? join(projectDir, '.autodev')
    : join(homedir(), '.autodev');

  // 현재 .autodev/ 상태를 컨텍스트로 읽기
  const currentState: Record<string, string> = {};
  const agentFiles = ['planner.md', 'coder.md', 'verifier.md', 'evaluator.md'];
  for (const f of agentFiles) {
    const p = join(autodevDir, 'agents', f);
    if (existsSync(p)) currentState[`agents/${f}`] = readFileSync(p, 'utf-8');
  }
  const mcpPath = join(autodevDir, 'mcp', 'config.json');
  if (existsSync(mcpPath)) currentState['mcp/config.json'] = readFileSync(mcpPath, 'utf-8');
  const configPath = join(autodevDir, 'config.yaml');
  if (existsSync(configPath)) currentState['config.yaml'] = readFileSync(configPath, 'utf-8');

  const prompt = `You are a harness configuration assistant. The user wants to change the AutoDev harness settings.

Current .autodev/ state:
${Object.entries(currentState).map(([k, v]) => `--- ${k} ---\n${v}`).join('\n\n')}

${Object.keys(currentState).length === 0 ? 'No .autodev/ files exist yet. Use defaults.' : ''}

User request: ${command}

Respond with ONLY valid JSON. The response must list file changes:
{
  "changes": [
    {
      "file": "agents/planner.md" | "agents/coder.md" | "agents/verifier.md" | "agents/evaluator.md" | "mcp/config.json" | "config.yaml",
      "action": "create" | "modify" | "delete",
      "content": "full file content (for create/modify)"
    }
  ],
  "summary": "One-line summary of what was changed"
}

Rules:
- Modify only the specific setting requested
- Keep all existing content intact unless explicitly asked to remove
- For mcp/config.json: maintain valid JSON with servers + pipeline_mapping structure
- For agents/*.md: maintain frontmatter (---) + body structure
- For config.yaml: maintain valid YAML
- For "delete" action, content is not needed
- If the request is unclear, make a reasonable interpretation`;

  const startTime = Date.now();
  try {
    const { getExeca } = await import('@/lib/execa');
    const execa = await getExeca();

    let stdout = '';
    const mode = cliMode ?? 'claude-cli';

    if (mode === 'claude-cli') {
      const cliPath = await resolveCli('claude');
      if (!cliPath) return NextResponse.json({ error: 'Claude CLI not found' }, { status: 500 });
      const result = await execa(cliPath, ['-p', prompt, '--output-format', 'text', '--max-turns', '3'], {
        timeout: 60_000,
        reject: false,
        env: { ...process.env },
      }) as { stdout: string };
      stdout = result.stdout;
    } else if (mode === 'gemini-cli') {
      const cliPath = await resolveCli('gemini');
      if (!cliPath) return NextResponse.json({ error: 'Gemini CLI not found' }, { status: 500 });
      const result = await execa(cliPath, ['-p', prompt, '--output-format', 'json', '-y'], {
        timeout: 60_000,
        reject: false,
        env: { ...process.env },
      }) as { stdout: string };
      stdout = result.stdout;
      try {
        const parsed = JSON.parse(stdout);
        stdout = parsed.response ?? parsed.result ?? parsed.text ?? stdout;
      } catch { /* use raw */ }
    } else if (mode === 'codex-cli') {
      const cliPath = await resolveCli('codex');
      if (!cliPath) return NextResponse.json({ error: 'Codex CLI not found', durationMs: Date.now() - startTime }, { status: 500 });
      const result = await execa(cliPath, ['exec', prompt, '--full-auto', '--json'], {
        timeout: 60_000, reject: false, env: { ...process.env },
      }) as { stdout: string };
      stdout = result.stdout;
      try {
        const lines = stdout.trim().split('\n').filter(Boolean);
        for (const line of lines.reverse()) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.result || parsed.text) {
              stdout = parsed.result ?? parsed.text ?? stdout;
              break;
            }
          } catch { continue; }
        }
      } catch { /* use raw */ }
    } else if (mode === 'api') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json() as { content?: Array<{ text?: string }> };
      stdout = data.content?.[0]?.text ?? '';
    }

    // LLM 응답 파싱
    const cleaned = stdout.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse LLM response', raw: stdout.slice(0, 500) }, { status: 500 });
    }

    const result = JSON.parse(jsonMatch[0]) as {
      changes?: Array<{ file: string; action: string; content?: string }>;
      summary?: string;
    };

    // 변경 사항 적용
    const applied: string[] = [];
    for (const change of result.changes ?? []) {
      const filePath = join(autodevDir, change.file);
      const dir = filePath.substring(0, filePath.lastIndexOf('/'));

      if (change.action === 'delete') {
        if (existsSync(filePath)) {
          unlinkSync(filePath);
          applied.push(`Deleted ${change.file}`);
        }
      } else {
        mkdirSync(dir, { recursive: true });
        writeFileSync(filePath, change.content ?? '', 'utf-8');
        applied.push(`${change.action === 'create' ? 'Created' : 'Modified'} ${change.file}`);
      }
    }

    return NextResponse.json({
      success: true,
      summary: result.summary,
      changes: applied,
      cliMode: mode,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
