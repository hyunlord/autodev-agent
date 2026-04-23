# Stage 5 Retrospective — Triggers + Expression

> 작성: 2026-04-23 (Stage 5 종결)
> 기간: 1일 (로드맵 예상 2-3주 vs 실제 1일)

## TL;DR

Stage 5 E1+E2+E3+E5 완성. E4 (독립 break/continue 노드, forEach parallelism, human-approval) 는 명시적 이월.  
$nodes 실제 주입 (E1) + ADPL 전용 mini-evaluator (E2) + trigger 연결·continueOnIterFailure·breakCondition (E3) 구현.  
5 commits, 전부 A등급. 716 → 820+ tests pass.  
Stage 5 완료로 v0.5 Beta 출시 후보 마일스톤 도달. Stage 6 (Durability + Observability) 진입 준비 완료.

---

## 일정

- **로드맵 예상**: 2-3주
- **실제**: 1일 (2026-04-23)

일정 단축 원인:
- Stage 3·4 와 동일한 "하루 몰입" 패턴 반복
- E1 은 "연결 작업" 수준 — context-builder 의 `$nodes` 수집 코드가 이미 완성됐고, loop-handler 에 ctx 전달 경로만 추가하면 됨
- E2 는 외부 패키지 없이 직접 파서 구현 → 소요 다소 있었으나 24 commits 원칙 유지
- E3 의 breakCondition / continueOnIterFailure 는 스키마가 이미 존재하고 핸들러 골격도 있어 "채우기" 수준
- 조사서(Stage 5 investigation) 에서 각 블록의 실체 상태를 사전에 정확히 파악

일정 단축의 함의:
- **E4 명시적 제외**: 독립 break/continue 노드, forEach parallelism > 1, human-approval gate 는 Stage 5+ 에 남김
- **Stage 6 부터 일 단위 페이스 권장** (Stage 2~5 공통 교훈)

---

## 작업 궤적 (5 commits)

| Commit | 태그 | 주제 | 핵심 |
|:------:|------|------|------|
| 72fbd6a | E0 | Stage 5 사전 조사 | 이월 항목 13건 매핑, Jexl 미설치 확인, breakCondition 스키마 상태 확인 |
| 43d2d06 | E1 | $nodes 실제 주입 | FlowRunState.currentLoopCtx + setLoopCtx 콜백, resolveOverExpression ctx 연결 |
| d32d533 | E2 | mini-evaluator | tokenizer → parser → evaluator 3단 파이프, 9 연산자 지원, 외부 패키지 0건 |
| f74ac36 | E3 | trigger 연결 + continueOnIterFailure + breakCondition | buildTriggerContext, WorkerOptions.triggerContext, loop-handler 보완 |
| (이번) | E5 | retro + 통합 E2E + 타입 정리 | stage-5-retro.md, 시나리오 29·30, TriggerContext 인덱스 시그니처 |

---

## E4 명시적 제외

Stage 5 E4 는 다음 항목을 포함하며 **이번 Stage 에서 구현하지 않음**:

| 항목 | 이유 | 이월 대상 |
|------|------|-----------|
| 독립 break/continue 노드 (`type: 'break'`, `type: 'continue'`) | 스키마 미정의, 제어 신호 구현 방식 미결정 | Stage 5+ |
| forEach parallelism > 1 | DB/worktree 격리 없이 race condition 위험 | Stage 6 (격리 구현 후) |
| human-approval gate | Slack 알림 + 응답 대기 비동기 패턴, 별도 설계 필요 | Stage 5+ 또는 v1.1 |

현재 `breakCondition` 으로 "이터레이션 종료 조건 평가"를 대체하며, 독립 노드 방식은 미래 확장으로 남김.

---

## 설계 조정 사항 (Stage 6 이월 스펙 업데이트)

실코드 작성 과정에서 조사서에 없던 설계 조정 사항.

### 1. FlowRunState.currentLoopCtx + setLoopCtx 콜백 패턴 (E1)

**설계 기대**: FlowNodeHandler 가 컨텍스트를 직접 받아 사용  
**구현**: FlowNodeOptions 에 `setLoopCtx` 콜백 주입 → loop-handler 가 각 iteration 시작 시 호출 → Scheduler 가 StateStore 의 `currentLoopCtx` 업데이트 → Worker 가 `buildExecutionContext` 시 `$loop` 주입  
**이유**: Scheduler 의 상태 전이 코드를 수정하지 않고 FlowNodeHandler 에서 루프 컨텍스트를 주입하기 위한 콜백 패턴. 직접 ctx 참조는 순환 의존 위험.  
**적용**: Stage 6 설계 문서에 "loop-handler 내 setLoopCtx 콜백 위치" 명시 권장

