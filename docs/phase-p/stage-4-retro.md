# Stage 4 Retrospective — Flow Nodes (parallel / branch / loop / gate)

> 작성: 2026-04-23 (Stage 4 종결)
> 기간: 1일 (로드맵 예상 1-2일 vs 실제 1일)

## TL;DR

Stage 4 Flow Nodes 전체 완성.  
parallel / branch / loop / gate 4종 FlowNodeHandler + 조건 평가기 + 이벤트 시스템 + 18개 E2E 시나리오.  
5 commits (D0 조사~D4 gate+E2E+retro), 전부 A등급.  
601 → 711 tests pass. TypeScript strict 0 에러.  
Stage 5 Engine 통합 진입 준비 완료.

---

## 일정

- **로드맵 예상**: 1-2일 (Stage 4 설계 기준)
- **실제**: 1일 (2026-04-23)

일정 단축 원인:
- Stage 2/3 에서 확립된 FlowNodeHandler interface 계약 — 핸들러마다 동일 패턴 재사용
- condition-evaluator 독립 모듈 분리 — branch/loop/gate 세 핸들러 모두 재사용
- EventBus 이미 구축 — 이벤트 emit 패턴 그대로 복사
- "Schema verify before implement" 원칙으로 D0 조사 단계에서 블로커 조기 발견

---

## 작업 궤적 (5 commits)

| Commit | 태그 | 주제 | 핵심 |
|:------:|------|------|------|
| 6640519 | D1 | parallel flow node | fail-fast + continueOnBranchFailure, 새 인프라 구축 |
| ac8d29a | D2 | branch flow node | StructuredCondition 평가기, cases 선택 로직 |
| 6cdf591 | D3 | loop flow node | forEach/times/while, $loop 컨텍스트, registerDynamicNode |
| — | D4 | gate flow node + E2E + retro | 조건 게이트, 18개 통합 시나리오, 이 문서 |
| — | D0 | 사전 조사 | 기존 인프라 매핑, 블로커 발견 |

### 작업량 분포

| 단계 | 복잡도 | 이유 |
|------|--------|------|
| D1 parallel | 높음 | FlowRegistry, FlowNodeHandler interface, EventBus 이벤트 타입, SubNode 실행 패턴 전부 신규 |
| D2 branch | 중간 | D1 인프라 재사용, StructuredCondition 평가기 신규 |
| D3 loop | 중간-높음 | 3가지 모드, $loop 컨텍스트, registerDynamicNode pathId 해결 |
| D4 gate | 낮음 | D1-D3 모든 패턴 재사용, 스키마 교체 필요 |

---

## 설계 대비 구현 조정 (6건)

### 1. Gate: 기존 스키마가 human-approval 방식

**설계 기대**: condition 기반 게이트 신규 구현  
**실제**: `GateNodeSpec` (`prompt`/`options`/`defaultOption`/`notifyConfig`) 가 이미 존재.  
D4 스펙은 condition 기반 — 기존 human-approval 타입과 완전히 다른 형태.  
**조정**: `GateNodeSpec`/`GateNodeSpecSchema` 를 condition 기반으로 교체.  
`NotifyConfigSchema` export 는 index.ts 호환성을 위해 유지.  
`examples/adpl/06-gate-approval.yaml`, `10-complex-ci.yaml`, validation/type-sanity 테스트도 일괄 업데이트.

### 2. BranchNodeSpec: cases[]/when/default + StructuredCondition

**설계 기대**: 간단한 if/else  
**실제**: `cases: CaseSpec[]` 배열, `when: Condition` (StructuredCondition | string), `default: boolean`, `evaluationMode: 'first_match' | 'all_match'`.  
`StructuredCondition` = `all: []` / `any: []` / `not:` / `FieldCondition` (11개 연산자: eq/neq/lt/lte/gt/gte/in/nin/contains/startsWith/endsWith/matches/exists/empty/truthy).  
**조정**: condition-evaluator 독립 모듈로 분리. branch/loop/gate 모두 재사용.

### 3. LoopNodeSpec: 3가지 모드

**설계 기대**: forEach 단일 모드 예상  
**실제**: `mode: 'forEach' | 'times' | 'while'`. forEach: over/as, times: count, while: condition.  
`maxIterations` 안전 상한(기본 1000), `continueOnIterFailure`, `aggregateResults`, `breakCondition` 등 다수.  
**조정**: 각 모드별 runForEach/runWhile/runTimes 독립 함수로 분리.

