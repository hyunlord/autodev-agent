import { loadMcpConfig } from '@/lib/harness/prompt-loader';
import { NextResponse } from 'next/server';

export async function GET() {
  const config = loadMcpConfig();

  const servers = Object.entries(config.servers).map(([id, server]) => ({
    id,
    type: server.type,
    enabled: server.enabled,
    url: server.url,
    command: server.command,
    args: server.args,
    stages: Object.entries(config.pipeline_mapping)
      .filter(([, ids]) => ids.includes(id))
      .map(([stage]) => stage),
  }));

  return NextResponse.json({
    servers,
    pipeline_mapping: config.pipeline_mapping,
  });
}