### 2. resolveOverExpression 이 ctx 받아 $nodes 경로 실제 resolve (E1)

**설계 기대**: resolveOverExpression 이 고정 JSON 배열 또는 상수 경로만 처리  
**구현**: ExecutionContext 를 파라미터로 받아 `$` 접두사 경로를 실제 context 에서 resolve. `$nodes.plan.data.tasks` 형태의 dot-access 지원.  
**이유**: forEach 에서 이전 노드 출력 배열을 동적으로 참조하는 핵심 기능  
**적용**: ADPL spec §loop.over 필드에 `$nodes.X.Y.Z` 경로 지원 명시 필요

### 3. ADPL 전용 mini-evaluator — 외부 패키지 없이 구현 (E2)

**설계 기대**: Jexl 패키지 fork 또는 의존 (조사서 §4 옵션 B 권고)  
**구현**: `tokenizer.ts` + `parser.ts` + `evaluator.ts` 직접 작성. 9개 비교 연산자 (`==`, `===`, `!=`, `!==`, `>`, `<`, `>=`, `<=`) + `&&`/`||`/`!` + `$`-경로 resolve + 숫자/문자열/bool/null 리터럴 + 괄호  
**이유**: 24 commits 연속 외부 패키지 0건 원칙 유지. 조사서 옵션 B(선별적 구현)를 패키지 없이 달성 가능 확인  
**주의**: 키워드 연산자 (`gte`, `lte`, `eq`, `neq` 등) 는 문자열 표현식에서 지원하지 않음. 이들은 `FieldCondition` (구조화된 조건) 전용. 문자열 조건에서는 `>=`, `<=` 등 기호 연산자 사용.  
**적용**: ADPL spec §expression "string condition 에서 키워드 연산자 불가, 기호 연산자 사용" 명시

### 4. breakCondition 의미론 명시 (E3)

**설계 기대**: 암묵적  
**구현**: `breakCondition: true → break` (즉, "이 조건이 참이면 중단"). while loop 의 `condition: true → continue` 와 반대 의미.  
- `while.condition`: "이 조건이 참인 동안 계속" (계속 조건)
- `breakCondition`: "이 조건이 참이면 중단" (중단 조건)  
**적용**: ADPL spec §loop.breakCondition 에 의미론 명시

### 5. TriggerContext 구조 (E3)

**설계 기대**: 기존 `TriggerContextBase` (triggerId/type/firedAt) 형태  
**구현**: worker 레이어 전용 `TriggerContext` (kind/taskId/userId?/projectId/createdAt/category?/priority?) 신규 정의. `[key: string]: unknown` 인덱스 시그니처로 `Record<string, unknown>` 호환성 확보.  
**이유**: task_created 이벤트 기반 파이프라인 실행에 특화된 컨텍스트 구조 필요. 기존 `TriggerContextBase` 는 webhook/schedule 등 범용 트리거용  
**적용**: Stage 6 에서 `ExecutionContext.$trigger` 에 worker TriggerContext 타입 정식 통합 권장

### 6. Slot3 표현식 미구현 (E2)

**설계 기대**: 로드맵 v1.5 후보 항목  
**구현**: 산술 (+, -, *, /, %), 삼항 (? :), 함수 호출 (max, length 등), 배열/객체 리터럴, 인덱스 접근 미구현. `EXPRESSION_UNSUPPORTED_TOKEN` 에러로 거부.  
**이유**: Stage 5 목표 범위 외. Slot3 은 별도 마일스톤  
**적용**: 미래 Slot3 구현 시 tokenizer → parser → evaluator 3단 파이프 확장

---

## 알려진 이슈 (Stage 6+ 이월)

### 1. $trigger 타입 통합 미완

