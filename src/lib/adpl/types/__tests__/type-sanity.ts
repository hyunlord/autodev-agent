/**
 * ADPL 타입 sanity 체크 — pnpm tsc --noEmit 으로 검증.
 * 런타임 실행 불필요, 타입 정합성만 확인.
 */

import type {
  AdplPipeline,
  AgentNodeSpec,
  BranchNodeSpec,
  LoopNodeSpec,
  ParallelNodeSpec,
  GateNodeSpec,
  McpNodeSpec,
  SetNodeSpec,
  TransformNodeSpec,
  ShellNodeSpec,
  HttpNodeSpec,
  WebhookOutNodeSpec,
  TriggerSpec,
  NodeSpec,
  NodeOutput,
  NodeExecutionContext,
} from '../index';

// ① 최소 AdplPipeline 구성
const minimalPipeline: AdplPipeline = {
  adplVersion: 1,
  name: 'hello-world',
  triggers: [{ type: 'manual' }],
  pipeline: [
    {
      id: 'plan',
      type: 'agent',
      role: 'planner',
    } satisfies AgentNodeSpec,
  ],
};
void minimalPipeline;

// ② PCV 파이프라인 (Plan → Code → Verify)
const pcvPipeline: AdplPipeline = {
  adplVersion: 1,
  name: 'plan-code-verify',
  triggers: [{ type: 'task_created' }],
  pipeline: [
    { id: 'plan', type: 'agent', role: 'planner' },
    { id: 'code', type: 'agent', role: 'coder', dependsOn: ['plan'] },
    {
      id: 'verify',
      type: 'agent',
      role: 'verifier',
      output: { schema: { score: 'number', passed: 'boolean' }, strict: true },
      dependsOn: ['code'],
    },
  ],
};
void pcvPipeline;

// ③ branch 노드 재귀 타입
const branchNode: BranchNodeSpec = {
  id: 'route',
  type: 'branch',
  cases: [
    {
      when: { field: '$nodes.verify.output.data.score', gte: 80 },
      then: [
        { id: 'approve', type: 'shell', command: 'echo approved' } satisfies ShellNodeSpec,
      ],
    },
    {
      default: true,
      then: [{ id: 'rework', type: 'agent', role: 'coder' }],
    },
  ],
  evaluationMode: 'first_match',
  onMissingMatch: 'skip',
};
void branchNode;

// ④ loop 노드 재귀 타입 (forEach)
const loopNode: LoopNodeSpec = {
  id: 'issue-loop',
  type: 'loop',
  mode: 'forEach',
  over: '$nodes.verify.output.data.issues',
  as: 'issue',
  parallelism: 3,
  continueOnIterFailure: true,
  do: [
    {
      id: 'create-ticket',
      type: 'mcp',
      server: 'linear',
      tool: 'create_issue',
      args: { title: '${$loop.issue.title}' },
    } satisfies McpNodeSpec,
  ],
};
void loopNode;

// ⑤ parallel 노드 (all_must_pass)
const parallelNode: ParallelNodeSpec = {
  id: 'ci-checks',
  type: 'parallel',
  mergeStrategy: 'all_must_pass',
  cancelOnFirstFailure: true,
  branches: [
    { id: 'lint', nodes: [{ id: 'lint-run', type: 'shell', command: 'pnpm lint' }] },
    { id: 'test', nodes: [{ id: 'test-run', type: 'shell', command: 'pnpm test' }] },
    { id: 'tsc', nodes: [{ id: 'tsc-run', type: 'shell', command: 'pnpm tsc --noEmit' }] },
  ],
};
void parallelNode;

