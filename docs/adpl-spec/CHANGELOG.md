# ADPL Spec CHANGELOG

## v1.0.0 (2026-04-19) — Part B 완료

Initial official specification — Part B node type definitions added.

### Part A (commit 43faab0)
- §1–§6 완전 정의 (개요, Top-level structure, 컨텍스트 변수, 표현식 3-slot 시스템, 에러 + 검증 규칙, 버전 호환성)
- §7–§17 placeholder

### Part B
- §7 `agent` 노드: role/model/inputs/retry/fallback 전체 스펙 (~350줄)
- §8 `shell` 노드: shell/exec 모드, outputFormat, stdin 주입 (~250줄)
- §9 `http` 노드: 메서드별 idempotent retry, bodyFormat, allowedHosts (~200줄)
- §10 `webhook_out` 노드: Slack/Discord/Teams/generic provider, silentFail (~150줄)
- §11 `branch` 노드: first_match/all_match, default case, 3-way 분기 (~200줄)
- §12 `parallel` 노드: mergeStrategy 4종, best_score, cancelOnFirstFailure (~250줄)
- §13–§17 placeholder 유지 (Part C 에서 작성 예정)
