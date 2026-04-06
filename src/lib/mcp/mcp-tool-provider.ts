import type { McpClient, McpToolInfo } from './mcp-client';
import type { VerifyTool, VerifyToolResult } from '../../agents/interfaces';

/**
 * MCP 도구를 VerifyTool 인터페이스로 변환
 * → Verify Agent가 MCP 도구를 자기 도구처럼 사용 가능
 */
export function mcpToolsAsVerifyTools(
  mcpClient: McpClient,
  serverFilter?: string[],
): VerifyTool[] {
  const allTools = serverFilter
    ? mcpClient.getAllTools().filter((t) => serverFilter.includes(t.serverId))
    : mcpClient.getAllTools();

  return allTools.map((tool) => ({
    name: `mcp_${tool.serverId}_${tool.name}`,
    description: `[MCP:${tool.serverId}] ${tool.description}`,
    async execute(params: Record<string, unknown>): Promise<VerifyToolResult> {
      try {
        const result = await mcpClient.callTool(tool.serverId, tool.name, params);
        const text = result.content.map((c) => c.text ?? `[${c.type}]`).join('\n');
        return {
          success: !result.isError,
          output: text,
          data: result,
        };
      } catch (err) {
        return { success: false, output: `MCP error: ${err}` };
      }
    },
  }));
}

/**
 * MCP 도구 목록을 프롬프트에 넣을 수 있는 텍스트로 변환
 */
export function formatMcpToolsForPrompt(tools: McpToolInfo[]): string {
  if (tools.length === 0) return '';
  const lines = tools.map((t) => `- ${t.serverId}/${t.name}: ${t.description}`);
  return `\n## Available MCP Tools\n${lines.join('\n')}\n`;
}
