import type { Intent } from '../types';

export interface FewShotExample {
  id: string;
  category: 'new' | 'modify' | 'clarify' | 'complex';
  intent: Intent;
  userMessage: string;
  currentYaml?: string;
  expectedResponse: ExpectedResponse;
  estimatedTokens: number;
}

export interface ExpectedResponse {
  intent_recognized: 'new' | 'modify' | 'clarify' | 'explain';
  needs_clarification: boolean;
  clarification_questions?: Array<{ question: string; options?: string[]; is_required: boolean }>;
  generated_yaml: string | null;
  diff?: { added_nodes: string[]; removed_nodes: string[]; modified_nodes: string[] };
  explanation: string;
  warnings: string[];
  suggested_next_steps?: string[];
}

// ─── Example 1 — daily vuln audit (new, simple) ─────────────────────────

const VULN_AUDIT_YAML = `adplVersion: 1
name: daily-vuln-audit
description: Run npm audit daily and notify on vulnerabilities
settings:
  allowedEnvKeys: [SLACK_WEBHOOK_URL]
triggers:
  - type: schedule
    mode: cron
    cron: "0 9 * * *"
    timezone: "Asia/Seoul"
    overlap: skip
pipeline:
  - id: audit
    type: shell
    command: "pnpm audit --json"
    outputFormat: json
    failOnNonZero: false
  - id: route
    type: branch
    cases:
      - when:
          field: $nodes.audit.output.data.exitCode
          neq: 0
        then:
          - id: notify
            type: webhook_out
            provider: slack
            url: "\${$env.SLACK_WEBHOOK_URL}"
            body:
              text: "⚠️ npm audit found vulnerabilities (run on \${$trigger.firedAt})"
`;

const EXAMPLE_VULN_AUDIT: FewShotExample = {
  id: 'vuln-audit',
  category: 'new',
  intent: 'new',
  userMessage: '매일 9시에 npm audit 돌리고 취약점 발견되면 Slack 알림',
  expectedResponse: {
    intent_recognized: 'new',
    needs_clarification: false,
    generated_yaml: VULN_AUDIT_YAML,
    explanation:
      '매일 오전 9시(KST) 스케줄로 npm audit 을 실행하고, exit code 가 0이 아니면(취약점 발견) Slack webhook 으로 알립니다.',
    warnings: ['SLACK_WEBHOOK_URL 환경 변수를 설정하세요.'],
    suggested_next_steps: ['settings.allowedEnvKeys 에 등록된 SLACK_WEBHOOK_URL 의 실제 URL 을 환경에 주입하세요.'],
  },
  estimatedTokens: 380,
};

// ─── Example 2 — PR auto review (new, medium) ───────────────────────────

const PR_REVIEW_YAML = `adplVersion: 1
name: pr-auto-review
description: Auto review PRs and approve or file Linear ticket based on score
settings:
  allowedEnvKeys: [GH_WEBHOOK_SECRET, LINEAR_PROJECT_ID]
triggers:
  - type: git_event
    events: [pr_opened, pr_updated]
    webhookConfig:
      provider: github
      secret: "\${$env.GH_WEBHOOK_SECRET}"
    filter:
      branches: [main, develop]
pipeline:
  - id: review
    type: agent
    role: reviewer
    prompt: |
      Review PR #\${$trigger.event.number}: \${$trigger.event.title}
      Files: \${$trigger.event.changedPaths | join(', ')}
    output:
      schema:
        score: number
        summary: string
  - id: route
    type: branch
    cases:
      - when:
          field: $nodes.review.output.data.score
          gte: 70
        then:
          - id: approve
            type: mcp
            server: github
            tool: create_pull_request_review
            args:
              owner: "\${$trigger.event.repository.owner}"
              repo: "\${$trigger.event.repository.name}"
              pull_number: "\${$trigger.event.number}"
              event: APPROVE
              body: "\${$nodes.review.output.data.summary}"
      - default: true
        then:
          - id: ticket
            type: mcp
            server: linear
            tool: create_issue
            args:
              title: "Code review issues in PR #\${$trigger.event.number}"
              description: "\${$nodes.review.output.data.summary}"
              projectId: "\${$env.LINEAR_PROJECT_ID}"
`;