**현상**: `ExecutionContext.$trigger` 는 `TriggerContext` (types/context.ts) 타입으로 선언됨. worker 레이어의 `buildTriggerContext()` 는 별도 `TriggerContext` (worker/context-builder.ts) 인터페이스 반환. 두 타입이 공존.  
**현재 처리**: `TriggerContext` 에 `[key: string]: unknown` 인덱스 시그니처 추가 → `Record<string, unknown>` 호환성 확보, 캐스팅 제거  
**미완 항목**: 두 `TriggerContext` 타입의 통합, `ExecutionContext.$trigger` 타입을 worker 컨텍스트에 맞게 정식 확장  
**Action**: Stage 6 또는 별도 타입 정리 PR

### 2. Slot3 표현식 미지원

**현상**: 문자열 표현식에서 산술, 삼항, 함수 호출, 배열/객체 리터럴, 인덱스 접근 불가. `EXPRESSION_UNSUPPORTED_TOKEN` 에러로 거부.  
**영향**: `"$nodes.items.length > 0"` 은 동작하나 `"max($nodes.a, $nodes.b)"`, `"$loop.item[0]"` 등 불가  
**Action**: 미래 Slot3 구현 시 해제. 현재는 StructuredCondition 으로 대체 가능

### 3. 독립 break/continue 노드 미정의

**현상**: `type: 'break'`, `type: 'continue'` 노드 타입 없음. `breakCondition` 필드로 대체.  
**영향**: loop 내부 do[] 에서 조건부 조기 탈출을 위해 별도 break 노드 불가  
**Action**: Stage 5+ 에서 제어 신호 구현 방식 결정 후 추가

### 4. forEach parallelism > 1 미지원

**현상**: loop forEach 는 항상 순차 실행 (iteration 간 직렬)  
**영향**: 대용량 배열 처리 시 성능 병목 가능  
**Action**: Stage 6 DB/worktree 격리 구현 후 활성화

### 5. human-approval gate 미설계

**현상**: condition 기반 gate 만 구현됨. Slack 알림 → 응답 대기 비동기 gate 미구현  
**영향**: 파이프라인 중간 사람 승인 대기 불가  
**Action**: 별도 설계 (Slack Bot webhook + 타임아웃 polling) 후 Stage 5+ 구현

### 6. Checkpoint 복원 미구현

**현상**: StateStore in-memory 구현. 프로세스 재시작 시 실행 상태 복구 불가.  
**영향**: 장시간 파이프라인 실행 중 프로세스 재시작 시 처음부터 재실행 필요  
**Action**: Stage 6 Durability — DB-backed StateStore + lastCheckpointAt/resumedFromRunId 컬럼 활용

### 7. DB/worktree 격리 미구현

**현상**: Phase P executor 가 legacy 와 동일 SQLite DB / worktreeRoot 사용. Shadow mode 포함.  
**영향**: parallel flow node + loop forEach parallelism > 1 에서 race condition 잠재 우려  
**Action**: Stage 6 에서 phase-p 전용 write prefix 또는 git worktree 분리 구현

---

## 노하우

### 1. "연결 작업" 은 보기보다 가벼움

E1 이 그런 경우. 실체 코드 (`collectCompletedNodeOutputs`, `resolveOverExpression`, `context-builder.ts` 의 `$nodes` 수집) 는 모두 존재했으나 파이프가 하나 끊겨 있었다. 적절한 조사 후 "연결만 하면 되는 상황"을 정확히 판별하면 무거운 신규 구현 없이 목표를 달성할 수 있다.

### 2. 외부 패키지 금지 원칙은 E2 에서 가장 강하게 도전됨

Jexl 패키지를 설치하면 E2 를 빠르게 해결할 수 있었다. 조사서(판단 2)에서 "옵션 B — 선별적 구현, 외부 패키지 없이도 가능"으로 결정하고 tokenizer→parser→evaluator 를 직접 구현했다. Stage 5 까지 24 commits 연속 외부 패키지 0건 원칙 유지. 직접 구현의 부산물로 ADPL 영역에 정확히 맞춘 표현식 평가기를 확보했다.

### 3. 조사 범위 확인이 변이 수집에 효과적

Stage 5 조사서에서 `23_PhaseP_design4c2_durability_observability.md`, `20_PhaseP_design4b5_expression.md` 설계 문서가 존재하지 않는다는 점을 발견했다. 로드맵 문서와 스키마·코드가 진실인지 재확인하는 과정에서 갭을 명확히 파악할 수 있었다. "설계 문서 없음 = 미설계 상태" 판단이 빠른 조정으로 이어졌다.

### 4. Stage 5 는 "각 기능 간신함"이 패턴

