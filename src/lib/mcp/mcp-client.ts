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
  timeout?: number; // ms, default 30000
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

    const log = (msg: string) =>
      emit?.({ type: 'log', level: 'info', message: msg } as PipelineEvent);

    try {
      log(`[MCP] Connecting to ${config.id}...`);

      const client = new Client({ name: 'autodev-agent', version: '1.0.0' });
      let transport: any;

      if (config.type === 'local' && config.command) {
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env: { ...process.env, ...config.env } as Record<string, string>,
        });
      } else if (config.type === 'remote' && config.url) {
        const { StreamableHTTPClientTransport } = await import(
          '@modelcontextprotocol/sdk/client/streamableHttp.js'
        );
        transport = new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: {
            headers: config.headers ?? {},
          },
        });
      } else {
        throw new Error(
          `Invalid MCP config for ${config.id}: need command (local) or url (remote)`,
        );
      }

      await client.connect(transport);
      log(`[MCP] Connected to ${config.id}`);

      const toolsResult = await client.listTools();
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
      const errMsg = err instanceof Error ? err.message : String(err);
      log(`[MCP] Failed to connect to ${config.id}: ${errMsg}`);
      return [];
    }
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
