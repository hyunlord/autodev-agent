import { loadMcpConfig, type McpConfig, type McpServerConfig } from './prompt-loader';
import type { McpServerInfo } from '../plugins/interfaces';

export interface McpTool {
  name: string;
  description: string;
  serverId: string;
}

interface RunningServer {
  config: McpServerConfig;
  process?: any;
  status: 'starting' | 'running' | 'stopped' | 'error';
  tools: McpTool[];
  error?: string;
}

export class McpManager {
  private servers = new Map<string, RunningServer>();
  private config: McpConfig;

  constructor(projectDir?: string) {
    this.config = loadMcpConfig(projectDir);
  }

  getConfig(): McpConfig {
    return this.config;
  }

  getServerStatus(): Array<{ id: string; name: string; type: string; enabled: boolean; status: string; error?: string }> {
    return Object.entries(this.config.servers).map(([id, config]) => {
      const running = this.servers.get(id);
      return {
        id,
        name: id,
        type: config.type,
        enabled: config.enabled,
        status: running?.status ?? 'stopped',
        error: running?.error,
      };
    });
  }

  async startAll(): Promise<void> {
    for (const [id, config] of Object.entries(this.config.servers)) {
      if (!config.enabled) continue;
      await this.startServer(id, config);
    }
  }

  async startServer(id: string, config: McpServerConfig): Promise<void> {
    if (this.servers.has(id) && this.servers.get(id)!.status === 'running') {
      return;
    }

    this.servers.set(id, { config, status: 'starting', tools: [] });

    try {
      if (config.type === 'local' && config.command) {
        const { getExeca } = await import('../execa');
        const execa = await getExeca();

        const resolvedArgs = (config.args ?? []).map(arg =>
          arg.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? '')
        );

        const child = execa(config.command, resolvedArgs, {
          reject: false,
          env: { ...process.env },
          stdio: 'pipe',
        });

        this.servers.set(id, {
          config,
          process: child,
          status: 'running',
          tools: [{ name: id, description: `${id} MCP server`, serverId: id }],
        });
      } else if (config.type === 'remote' && config.url) {
        const resolvedHeaders: Record<string, string> = {};
        if (config.headers) {
          for (const [key, value] of Object.entries(config.headers)) {
            resolvedHeaders[key] = value.replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] ?? '');
          }
        }

        this.servers.set(id, {
          config: { ...config, headers: resolvedHeaders },
          status: 'running',
          tools: [{ name: id, description: `${id} MCP server (remote)`, serverId: id }],
        });
      }
    } catch (error) {
      this.servers.set(id, {
        config,
        status: 'error',
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async stopServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) return;

    if (server.process && typeof server.process.kill === 'function') {
      try { server.process.kill(); } catch { /* already dead */ }
    }

    this.servers.set(id, { ...server, status: 'stopped', process: undefined });
  }

  getToolsForStage(stage: 'planning' | 'coding' | 'verification'): McpTool[] {
    const serverIds = this.config.pipeline_mapping[stage] ?? [];
    const tools: McpTool[] = [];

    for (const id of serverIds) {
      const server = this.servers.get(id);
      if (server && server.status === 'running') {
        tools.push(...server.tools);
      }
    }

    return tools;
  }

  getServerConfig(id: string): McpServerConfig | undefined {
    return this.config.servers[id];
  }

  /**
   * Get MCP server info for a pipeline stage (config-based, no process required)
   */
  getServersForStage(stage: 'planning' | 'coding' | 'verification'): McpServerInfo[] {
    const serverIds = this.config.pipeline_mapping[stage] ?? [];
    const result: McpServerInfo[] = [];

    for (const id of serverIds) {
      const config = this.config.servers[id];
      if (!config || !config.enabled) continue;

      result.push({
        id,
        command: config.command,
        args: config.args,
        url: config.url,
        type: config.type,
      });
    }

    return result;
  }

  /**
   * Generate a prompt section describing available MCP tools for a stage
   */
  getMcpPromptSection(stage: 'planning' | 'coding' | 'verification'): string {
    const servers = this.getServersForStage(stage);
    if (servers.length === 0) return '';

    const lines = servers.map(s => {
      if (s.id === 'playwright') {
        return `- **Playwright MCP**: Browser automation. Navigate pages, click elements, take screenshots, check console errors. Use for UI verification.`;
      }
      if (s.id === 'context7') {
        return `- **Context7 MCP**: Up-to-date library documentation. Use "use context7" to fetch current docs for any library.`;
      }
      if (s.id === 'codex') {
        return `- **Codex MCP**: Code generation via OpenAI Codex. Available as an alternative coding tool.`;
      }
      if (s.id === 'firecrawl') {
        return `- **Firecrawl MCP**: Web scraping and crawling. Extract content from external websites.`;
      }
      if (s.id === 'github') {
        return `- **GitHub MCP**: Repository management. Search code, manage issues and PRs.`;
      }
      if (s.id === 'websearch') {
        return `- **Web Search MCP**: Search the web for current information via Exa.`;
      }
      return `- **${s.id} MCP**: Available MCP server.`;
    });

    return `\n## Available MCP Tools\nThe following MCP tools are available for this stage:\n${lines.join('\n')}\nUse these tools when they would help complete the task more effectively.\n`;
  }

  async shutdown(): Promise<void> {
    for (const id of this.servers.keys()) {
      await this.stopServer(id);
    }
    this.servers.clear();
  }
}