Stage 3 (새 adapter 협작 4종), Stage 4 (새 FlowNodeHandler 4종) 와 달리 Stage 5 는 기존 구조 위에 가지를 채우는 작업이었다. E1, E3 은 각각 수 시간 내 완료. E2 만 파서 구축으로 소요. 이 패턴이 "Stage 5 = 2-3주"라는 로드맵 예상보다 훨씬 빠른 이유다.

### 5. 46/50 Verify Agent 점수 계단이 Stage 5 에서 발생하지 않음

Stage 3·4 에서 구조적으로 발생했던 "0 issues → 48/50 → 98점, 1 issue → 46/50 → 96점" 계단이 Stage 5 에서는 발생하지 않았다. 3 커밋 전부 48/50 = 98점. 구현 범위가 좁고 집중적이어서 Verify Agent 가 지적할 구조적 문제가 없었다.

---

## Part 2 통합 E2E 시나리오

E5 에서 추가한 통합 시나리오:

| # | 시나리오 | E1 | E2 | E3 |
|---|----------|:--:|:--:|:--:|
| 29 | `$nodes.source.data.items` 로 forEach → `breakCondition { field: '$loop.item', eq: 'stop' }` + `continueOnIterFailure: true` | ✅ | — | ✅ |
| 30 | `breakCondition: "$loop.index >= 2"` (기호 연산자) + `worker.triggerContext` → adapter `$trigger.kind` 캡처 | — | ✅ | ✅ |

**시나리오 29 검증 포인트**:
- `$nodes.source.data.items` (E1): plan 노드 출력 배열을 loop `over` 에서 실제 resolve
- `continueOnIterFailure: true` (E3): 플래그 활성화 상태
- `breakCondition` (E3): `$loop.item == 'stop'` 시 중단, iterationCount=3, terminated='break'

**시나리오 30 검증 포인트**:
- `breakCondition: "$loop.index >= 2"` (E2): 문자열 표현식 → mini-evaluator 평가 → index=2 에서 break
- `worker.triggerContext` (E3): `{ kind: 'task_created', taskId: 'e2e-t', ... }` → adapter `context.$trigger.kind` 캡처
- 중요: 문자열 표현식에서 `gte` (키워드) 대신 `>=` (기호) 사용. 키워드 연산자는 StructuredCondition 전용.

---

## Part 3 $trigger 타입 정리

**E5 에서 수행함** (선택 사항 → 실행).

변경 내용:
- `src/worker/context-builder.ts`: `TriggerContext` 인터페이스에 `[key: string]: unknown` 인덱스 시그니처 추가
- `src/worker/pipeline-facade.ts`: `as unknown as Record<string, unknown>` 캐스팅 제거 → `taskTriggerCtx` 직접 전달

**캐스팅이 불필요해진 이유**: 인덱스 시그니처 `[key: string]: unknown` 추가 시 모든 구체적 필드 타입이 `unknown` 의 서브타입이면 TypeScript 가 `Record<string, unknown>` 호환으로 인정함. `TriggerContext` 의 모든 필드 (string, string 리터럴 유니언, optional string) 는 `unknown` 의 서브타입.

**미완 항목**: `ExecutionContext.$trigger` 와 worker `TriggerContext` 의 통합 (두 타입이 공존 중). Stage 6 에서 정식 통합 권장.

---

## Stage 6+ 이월 항목

| 항목 | 우선순위 | Stage | 설명 |
|------|----------|-------|------|
| DB-backed StateStore | 높음 | Stage 6 | in-memory → SQLite 직렬화, checkpoint/resume |
| Checkpoint 복원 | 높음 | Stage 6 | lastCheckpointAt/resumedFromRunId 컬럼 실활용 |
| DB/worktree 격리 | 중간 | Stage 6 | parallel branch + loop parallelism 에서 race 방지 |
| Pipeline UI | 높음 | Stage 7 | 실시간 진행 상황 표시 |
| Verifier adapter 고도화 | 낮음 | Stage 7 | multi-round verify wrap (현재 최소 wrap) |
| $trigger 타입 통합 | 낮음 | Stage 6 | 두 TriggerContext 타입 통합 |
| spawn 공통 유틸 추출 | 낮음 | 별도 리팩토링 | 3개 파일 중복 spawn 패턴 |
| HookEngine agent/http 통합 | 낮음 | v1.1 | command/script hook 만 Phase P 경유 |
| 설계 문서 sync (9건) | 낮음 | Stage 6 | Stage 3 retro 조정 9건 반영 대기 |
| Slot3 표현식 | 낮음 | v1.5 | 산술/삼항/함수 호출/배열 리터럴 |
| 독립 break/continue 노드 | 중간 | Stage 5+ | type: 'break', type: 'continue' 노드 타입 |
| forEach parallelism > 1 | 중간 | Stage 6 | 격리 구현 후 활성화 |
| human-approval gate | 중간 | Stage 5+ | Slack 알림 + 응답 대기 비동기 패턴 |