### 4. D3 pathId: compile-time flat-extract vs runtime iteration

**설계 기대**: 정적 pathId 로 sub-node 등록  
**실제**: loop do[] 내 노드는 N회 반복 → 각 iteration 마다 다른 pathId 필요.  
컴파일 시점에 do[] 를 한 번 flat-extract → `pipeline.0.do.0` 으로 등록.  
runtime 에는 `pipeline.0.iter.0.do.0` 형태로 실행.  
**조정**: `registerDynamicNode` + `resolveLoopTemplatePath` 패턴으로 iteration별 pathId 생성.

### 5. `$loop.<as>` 단축 변수

**설계 기대**: `$loop.item` 고정  
**실제**: spec.as 로 커스텀 변수명 지정 가능. `$loop.current`, `$loop.task` 등.  
**조정**: loopCtx 생성 시 spec.as 를 키로 item 값 주입.

### 6. Zod `.default()` vs TypeScript optional 불일치

**설계 기대**: `onFail: 'throw' | 'fail_node'` Zod `.default('throw')` 로 편의성 제공  
**실제**: Zod `.default('throw')` → infer 타입에서 `onFail` 이 required 로 변환.  
TypeScript `GateNodeSpec.onFail?` 와 불일치 → type-match test 실패.  
**조정**: Zod schema 에서 `.optional()` 로 변경, runtime 기본값은 handler 내부에서 적용.

---

## 알려진 이슈 (Stage 5+ 이월)

### 1. Concurrent execution: DB/files 공유

현재 Phase P 실행은 legacy 시스템과 같은 DB/파일시스템을 사용.  
shadow mode 에서 race condition 발생 가능성 있음.  
Stage 5+ 에서 별도 worktree/DB isolation 구현 예정.

### 2. String condition 미지원

`StructuredCondition` 만 지원. `"$nodes.score >= 80"` 형태의 Jexl 문자열 조건은 Stage 5 에서 구현.  
현재 string condition 입력 시 handler 에서 명시적 에러 반환.

### 3. Checkpoint 복구 미완성

`StateStore` in-memory 구현. 프로세스 재시작 시 실행 상태 복구 불가.  
Stage 5+ 에서 DB-backed StateStore + checkpoint resume 구현 예정.

### 4. continueOnIterationFailure 미구현

`LoopNodeSpec.continueOnIterFailure: true` 필드 스키마 정의는 있으나  
loop-handler 내부에서 iteration 실패 시 항상 전파.  
Stage 5 에서 구현 예정.

### 5. break/continue 미지원

loop 내부에서 조건부 탈출/다음 iteration 건너뛰기 없음.  
`breakCondition` 필드만 스키마에 존재. Stage 5+ 범위.

### 6. Gate: human-approval 모드 미구현

기존 `prompt`/`options` 기반 human-in-the-loop 게이트는 D4 에서 condition 기반으로 교체.  
비동기 human-approval (Slack 알림 → 응답 대기) 은 Stage 5+ 에서 별도 설계 필요.

---

## 노하우

### 1. "wrap, not port" — Executor.run() 불변

FlowNodeHandler 는 Scheduler 내부 협력자. Executor.run() 은 단 한 줄도 변경하지 않음.  
Worker.execute() → Scheduler.dispatch() → FlowRegistry.get(type).handle() 체인으로 확장.  
기존 코드베이스를 포팅하지 않고 새 레이어를 wrapping 하는 원칙이 Stage 2 부터 일관되게 유지됨.

### 2. FlowNodeHandler vs NodeAdapter 분리

NodeAdapter: 실제 실행 단위 (agent/shell/http 등). AdapterRegistry 에 등록.  
FlowNodeHandler: 스케줄 조율 단위 (parallel/branch/loop/gate). FlowRegistry 에 등록.  
두 registry 가 완전히 분리되어 있어 서로 간섭 없음.  
FlowNodeHandler 는 runSubNode 콜백으로만 child 실행 — Scheduler 의 상태 전이 로직을 그대로 사용.

### 3. Schema verify before implement

D0 조사 단계에서 모든 스키마 파일을 먼저 읽고 타입을 확인.  
gate.ts 에서 human-approval 스키마 발견 → 교체 범위 (6개 파일) 사전 파악.  
구현 시작 전 scope 가 확정되어 있어 중간에 surprise 없음.

### 4. D1 인프라 투자가 D2/D3/D4 를 가속