// ⑥ gate 노드 + schedule trigger
const gatedPipeline: AdplPipeline = {
  adplVersion: 1,
  name: 'deploy-approval',
  triggers: [
    {
      type: 'schedule',
      mode: 'cron',
      cron: '0 10 * * 1',
      timezone: 'Asia/Seoul',
      overlap: 'skip',
    },
  ],
  pipeline: [
    { id: 'build', type: 'shell', command: 'pnpm build' },
    {
      id: 'approval-gate',
      type: 'gate',
      prompt: '빌드 완료. 배포할까요?',
      options: ['deploy_prod', 'defer', 'cancel'],
      defaultOption: 'defer',
      timeout: 28800,
      artifactsToShow: ['build'],
    } satisfies GateNodeSpec,
    {
      id: 'deploy',
      type: 'shell',
      command: 'pnpm deploy:prod',
      when: { field: '$nodes.approval-gate.output.data.decision', eq: 'deploy_prod' },
    },
  ],
};
void gatedPipeline;

// ⑦ transform + set 노드
const transformNode: TransformNodeSpec = {
  id: 'critical-filter',
  type: 'transform',
  input: '$nodes.verify.output.data.issues',
  operation: 'filter',
  params: { where: { field: 'severity', eq: 'critical' } },
};
void transformNode;

const setNode: SetNodeSpec = {
  id: 'compute',
  type: 'set',
  values: {
    criticalCount: '${$nodes.critical-filter.output.data.outputLength}',
    score: '${$nodes.verify.output.data.score}',
  },
};
void setNode;

// ⑧ http + webhook_out 노드
const httpNode: HttpNodeSpec = {
  id: 'fetch-prs',
  type: 'http',
  url: 'https://api.github.com/repos/${$project.name}/pulls',
  method: 'GET',
  headers: { Authorization: 'Bearer ${$env.GITHUB_TOKEN}' },
  retryPolicy: { maxAttempts: 3, backoff: 'exponential', initialDelay: 5 },
};
void httpNode;

const webhookOutNode: WebhookOutNodeSpec = {
  id: 'notify',
  type: 'webhook_out',
  provider: 'slack',
  url: '${$env.SLACK_WEBHOOK_URL}',
  body: { text: 'Task ${$task.id} 완료' },
  silentFail: true,
};
void webhookOutNode;

// ⑨ NodeOutput 타입 확인
const nodeOutput: NodeOutput = {
  status: 'success',
  data: { score: 95, passed: true },
  metrics: { durationMs: 1200, costUsd: 0.012 },
};
void nodeOutput;

// ⑩ git_event trigger
const triggers: TriggerSpec[] = [
  { type: 'task_created', tags: ['security'] },
  { type: 'manual', confirmMessage: '실행할까요?' },
  { type: 'schedule', mode: 'interval', interval: 3600 },
  { type: 'webhook_in', path: 'ci-done', auth: 'hmac', secret: '${$env.SECRET}' },
  {
    type: 'git_event',
    events: ['pr_opened', 'pr_updated'],
    webhookConfig: { provider: 'github', secret: '${$env.GH_SECRET}' },
    filter: { branches: ['main'], ignorePaths: ['docs/**'] },
  },
];
void triggers;

// ⑪ while loop
const whileLoop: LoopNodeSpec = {
  id: 'poll-deploy',
  type: 'loop',
  mode: 'while',
  condition: { field: '$nodes.poll.output.data.status', nin: ['deployed', 'failed'] },
  maxIterations: 60,
  do: [
    { id: 'sleep', type: 'shell', command: 'sleep 5' },
    { id: 'poll', type: 'http', url: '${$env.STATUS_URL}', method: 'GET' },
  ],
};
void whileLoop;

// ⑫ custom agent (role: custom 필수 필드 확인)
const customAgent: AgentNodeSpec = {
  id: 'security-check',
  type: 'agent',
  role: 'custom',
  model: 'api:claude-opus-4',
  prompt: '보안 취약점을 분석해주세요: ${$nodes.code.output.data}',
  systemPrompt: '당신은 보안 전문가입니다.',
  temperature: 0.1,
  maxTokens: 4096,
  costLimit: 0.5,
  retryPolicy: { maxAttempts: 2, backoff: 'exponential' },
  fallback: { model: 'gemini-cli', onErrors: ['ERR_TRANSIENT'], maxAttempts: 1 },
};
void customAgent;

export {};
