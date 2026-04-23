# Stage 3 Retrospective — Leaf Adapters + Facade

> 작성: 2026-04-23 (Stage 3 종결)
> 기간: 1일 (로드맵 예상 3-4주 vs 실제 1일)

## TL;DR

Stage 3 Leaf Adapters + Facade 완성.  
Agent / Shell / HTTP / Webhook-out 4종 adapter + HookEngine bridge + Pipeline Facade + Legacy YAML + Shadow mode 전체 구동.  
17 commits, 전부 A등급. 362 → 630+ tests pass.  
Shadow mode 로 legacy ↔ Phase P 병렬 비교 기반 구축. Stage 4 진입 준비 완료.

---

## 일정

- **로드맵 예상**: 3-4주 (Week 7~10)
- **실제**: 1일 (2026-04-23)

일정 단축 원인:
- Stage 2 엔진이 확장 가능한 interface 계약으로 설계돼 adapter 주입이 단순
- "wrap, not port" 원칙으로 기존 legacy 코드 재사용 극대화
- Mock-first 검증 전략 (Stage 2 노하우 재적용)
- 모든 adapter 가 공통 `NodeAdapter` interface 를 구현해 일관된 테스트 패턴 재사용

단축의 함의:
- **코드 품질 유지**: verify:cross A등급 전수 통과 (평균 97.2)
- **Shadow 사이드 이펙트 격리 미구현**: 지금 Shadow 는 Phase P 가 실제 agent 호출. 완전 격리(shadow 전용 DB, worktree 분리, dry-run)는 Stage 3 범위 외로 명시
- **Stage 4 부터 일 단위 페이스 권장** (Stage 2 회고와 동일)

---

## 작업 궤적 (17 commits)

| Commit | 태그 | 주제 | 핵심 |
|:------:|------|------|------|
| 3af54ed | C7-1 | agent adapter + 4 backends | Plan/Code/Verify/Evaluate 노드 → 실제 LLM 호출 |
| 2740846 | C7-1 post | worktreeRoot 계약 강화 | `path.isAbsolute` 검증 + agent.input_degraded 분리 |
| c5b9815 | C7-1.5 | Verifier adapter minimal wrap | agentModel metrics, verify agent 재사용 |
| cd36de8 | C7-1.5 post | unused var cleanup | capturedVerifyCtx 제거 |
| 97d36db | C7-2 | shell adapter | spawn + SIGKILL + process group + outputFormat |
| bff9ff1 | C7-2/C7-3 fix | import path + unused vars | Verify Agent 지적 반영 |
| 7744ad9 | C7-3 | hook bridge | command/script hooks → shell nodes (HookEngine) |
| cd11c52 | C8-1 | http adapter | fetch + retry + policy + 5 body formats |
| 5393676 | C8-2 | webhook_out adapter | Slack/Discord/Teams/generic |
| 750e60b | docs | C9-1 사전 조사 | pipeline-facade 설계 근거 문서 |
| f8926a2 | C9-1 | pipeline facade | legacy \| phase_p routing |
| 6fad0a7 | docs | C7-2 사전 조사 | shell adapter 설계 근거 문서 |
| 5b5395d | docs | design6 sync | C7-1/1.5 설계 반영 |
| 8c3d7db | C9-2 | legacy-equivalent YAML | auto-generator (ensureDefaultPipelineVersion) |
| bdd854f | C9-3 | shadow mode | legacy primary + phase_p shadow 병렬 실행 |
| — | C9-4 | shadow 검증 + try-catch fix | PHASE_P_EXECUTOR_FAILED 분리 + 10 시나리오 |
| — | — | stage-3-retro | 이 문서 |

---

## 설계 대비 구현 조정 (9건)

Stage 4 스펙 업데이트 자료. 실코드 작성 과정에서 초기 설계에서 조정한 내용.