const EXAMPLE_PR_REVIEW: FewShotExample = {
  id: 'pr-auto-review',
  category: 'complex',
  intent: 'new',
  userMessage: 'PR 열리면 리뷰 후 점수 70 이상이면 자동 승인, 아니면 Linear 이슈 생성',
  expectedResponse: {
    intent_recognized: 'new',
    needs_clarification: false,
    generated_yaml: PR_REVIEW_YAML,
    explanation:
      'GitHub PR 열림/업데이트 이벤트를 받아 reviewer 에이전트가 점수를 매기고, 70점 이상이면 GitHub 자동 승인, 아니면 Linear 에 이슈를 생성합니다.',
    warnings: [
      'GH_WEBHOOK_SECRET, LINEAR_PROJECT_ID 환경 변수 필요',
      '.autodev/mcp.json 에 github 와 linear MCP 서버가 등록되어 있어야 합니다.',
    ],
    suggested_next_steps: [
      'main, develop 외 다른 브랜치도 대상이라면 filter.branches 를 조정하세요.',
    ],
  },
  estimatedTokens: 620,
};

// ─── Example 3 — parallel checks with cost limit (new, complex) ─────────

const PARALLEL_CHECKS_YAML = `adplVersion: 1
name: parallel-ci-checks
description: Run lint/test/typecheck in parallel with a cost ceiling
settings:
  totalCostLimit: 0.5
triggers:
  - type: task_created
pipeline:
  - id: checks
    type: parallel
    mergeStrategy: all_must_pass
    maxConcurrent: 3
    cancelOnFirstFailure: true
    branches:
      - id: lint
        nodes:
          - id: lint-run
            type: shell
            command: "pnpm lint"
      - id: test
        nodes:
          - id: test-run
            type: shell
            command: "pnpm test"
            timeout: 120
      - id: typecheck
        nodes:
          - id: tsc-run
            type: shell
            command: "pnpm tsc --noEmit"
            timeout: 60
  - id: next
    type: agent
    role: planner
    prompt: "All checks passed. Continue with: \${$task.prompt}"
`;

const EXAMPLE_PARALLEL_CHECKS: FewShotExample = {
  id: 'parallel-checks',
  category: 'complex',
  intent: 'new',
  userMessage: '이 코드 lint, test, typecheck 병렬로 돌리고 셋 다 성공해야 다음 단계. 비용 $0.5 넘지 마',
  expectedResponse: {
    intent_recognized: 'new',
    needs_clarification: false,
    generated_yaml: PARALLEL_CHECKS_YAML,
    explanation:
      'task_created 트리거 시 lint/test/typecheck 3개를 동시 실행(all_must_pass)하고, 첫 실패 시 나머지를 즉시 취소합니다. 전체 비용은 $0.50 으로 제한했습니다.',
    warnings: [
      'cancelOnFirstFailure: true 라 실패 branch 외 나머지도 즉시 취소됩니다 — 모든 결과를 보려면 false 로 변경하세요.',
    ],
    suggested_next_steps: [
      '실제 cost 가 $0.5 에 자주 닿는다면 totalCostLimit 을 올리거나 settings.maxParallel 을 조정하세요.',
    ],
  },
  estimatedTokens: 470,
};

// ─── Example 4 — clarify (ambiguous) ────────────────────────────────────

const EXAMPLE_CLARIFY_BUILD: FewShotExample = {
  id: 'clarify-build',
  category: 'clarify',
  intent: 'clarify',
  userMessage: '빌드 실패하면 알려줘',
  expectedResponse: {
    intent_recognized: 'clarify',
    needs_clarification: true,
    clarification_questions: [
      {
        question: '빌드는 어떻게 실행하나요?',
        options: ['pnpm build', 'npm run build', 'make', '기타(직접 입력)'],
        is_required: true,
      },
      {
        question: '빌드는 언제 트리거되나요?',
        options: ['매일 정해진 시간', 'PR 열릴 때', '수동 실행', '기타'],
        is_required: true,
      },
      {
        question: '실패 알림은 어디로 보낼까요?',
        options: ['Slack', 'Discord', 'Microsoft Teams', '기타(URL 직접 입력)'],
        is_required: true,
      },
    ],
    generated_yaml: null,
    explanation: '빌드 명령어, 트리거 시점, 알림 채널을 알려주시면 정확한 파이프라인을 만들 수 있습니다.',
    warnings: [],
  },
  estimatedTokens: 220,
};

