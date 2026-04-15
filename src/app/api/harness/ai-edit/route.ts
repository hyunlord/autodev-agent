import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { currentPrompt, instruction, role } = await req.json();

  if (!currentPrompt || !instruction) {
    return NextResponse.json({ error: 'currentPrompt and instruction required' }, { status: 400 });
  }

  const { getExeca } = await import('@/lib/execa');
  const { resolveCli } = await import('@/lib/cli-resolver');
  const execa = await getExeca();

  const editPrompt = `You are editing an AI agent's system prompt for the "${role ?? 'agent'}" role.

CURRENT PROMPT:
${currentPrompt}

USER INSTRUCTION:
${instruction}

Apply the user's instruction to modify the prompt. Keep the overall structure but incorporate the requested changes. Output ONLY the modified prompt text, no explanations or markdown fences.`;

  try {
    const cliPath = await resolveCli('gemini');
    if (!cliPath) {
      return NextResponse.json({ error: 'Gemini CLI not available. Install with: npm i -g @anthropic-ai/claude-code' }, { status: 500 });
    }

    const { stdout } = await execa(cliPath, ['-p', editPrompt], {
      timeout: 60_000,
      env: { ...process.env },
    });

    const result = stdout.trim();
    if (!result) {
      return NextResponse.json({ error: 'AI returned empty response' }, { status: 500 });
    }

    return NextResponse.json({ editedPrompt: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'AI edit failed' }, { status: 500 });
  }
}
