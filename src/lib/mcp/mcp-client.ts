import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { PipelineEvent } from '../types';

export interface McpClientServerConfig {
  id: string;
  type: 'local' | 'remote';
  // local (stdio)
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // remote (HTTP)
  url?: string;
  headers?: Record<string, string>;
  // common
  enabled: boolean;
  timeout?: number; // ms, connect timeout (default 120000)
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
  serverId: string;
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

export class McpClient {
  private connections = new Map<string, { client: Client; transport: any; tools: McpToolInfo[] }>();

  /**
   * 서버에 연결하고 도구 목록을 가져옴
   */
  async connect(
    config: McpClientServerConfig,
    emit?: (e: PipelineEvent) => void,
  ): Promise<McpToolInfo[]> {
    if (this.connections.has(config.id)) {
      return this.connections.get(config.id)!.tools;
    }

    const log = (msg: string, level: 'info' | 'warn' = 'info') =>
      emit?.({ type: 'log', level, message: msg } as PipelineEvent);

    // 기본 2분 timeout (npx의 패키지 다운로드 + Chromium 초기화 대비)
    const timeout = config.timeout ?? 120_000;

    // local stdio transport는 일회성이므로 재시도 시 새로 생성해야 함
    const buildTransport = async (): Promise<any> => {
      if (config.type === 'local' && config.command) {
        return new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env: { ...process.env, ...config.env } as Record<string, string>,
        });
      }
      if (config.type === 'remote' && config.url) {
        const { StreamableHTTPClientTransport } = await import(
          '@modelcontextprotocol/sdk/client/streamableHttp.js'
        );
        return new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: {
            headers: config.headers ?? {},
          },
        });
      }
      throw new Error(
        `Invalid MCP config for ${config.id}: need command (local) or url (remote)`,
      );
    };

    const maxAttempts = config.type === 'local' ? 2 : 1;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const client = new Client({ name: 'autodev-agent', version: '1.0.0' });
      let transport: any;
      try {
        log(
          attempt === 1
            ? `[MCP] Connecting to ${config.id} (timeout: ${timeout}ms)...`
            : `[MCP] Retrying connection to ${config.id} (attempt ${attempt}/${maxAttempts})...`,
        );

        transport = await buildTransport();

        // SDK Client.connect()의 두 번째 인자로 RequestOptions를 전달 (timeout 지원)
        await client.connect(transport, { timeout });
        log(`[MCP] Connected to ${config.id}`);

        const toolsResult = await client.listTools(undefined, { timeout });
        const tools: McpToolInfo[] = (toolsResult.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema,
          serverId: config.id,
        }));

        log(
          `[MCP] ${config.id}: ${tools.length} tools available — ${tools.map((t) => t.name).join(', ')}`,
        );

        this.connections.set(config.id, { client, transport, tools });
        return tools;
      } catch (err) {
        lastErr = err;
        const errMsg = err instanceof Error ? err.message : String(err);
        log(
          `[MCP] Connection attempt ${attempt}/${maxAttempts} to ${config.id} failed: ${errMsg}`,
          'warn',
        );
        // 실패한 transport/client는 정리 시도 (실패해도 무시)
        try { await client.close(); } catch { /* ignore */ }
      }
    }

    const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    log(`[MCP] Failed to connect to ${config.id}: ${errMsg}`, 'warn');
    return [];
  }

  /**
   * MCP 도구 호출
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    emit?: (e: PipelineEvent) => void,
  ): Promise<McpToolResult> {
    const conn = this.connections.get(serverId);
    if (!conn) {
      throw new Error(`MCP server ${serverId} not connected`);
    }

    emit?.({
      type: 'log',
      level: 'info',
      message: `[MCP] Calling ${serverId}/${toolName}`,
    } as PipelineEvent);

    try {
      const result = await conn.client.callTool({ name: toolName, arguments: args });

      const content = ((result.content ?? []) as any[]).map((c: any) => {
        if (c.type === 'text' && c.text && c.text.length > 10000) {
          return { ...c, text: c.text.slice(0, 10000) + '\n...[truncated]' };
        }
        return c;
      });

      emit?.({
        type: 'log',
        level: 'info',
        message: `[MCP] ${serverId}/${toolName} → ${content.length} content block(s)`,
      } as PipelineEvent);

      return { content, isError: (result.isError as boolean | undefined) ?? false };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      emit?.({
        type: 'log',
        level: 'warn',
        message: `[MCP] ${serverId}/${toolName} error: ${errMsg}`,
      } as PipelineEvent);
      return { content: [{ type: 'text', text: `Error: ${errMsg}` }], isError: true };
    }
  }

  getAllTools(): McpToolInfo[] {
    const tools: McpToolInfo[] = [];
    for (const conn of this.connections.values()) {
      tools.push(...conn.tools);
    }
    return tools;
  }

  getToolsForServer(serverId: string): McpToolInfo[] {
    return this.connections.get(serverId)?.tools ?? [];
  }

  isConnected(serverId: string): boolean {
    return this.connections.has(serverId);
  }

  async disconnectAll(): Promise<void> {
    for (const [, conn] of this.connections) {
      try {
        await conn.client.close();
      } catch { /* ignore */ }
    }
    this.connections.clear();
  }

  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (conn) {
      try { await conn.client.close(); } catch { /* ignore */ }
      this.connections.delete(serverId);
    }
  }
}