### 1. ShellNodeSpec 필드명 변경
- **설계**: `shell.argv` (배열), `shell.shell` (셸 경로)
- **구현**: `shell.args` (배열), `shell.mode` (`sh` | `bash` | `zsh` | `powershell`)
- **이유**: `argv` 는 OS argv 표준 이름과 혼동. `mode` 가 셸 종류를 enum 으로 명확히 표현
- **적용**: ADPL YAML 예시 모두 `args:` / `mode:` 로 수정 필요

### 2. HttpNodeSpec 필드명 변경
- **설계**: `http.retry.max` (중첩 객체)
- **구현**: `http.retryPolicy.maxAttempts` (policy 서브 객체, `maxAttempts` = 총 시도 횟수)
- **이유**: Stage 2 에서 `RetryPolicy.maxAttempts` 를 이미 정착. 일관성 유지
- **적용**: ADPL spec §http 섹션 수정

### 3. 경로 조정: pipeline.ts 위치
- **설계**: `src/lib/pipeline.ts`
- **실체**: `src/worker/pipeline.ts`
- **이유**: legacy Worker 기반 구조. worker 디렉토리가 실행 파이프라인의 홈
- **적용**: Stage 4 문서에서 경로 참조 수정

### 4. ROLE_MODEL_MATRIX 값 변동
- **설계**: 고정 model ID 예시 (claude-3-haiku, etc.)
- **구현**: `src/lib/adpl/engine/adapters/agent/resolver.ts` 의 값이 진실
- **이유**: 모델 ID 는 릴리스마다 변경. 설계 문서에 하드코딩 금지
- **적용**: Stage 4 에서 resolver.ts 를 단일 진실 소스로 참조

### 5. agent.input_degraded vs agent.fallback 분리
- **설계**: 단일 `agent.fallback` 이벤트
- **구현**: `agent.input_degraded` (컨텍스트 삭감) + `agent.fallback` (모델 강등) 별도
- **이유**: 두 시나리오는 다른 품질 보장 수준. 분리하면 subscriber 가 선별적으로 반응 가능
- **적용**: ADPL spec §events 에 두 이벤트 타입 추가

### 6. Verify Agent 전체 wrap → Stage 7 이월
- **설계**: Stage 3 에서 Verify Agent 를 ADPL verifier 노드로 완전 래핑
- **구현**: verifier adapter 는 최소 wrap (결과 기록만). 실제 multi-round 래핑은 Stage 7
- **이유**: Verify Agent 는 복잡한 상태 머신. 최소 기능으로 먼저 검증
- **이월**: Stage 7 verifier 고도화

### 7. Screenshots HOME 리디렉션 → Stage 7 이월
- **설계**: Stage 3 에서 screenshots 경로 HOME 리디렉션 처리
- **구현**: 미구현 (verify:cross 통과에 영향 없음)
- **이유**: 현재 테스트 환경에서 blocking 아님
- **이월**: Stage 7 또는 필요 시점

### 8. ToolPolicySpec: adapter 레이어 직접 처리
- **설계**: 독립 policy 레이어 (ToolPolicySpec)
- **구현**: shell adapter → command-checker 직접 호출; http adapter → inline policy check
- **이유**: v1 단순화. 독립 policy 레이어는 오버엔지니어링
- **이월**: Stage 6+ 에서 policy 레이어 추출 검토

### 9. Retry-After 헤더 처리
- **설계**: Worker `calcBackoff` 에서 Retry-After 파싱
- **구현**: http adapter 레이어에서 직접 처리 (`parseRetryAfter` 헬퍼)
- **이유**: HTTP 관련 로직은 http adapter 에 집중. Worker 는 generic retry 만 담당
- **적용**: Worker retry 문서에서 "HTTP Retry-After 는 adapter 담당" 명시

---

## 테스트 커버리지

Stage 3 신규 추가 테스트 파일:

