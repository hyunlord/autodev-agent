import { NextResponse } from 'next/server';
import { execa } from 'execa';

export async function GET() {
  let claudeCode = false;
  try {
    const { stdout } = await execa('claude', ['--version'], { reject: false, timeout: 5000 });
    claudeCode = stdout.includes('claude');
  } catch {}

  return NextResponse.json({
    claudeCode,
    timestamp: new Date().toISOString(),
  });
}
