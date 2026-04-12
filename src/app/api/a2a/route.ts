import { NextResponse } from 'next/server';
import { getAutoDevAgentCard } from '@/lib/a2a/server';

/** GET /api/a2a → Agent Card (A2A discovery) */
export async function GET() {
  const baseUrl = process.env.AUTODEV_BASE_URL ?? 'http://localhost:3000';
  return NextResponse.json(getAutoDevAgentCard(baseUrl));
}

/** POST /api/a2a → A2A JSON-RPC endpoint */
export async function POST(req: Request) {
  const body = await req.json();
  const method = body.method as string | undefined;

  switch (method) {
    case 'tasks/send':
      // TODO: A2A task → AutoDev task 변환 + 실행
      return NextResponse.json({
        jsonrpc: '2.0',
        result: {
          id: body.params?.id ?? crypto.randomUUID(),
          sessionId: body.params?.sessionId ?? crypto.randomUUID(),
          status: { state: 'submitted', timestamp: new Date().toISOString() },
          messages: body.params?.message ? [body.params.message] : [],
          artifacts: [],
          history: [{ state: 'submitted', timestamp: new Date().toISOString() }],
        },
      });

    case 'tasks/get':
      // TODO: AutoDev task 상태 → A2A 형식 변환
      return NextResponse.json({
        jsonrpc: '2.0',
        result: {
          id: body.params?.id,
          status: { state: 'completed', timestamp: new Date().toISOString() },
          messages: [],
          artifacts: [],
          history: [],
        },
      });

    default:
      return NextResponse.json(
        { jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' } },
        { status: 404 },
      );
  }
}