---

## 수치 요약

| 항목 | 값 |
|------|----|
| 총 커밋 (Phase P Stage 5) | 5 |
| 신규 파일 | 7 (expression/tokenizer.ts, expression/parser.ts, expression/evaluator.ts, expression/index.ts, worker/context-builder.ts, scheduler/__tests__/loop-break-condition.test.ts, scheduler/__tests__/loop-continue-on-failure.test.ts, worker/__tests__/context-builder-trigger.test.ts) |
| 수정 파일 | ~12 (loop-handler.ts, condition-evaluator.ts, events/types.ts, worker/index.ts, worker/context-builder.ts engine, pipeline-facade.ts, e2e.test.ts, e2e-pipeline.test.ts 외) |
| 테스트 (Stage 5 전) | 716 pass |
| 테스트 (Stage 5 후) | 820+ pass |
| TypeScript 에러 | 0 |
| E2E 시나리오 (누적) | 30 (Stage 2: 15 + Stage 4: 3 + Stage 5 E1: 3 + Stage 5 E2: 6 + Stage 5 E3: 3 + Stage 5 E5: 2) |
| verify:cross 평균 등급 | A (98) |
| 외부 패키지 추가 (24 commits 누적) | 0건 |
| E4 구현 여부 | 미구현 (명시적 이월) |

---

## Exit 기준 체크

- [x] E1: $nodes 실제 주입 — loop forEach `over: '$nodes.X.Y.Z'` 동작 (시나리오 23)
- [x] E1: setLoopCtx 콜백 + FlowRunState.currentLoopCtx 패턴 확립
- [x] E2: ADPL 전용 mini-evaluator — tokenizer + parser + evaluator, 외부 패키지 0건
- [x] E2: string condition 지원 (branch/loop/gate), 9개 비교 연산자
- [x] E3: task_created → PipelineExecutor.run() trigger 연결 (buildTriggerContext)
- [x] E3: WorkerOptions.triggerContext → ExecutionContext.$trigger 주입
- [x] E3: continueOnIterFailure 핸들러 동작 (forEach/while/times)
- [x] E3: breakCondition iteration 종료 후 평가 + flow.loop.break 이벤트
- [x] E5: stage-5-retro.md 작성 (이 문서)
- [x] E5: 통합 E2E 시나리오 29 (E1+E3), 30 (E2+E3) 추가
- [x] E5: TriggerContext 인덱스 시그니처 + 캐스팅 제거 (Part 3)
- [x] Executor.run() 수정 0줄
- [x] E1/E2/E3 handler 수정 0건 (E5 에서)
- [x] legacy 회귀 0건
- [x] 외부 패키지 추가 0건
- [~] E4 (독립 break/continue, forEach parallelism, human-approval) — **명시적 이월**

---

## 다음 단계: Stage 6 Durability + Observability

Stage 6 주요 목표 (로드맵 §Stage 6):
1. **DB-backed StateStore** — in-memory → SQLite 직렬화, pipeline_nodes/node_runs 테이블 활용
2. **Checkpoint 복원** — lastCheckpointAt, resumedFromRunId, resumeCount 컬럼 실활용
3. **DB/worktree 격리** — parallel branch + loop forEach parallelism 에서 race condition 방지
4. **Observability** — pipeline_events 테이블 실활용, 실시간 상태 스트리밍

Stage 5 완료로 "파이프라인 언어(ADPL) + 엔진 코어" 레이어가 완성됨.  
Stage 6 는 이 위에 내구성(Durability) 과 관측 가능성(Observability) 을 추가하는 작업.

> Stage 5 도 1일 완성. Stage 2~5 연속 "하루 몰입" 패턴.  
> v0.5 Beta 출시 후보 마일스톤 도달. Stage 6 진입 전 알려진 이슈 우선순위 재검토 권장.