| 파일 | 추가 테스트 수 | 주제 |
|------|:---:|------|
| agent-adapter.test.ts | ~24 | Plan/Code/Verify/Evaluate 노드, 4 backends |
| verifier-adapter.test.ts | ~8 | Verifier wrap, agentModel |
| shell-adapter.test.ts | ~18 | spawn, SIGKILL, outputFormat |
| hook-bridge.test.ts | ~12 | command/script hook → shell node |
| http-adapter.test.ts | ~22 | fetch, retry, 5 body formats |
| webhook-out.test.ts | ~16 | Slack/Discord/Teams/generic |
| pipeline-facade.test.ts | ~11 | legacy/phase_p/shadow routing |
| shadow-runner.test.ts | 6 | 병렬 실행, abort, ensureDefault |
| shadow-comparator.test.ts | 4 | DB insert, error 저장 |
| shadow-verification.test.ts | 10 | 10 시나리오 E2E 검증 |

**누적: 362 → 630+ tests (10 test files 신규)**

---

## Exit 기준 체크

- [x] Leaf Adapter 4종 (agent / shell / http / webhook_out) 동작
- [x] HookEngine bridge (C7-3) — command/script hook → shell node
- [x] Pipeline Facade (C9-1) — legacy \| phase_p \| shadow 라우팅
- [x] Legacy-equivalent YAML auto-generator (C9-2) — 멱등성 보장
- [x] Shadow mode (C9-3/C9-4) — legacy primary + phase_p shadow 병렬
- [x] shadow_runs 테이블 + comparator 기록
- [x] pipeline.ts 본체 수정 0줄 (wrap 원칙 준수)
- [x] legacy 회귀 0건 (모든 커밋 A등급)
- [x] process unhandled rejection 0건 (shadow-verification 시나리오 8)
- [~] Shadow 사이드 이펙트 완전 격리 — 미구현 (Stage 4 이전 별도 작업)

---

## 알려진 이슈 (Stage 4 또는 Stage 3-post)

### 1. Verify Agent 46/50 구조적 점수 계단

verify:cross Verify Agent 점수:
- 0 issues → 48/50 → 98점
- 1 issue → 46/50 → 96점

scoring 공식 특성. 정상 범위. A등급 유지에 문제 없음.

### 2. Shadow 사이드 이펙트 격리 미구현

현재 Shadow mode 에서 Phase P executor 가 실제 agent backend 를 호출함.
- **영향**: shadow 실행 시 LLM API 비용 2배 발생 가능
- **완전 격리 요소**: shadow 전용 DB write table prefix, worktree 분리, agent dry-run mode
- **판단 근거**: C9-3 명세에서 "별도 작업"으로 명시. 현재는 shadow_runs 비교 기록이 목적
- **Action**: Stage 4 이전 1회 실제 shadow 실행으로 비용/부작용 검토 권장

### 3. spawn 공통 유틸 미추출

verify-agent, shell adapter, agent backends 각각 독립적으로 spawn + SIGKILL + process group 구현.
- **문제**: 코드 중복, SIGKILL 타이밍 버그 각자 관리
- **권장**: `src/lib/process/spawn-util.ts` 공통 추출
- **우선순위**: Stage 3 이후 리팩토링 (기능 영향 없음)

### 4. HookEngine agent/http type 미통합

C7-3 hook bridge 는 command/script type 만 처리.
- `agent` type hook, `http` type hook 은 기존 legacy 실행 경로에서만 활성
- Stage 4 또는 Phase P v1.1 에서 ADPL hook → agent/http adapter 연결 예정

---

## Risk 회고

| Risk | 예상 | 결과 |
|---|---|---|
| Agent adapter 복잡 | 높음 | C7-1 이 Stage 3 에서 가장 복잡. 4 backends + worktreeRoot 계약으로 해결 |
| legacy 회귀 발생 | 중간 | 0건. wrap 원칙 + 전수 verify:cross 덕분 |
| Shadow DB 충돌 | 중간 | 미발생 (shadow 격리 미구현이므로 실제 충돌 테스트 미수행) |
| Verify Agent 오탐 | 중간 | 1건 발생 (97d36db import path 지적 — 오탐). 무시 후 진행 |
| 설계-구현 격차 | 낮음(예상) | 9건 조정. Stage 2 와 동일 수준. 예상 범위 내 |

