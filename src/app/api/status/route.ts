import { NextResponse } from 'next/server';
import { resolveCli } from '@/lib/cli-resolver';

export async function GET() {
  const claudePath = await resolveCli('claude');

  return NextResponse.json({
    claudeCode: !!claudePath,
    claudeCodePath: claudePath,
    timestamp: new Date().toISOString(),
  });
}