// ─── Example 5 — modify with retry (modify, with diff) ──────────────────

const MODIFY_BEFORE_YAML = `adplVersion: 1
name: build-and-notify
triggers:
  - type: task_created
pipeline:
  - id: test
    type: shell
    command: "pnpm test"
  - id: notify
    type: webhook_out
    provider: slack
    url: "\${$env.SLACK_WEBHOOK_URL}"
    body:
      text: "Test result: \${$nodes.test.output.data.exitCode}"
`;

const MODIFY_AFTER_YAML = `adplVersion: 1
name: build-and-notify
triggers:
  - type: task_created
pipeline:
  - id: test
    type: shell
    command: "pnpm test"
    retryPolicy:
      maxAttempts: 3
      backoffSec: 5
  - id: notify
    type: webhook_out
    provider: slack
    url: "\${$env.SLACK_WEBHOOK_URL}"
    body:
      text: "Test result: \${$nodes.test.output.data.exitCode}"
`;

const EXAMPLE_MODIFY_RETRY: FewShotExample = {
  id: 'modify-retry',
  category: 'modify',
  intent: 'modify',
  userMessage: 'test 실패 시 재시도 3번 추가',
  currentYaml: MODIFY_BEFORE_YAML,
  expectedResponse: {
    intent_recognized: 'modify',
    needs_clarification: false,
    generated_yaml: MODIFY_AFTER_YAML,
    diff: {
      added_nodes: [],
      removed_nodes: [],
      modified_nodes: ['test'],
    },
    explanation: 'test 노드에 maxAttempts 3 + backoffSec 5 의 retryPolicy 를 추가했습니다. 다른 노드는 변경하지 않았습니다.',
    warnings: [],
    suggested_next_steps: ['특정 exit code 만 재시도하려면 retryPolicy.onExitCodes 를 추가하세요.'],
  },
  estimatedTokens: 460,
};

// ─── Public API ──────────────────────────────────────────────────────────

export const coreExamples: FewShotExample[] = [
  EXAMPLE_VULN_AUDIT,
  EXAMPLE_PR_REVIEW,
  EXAMPLE_PARALLEL_CHECKS,
  EXAMPLE_CLARIFY_BUILD,
  EXAMPLE_MODIFY_RETRY,
];

const TARGET_TOKENS = 3000;

const FRAGMENT_INDICATORS: Record<string, string[]> = {
  'schedule-trigger': ['type: schedule'],
  'git-event-trigger': ['type: git_event'],
  'webhook-providers': ['type: webhook_out', 'type: webhook_in', 'provider: slack', 'provider: discord'],
  parallel: ['type: parallel'],
  'loop-patterns': ['type: loop'],
  'gate-human': ['type: gate'],
  'mcp-integration': ['type: mcp'],
};

function mentionsFragment(ex: FewShotExample, fragmentName: string): boolean {
  const yaml = ex.expectedResponse.generated_yaml ?? '';
  const indicators = FRAGMENT_INDICATORS[fragmentName] ?? [];
  return indicators.some((i) => yaml.includes(i));
}

/**
 * v1 selector — intent match first, then fragment-related, then others.
 * Caps total tokens at TARGET_TOKENS but always returns at least one example.
 */
export function selectExamples(intent: Intent, fragmentsUsed: string[]): FewShotExample[] {
  const scored = coreExamples.map((ex, i) => {
    let score = 0;
    if (ex.intent === intent) score += 100;
    if (fragmentsUsed.some((f) => mentionsFragment(ex, f))) score += 10;
    return { ex, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);

  const result: FewShotExample[] = [];
  let total = 0;
  for (const { ex } of scored) {
    if (result.length === 0) {
      result.push(ex);
      total += ex.estimatedTokens;
      continue;
    }
    if (total + ex.estimatedTokens > TARGET_TOKENS) continue;
    result.push(ex);
    total += ex.estimatedTokens;
  }
  return result;
}
