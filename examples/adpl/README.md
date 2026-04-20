# ADPL 샘플 파이프라인

ADPL v1.0 스펙을 배우는 데 도움이 되는 10개 샘플.

모두 `pnpm adpl:validate` 통과 검증됨.

## 난이도별 학습 경로

**초급** — 최소 구조부터 시작:

1. [`01-hello-world.yaml`](./01-hello-world.yaml) — 최소 구조 (4개 필드)
2. [`02-plan-code-verify.yaml`](./02-plan-code-verify.yaml) — Legacy AutoDev 재현 (agent 노드, inputs 표현식)

**중급 · flow 제어**:

3. [`03-parallel-checks.yaml`](./03-parallel-checks.yaml) — CI 체크 병렬 실행 (parallel + all_must_pass)
4. [`04-branch-by-tags.yaml`](./04-branch-by-tags.yaml) — tags 기반 분기 (branch + 구조화 조건)
5. [`05-loop-foreach.yaml`](./05-loop-foreach.yaml) — 배열 순회 (loop forEach + $loop 컨텍스트)
6. [`06-gate-approval.yaml`](./06-gate-approval.yaml) — 사람 승인 대기 (gate + notifyConfig)

**중급 · trigger**:

7. [`07-schedule-daily.yaml`](./07-schedule-daily.yaml) — cron 스케줄 자동 실행
8. [`08-webhook-pr.yaml`](./08-webhook-pr.yaml) — webhook_in 수신 + GitHub API 댓글

**고급**:

9. [`09-mcp-linear.yaml`](./09-mcp-linear.yaml) — MCP Linear 서버 연동
10. [`10-complex-ci.yaml`](./10-complex-ci.yaml) — 복합 시나리오 (다중 trigger + 여러 flow 조합)

## 기능 커버리지

| 기능 | 예시 번호 |
|------|-----------|
| 최소 구조 | 1 |
| agent 노드 (planner/coder/verifier) | 2, 5, 8 |
| agent 노드 (custom/reviewer) | 4, 9, 10 |
| shell 노드 | 1, 2, 3, 6, 7, 10 |
| http 노드 | 8 |
| webhook_out 노드 | 3, 6, 7, 9, 10 |
| branch 노드 | 4, 6, 10 |
| parallel 노드 | 3, 10 |
| loop 노드 (forEach) | 5 |
| gate 노드 | 6, 10 |
| mcp 노드 | 5, 9, 10 |
| task_created trigger | 1, 2, 3, 4, 5, 9 |
| manual trigger | 6, 10 |
| schedule trigger | 7 |
| webhook_in trigger | 8 |
| git_event trigger | 10 |
| 다중 trigger | 10 |
| inputs 표현식 ($nodes) | 2, 4, 5, 6, 8, 9, 10 |
| $loop 컨텍스트 | 5 |
| $trigger 컨텍스트 | 8, 10 |
| $env 참조 + allowedEnvKeys | 3, 6, 7, 8, 9, 10 |
| $task 컨텍스트 | 4, 9, 10 |
| 구조화 조건 (FieldCondition) | 4, 6, 10 |
| 구조화 조건 (in 배열) | 8 |
| retryPolicy | 10 |
| totalCostLimit | 10 |
| notifyConfig (gate) | 6 |
| onFailure: continue | 10 |

## 검증

모든 예시 한 번에 검증:

```bash
# glob pattern (CLI 자체 확장)
pnpm adpl:validate "examples/adpl/*.yaml"

# 또는 shell 확장
pnpm adpl:validate examples/adpl/*.yaml
```

## 사용 전 준비 사항

환경 변수가 필요한 예시:

| 예시 | 필요한 환경 변수 |
|------|----------------|
| 03 | `SLACK_WEBHOOK_URL` |
| 06 | `SLACK_WEBHOOK_URL` |
| 07 | `SECURITY_SLACK_WEBHOOK` |
| 08 | `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN` |
| 09 | `LINEAR_PROJECT_ID`, `SLACK_WEBHOOK_URL` |
| 10 | `GITHUB_WEBHOOK_SECRET`, `SLACK_WEBHOOK_URL` |

MCP 서버가 필요한 예시 (05, 09, 10):
- `~/.autodev/mcp.json` 에 `linear` 서버 등록 필요
- 설정 방법: `docs/mcp-guide.md` 참조
