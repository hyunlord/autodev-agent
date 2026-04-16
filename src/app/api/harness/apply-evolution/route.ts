import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

const ALLOWED_ROLES = ['planner', 'coder', 'verifier', 'evaluator', 'debate-drafter', 'debate-challenger'];

interface Suggestion {
  id: string;
  title: string;
  ruleText: string;
  selected: boolean;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { role, suggestions, projectDir } = body;

    if (!role || !Array.isArray(suggestions)) {
      return NextResponse.json({ error: 'role and suggestions are required' }, { status: 400 });
    }

    // Validate role against allowlist to prevent path traversal
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: `Invalid role: ${role}` }, { status: 400 });
    }

    const selected = (suggestions as Suggestion[]).filter(s => s.selected);
    if (selected.length === 0) {
      return NextResponse.json({ error: '선택된 제안이 없습니다.' }, { status: 400 });
    }

    // Determine file path with path traversal protection
    const baseDir = projectDir
      ? join(resolve(projectDir), '.autodev')
      : join(homedir(), '.autodev');
    const agentsDir = join(baseDir, 'agents');
    const filePath = join(agentsDir, `${role}.md`);

    // Verify resolved path stays within .autodev/agents/
    if (!filePath.startsWith(agentsDir)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Load existing content or start empty
    let content = '';
    if (existsSync(filePath)) {
      content = readFileSync(filePath, 'utf-8');
    }

    // Build new section
    const date = new Date().toISOString().split('T')[0];
    const newRules = selected.map(s => `- **${s.title}**: ${s.ruleText}`).join('\n');
    const section = `\n\n## Rules learned from history (${date})\n\n${newRules}\n`;

    // Append
    content = content + section;

    // Ensure directory exists and write
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(filePath, content, 'utf-8');

    return NextResponse.json({
      success: true,
      appliedCount: selected.length,
      filePath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