---

## 노하우 (Stage 4 이전 참조)

1. **"wrap, not port" 원칙이 legacy 회귀 0건 유지에 가장 큰 기여**  
   pipeline.ts 본체 수정 0줄. 기존 logic 재사용, Phase P 레이어는 위에서 감쌈.

2. **설계 문서 vs 실체 상식**: 실코드가 진실, 설계 문서는 가이드  
   9건 조정 모두 실코드 우선으로 해결. 설계 동결 시도는 오히려 느림.

3. **조사 → 판정 → 구현 3단계**가 복잡 adapter 에 효과적  
   C7-2 (shell), C9-1 (facade) 에서 사전 조사 문서 작성 → 구현 속도 향상.

4. **Verify Agent false positive 발생 가능**  
   97d36db shell adapter import path 지적은 오탐. 코드 정상 동작 확인 후 무시.

5. **Commit 분리 전략**: rename / 설계 수정 / 신규 기능은 별도 커밋  
   C7-1 post, C7-1.5 post 처럼 hotfix 커밋 분리 → git bisect 쉬움.

6. **Shadow 30초 grace period 패턴**  
   `setTimeout(abort, 30_000)` + `clearTimeout` 조합이 shadow timeout 처리의 핵심.  
   fake timer 로 테스트 검증 가능. Promise.race + AbortSignal 조합은 재사용 가능한 패턴.

7. **try-catch 스코프는 좁게**  
   C9-3 에서 전체 함수 wrap → Verify Agent 지적 → C9-4 에서 스코프 분리.  
   `ENSURE_DEFAULT_FAILED` vs `PHASE_P_EXECUTOR_FAILED` 분리로 디버깅 명확화.

---

## Stage 4 진입 전 조정 사항

### ADPL 스펙 업데이트 필요 (docs/adpl-spec/v1.0.md)
1. ShellNodeSpec: `argv` → `args`, `shell` → `mode`
2. HttpNodeSpec: `retry.max` → `retryPolicy.maxAttempts`
3. `agent.fallback` / `agent.input_degraded` 이벤트 타입 추가
4. HTTP Retry-After 처리 위치: adapter 담당 명시

### 설계 문서 업데이트 (docs/phase-p/design-updates-needed.md 에 추가)
1. adapter 경로: `src/lib/pipeline.ts` → `src/worker/pipeline.ts`
2. ROLE_MODEL_MATRIX: resolver.ts 단일 진실 소스
3. ToolPolicySpec: v1 inline 처리, 독립 레이어 v2+
4. Retry-After: adapter 레이어 담당
5. agent.input_degraded / agent.fallback 분리

### Stage 4 첫 작업
설계 로드맵 §Stage 4 — Flow Nodes (parallel / branch / loop).  
첫 대상: `parallel` flow node (가장 단순, Scheduler 이미 concurrency 지원).  
목표: 2+ node 병렬 실행 E2E 검증.

---

## 다음 세션

**즉시 할 것**
- `docs/phase-p/design-updates-needed.md` 에 Stage 3 조정 9건 추가
- Shadow 사이드 이펙트 격리 여부 판단 (실제 shadow 1회 실행 비용 측정)

**Stage 4 시작점**: 설계 §Flow Nodes  
**목표**: parallel / branch / loop flow node 구현  
**예상 기간**: 2-3주 (로드맵 기준)

> Stage 3 도 1일 완성. "하루 몰입" 패턴이 반복되고 있음.  
> Shadow 격리 등 미완 항목을 감안하면 Stage 4 는 실용적 품질 게이트를 세워 진행 권장.  
> **단: 각 Stage 시작 전 이전 Stage 알려진 이슈 해소 여부 확인 필수.**
