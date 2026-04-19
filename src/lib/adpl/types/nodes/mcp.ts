import type { NodeSpecBase, RetryPolicy } from '../common';

export type McpSessionMode = 'per_task' | 'shared' | 'per_node';

export interface McpNodeSpec extends NodeSpecBase {
  type: 'mcp';
  server: string; // mcp.json에 등록된 서버 이름
  tool: string; // 호출할 MCP tool 이름
  args?: Record<string, unknown>; // tool arguments (Slot 1 가능)
  sessionMode?: McpSessionMode; // default: 'per_task'
  argsValidation?: boolean; // default: true
  retryPolicy?: RetryPolicy;
}
