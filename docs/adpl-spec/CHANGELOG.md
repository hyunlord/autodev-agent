# ADPL Spec CHANGELOG

## v1.0.0 (2026-04-19) — 스펙 완성

ADPL v1.0 공식 스펙 완성 (Part A + B + C).

### Part A (commit 43faab0)
- §1–§6 완전 정의 (개요, Top-level structure, 컨텍스트 변수, 표현식 3-slot 시스템, 에러 + 검증 규칙, 버전 호환성)
- §7–§17 placeholder

### Part B (commit 68eb731, fix 5a21412)
- §7 `agent` 노드: role/model/inputs/retry/fallback 전체 스펙 (~350줄)
- §8 `shell` 노드: shell/exec 모드, outputFormat, stdin 주입 (~250줄)
- §9 `http` 노드: 메서드별 idempotent retry, bodyFormat, allowedHosts (~200줄)
- §10 `webhook_out` 노드: Slack/Discord/Teams/generic provider, silentFail (~150줄)
- §11 `branch` 노드: first_match/all_match, default case, 3-way 분기 (~200줄)
- §12 `parallel` 노드: mergeStrategy 4종, best_score, cancelOnFirstFailure (~250줄)

### Part C (this commit)
- §13 `loop` 노드: forEach/times/while 3 모드, parallelism, breakCondition
- §14 `gate` 노드: human-in-the-loop, options, timeout, notifyConfig
- §15 Triggers: 5 타입 완전 정의 (task_created, manual, schedule, webhook_in, git_event)
- §16 `mcp` 노드: MCP 서버 연동, sessionMode 3종, argsValidation
- §17 보조 노드: `set` (변수 저장), `transform` (filter/map/pluck)
- 부록 A: Hello World 예시 10개
- 부록 B: 전체 파이프라인 예시 3개 (CI / 이슈 생성 / 배포 승인)
- 부록 C: CHANGELOG 업데이트

### Notes
- v1.0 은 초기 안정 스펙. Minor version 에서 Slot 3 표현식, 플러그인 시스템, `transform` `reduce` 확장 예정.
- `while` 루프 `maxIterations` 필수 정책 Breaking Change 없이 유지.
- MCP `shared` 세션 모드의 stateless 요건 엄격 적용.