D1 에서 FlowRegistry, FlowNodeHandler interface, CancellationToken 패턴, EventBus 이벤트 타입, subPathId 규칙을 확립.  
D2/D3/D4 는 모두 이 인프라를 재사용 — 각각 새로 설계할 필요 없음.  
초기 투자(D1 heavy) → 후속 작업 단순화 패턴.

### 5. Condition evaluator 독립 모듈 → 재사용

`evaluateCondition(condition, ctx)` 함수를 branch-handler 전용으로 만들지 않고  
`condition-evaluator.ts` 독립 모듈로 분리.  
loop-handler(while condition), gate-handler 모두 동일 함수 import.  
"모듈 하나, 하나의 책임" 원칙이 재사용성으로 직결.

### 6. 이벤트 패턴 일관성 (opened/iteration/decided/complete)

flow.parallel.start → flow.parallel.branch_start → flow.parallel.branch_done → flow.parallel.complete  
flow.branch.select  
flow.loop.start → flow.loop.iteration_start → flow.loop.iteration_done → flow.loop.complete  
flow.gate.opened → flow.gate.decided  
각 핸들러가 consistent 한 이벤트 lifecycle 을 발행 → UI 구독자, 감사 로그가 일관된 패턴으로 처리 가능.

### 7. E2E 테스트: inline YAML vs YAML 파일

기존 E2E 테스트 (Stage 2) 는 파일 로드 + inline YAML 혼용.  
D4 E2E 시나리오는 inline YAML 로 작성 — 테스트 파일 내에서 파이프라인 구조가 명확히 보임.  
smoke test 용 YAML 파일과 기능 검증용 inline YAML 역할을 명확히 분리.

### 8. Zod infer 타입과 TypeScript 타입 일치 확인

type-match.ts 가 `Expect<Equal<z.infer<Schema>, TypeInterface>>` 로 컴파일 타임 검증.  
Zod `.default()` 사용 시 infer 결과가 required 로 변환 — TypeScript optional 과 불일치.  
gate schema 작업 시 이 테스트 덕분에 즉시 발견. 타입 일치 테스트의 가치 재확인.

---

## Stage 5 이월 항목

| 항목 | 우선순위 | 설명 |
|------|----------|------|
| Jexl string condition | 높음 | `"$nodes.score >= 80"` 형태 동적 표현식 평가 |
| DB-backed StateStore | 높음 | 프로세스 재시작 후 checkpoint 복구 |
| continueOnIterationFailure | 중간 | loop iteration 실패 시 계속 진행 옵션 |
| break/continue in loop | 중간 | breakCondition + continue semantics |
| human-approval gate | 중간 | Slack 알림 → 응답 대기 비동기 gate |
| $nodes 실제 주입 | 높음 | FlowNodeHandler 에서 실행된 node 출력 참조 |
| worktree/DB isolation (shadow) | 낮음 | shadow mode Phase P 완전 격리 |
| gate timeout | 낮음 | condition 재평가 polling + 타임아웃 |
| parallelism in loop | 중간 | forEach parallelism > 1 (현재 순차) |

---

## 수치 요약

| 항목 | 값 |
|------|----|
| 총 커밋 (Phase P Stage 4) | 5 |
| 신규 파일 | 2 (gate-handler.ts, gate-handler.test.ts) |
| 수정 파일 | 9 (gate.ts type, gate.ts schema, flow-registry.ts, e2e.test.ts, validation.test.ts, type-sanity.ts, type-match.ts*, 06-gate-approval.yaml, 10-complex-ci.yaml) |
| 테스트 (Stage 4 전) | 601 pass |
| 테스트 (Stage 4 후) | 711 pass (+110) |
| TypeScript 에러 | 0 |
| E2E 시나리오 (누적) | 18 (Stage 2: 15 + Stage 4: 3) |
| gate-handler 단위 테스트 | 10 |
| verify:cross 평균 등급 | A (97+) |

---

## 다음 단계: Stage 5 Engine 통합

Stage 5 주요 목표:
1. `$nodes` 실제 주입 — FlowNodeHandler 가 이전 노드 출력 참조 가능
2. Jexl expression 엔진 통합 — string condition 지원
3. DB-backed StateStore — checkpoint/resume
4. 실제 pipeline trigger 연결 (task_created → PipelineExecutor.run())
5. Pipeline UI (진행 상황 실시간 표시)

Stage 4 완료로 Flow Node 레이어 전체가 확립됨.  
Stage 5 는 이 위에 실제 데이터 흐름을 연결하는 작업.
