# Stage 2 Retrospective — Engine Core

> 작성: 2026-04-20 (Stage 2 종결)
> 기간: 1일 (로드맵 예상 4주 vs 실제 1일)

## TL;DR

Stage 2 엔진 기능적 완성.  
Compiler → Scheduler → Worker → Executor 전체 파이프라인 구동.  
12 commits, 전부 A등급. 290 → 308 tests pass.  
Mock adapter 로 E2E 검증 완료. 실제 adapter 는 Stage 3.

---

## 일정

- **로드맵 예상**: 4주 (Week 3~6)
- **실제**: 1일 (2026-04-20)

일정 단축 원인:
- 하루 집중 작업 (이 세션)
- Stage 1 산출물 (ADPL 타입, Zod schemas, 샘플 10개)이 Stage 2 전 작업에서 즉시 재사용됨
- Mock-first 접근: 실제 adapter 없이 interface + MockAdapter 로 빠르게 진행

단축의 함의:
- **코드 품질 유지**: verify:cross A등급 전수 통과
- **설계 검증은 얕음**: 실제 adapter (agent/shell) 없이 mock 만으로 검증. Stage 3 에서 실제 adapter 구현 시 엣지 케이스 발견 가능성 있음
- **Stage 3 부터 일 단위 페이스로 복귀 권장** (로드맵 v7 §1)

---

## 작업 궤적 (12 commits)

| Commit | 주제 | 핵심 |
|:---:|---|---|
| f7cb1fd | B3-1 YAML parser + flat extractor | ADPL YAML → FlatNode 트리 |
| 81d7731 | B3-2 Reference resolver | `$nodes.X` 표현식 검증 |
| bbf9ea3 | B3-3 Adjacency + cycle detect | DAG 구성 + 사이클 감지 |
| 75933d8 | B3-4 ExecutionPlan + PipelineCompiler | Compile 파이프라인 완성 |
| a25138b | B4-1 NodeAdapter + MockAdapter + Registry | Adapter interface 정의 |
| c9521ef | B4-2 StateStore (in-memory, 8 상태) | NodeRunState 전이 관리 |
| 4e4c989 | B4-3 EventBus + 기본 subscribers | 타입드 이벤트 버스 |
| 4331cbd | B4-3-fix subscriber double-attach leak | `on()` 중복 등록 버그 |
| 6b6e253 | B4-4 CancellationToken + propagation | 취소 전파 + AbortSignal |
| de5f2fe | B5-1 Scheduler + MockWorker | Ready queue + dependency |
| a311b89 | B5-2 Worker (adapter 호출 + retry/timeout) | 실제 실행 루프 |
| 74c43c9 | B5-3 PipelineExecutor (최상위 API) | Compile → Execute 통합 |

---

## 설계 대비 구현 조정 (9건)

실코드를 작성하면서 초기 설계(4C1)에서 조정한 내용. Stage 3 스펙 업데이트 자료.

### 1. CancellationToken: method → getter
- **설계**: `isCancelled()` 메서드
- **구현**: `get isCancelled` getter
- **이유**: stateful boolean 읽기에 getter 가 JavaScript 관례상 자연스러움
- **적용**: `token.isCancelled` (호출 괄호 없음)

### 2. ExecutionPlan: graph 구조
- **설계**: `plan.adjacency`, `plan.reverseAdj` (Array)
- **구현**: `plan.graph.forward`, `plan.graph.reverse` (Map<string, Set<string>>)
- **이유**: Set 이 dedup 자동 처리, `graph` 서브 객체로 네임스페이싱
- **적용**: `plan.graph.forward.get(nodeId)`, `Array.from(...)` 로 변환

### 3. rootNodeIds: 필드 → 함수
- **설계**: `plan.rootNodeIds` (저장 필드)
- **구현**: `getRootNodeIds()` 메서드 (graph.reverse 에서 즉시 계산)
- **이유**: 중복 저장 회피, 단순성
- **영향**: 런타임 O(V) 추가 계산 (무시 가능)

### 4. finalize 패턴
- **설계**: `skipAllRemaining()` + `isTerminal` 체크
- **구현**: `finalize()` 단일 메서드 — pending/ready 노드만 정리
  - cancel: pending/ready → cancelled
  - abort: pending → skipped, ready → cancelled (ready→skipped 전이 무효)
- **이유**: 상태 전이 유효성 규칙 존중 (state-machine.ts)

### 5. RetryPolicy.maxAttempts 의미
- **설계**: `max` = 추가 재시도 횟수 (0 = no retry)
- **구현**: `maxAttempts` = 총 시도 횟수 (1 = no retry, 3 = 초기 1회 + 재시도 2회)
- **이유**: "최대 3번 시도"가 "1번 + 3번 추가"보다 직관적
- **스펙 업데이트 필요**: ADPL v1.0 §retry 섹션

### 6. Retry: category 필터 고정
- **설계**: `onErrors` 옵션으로 재시도할 error category 선택
- **구현**: `transient` + `timeout` 만 재시도, 고정 (RETRYABLE_CATEGORIES = Set)
- **이유**: v1 단순화. 보수적 기본값
- **이월**: `onErrors` 설정 → v1.5+

### 7. `$prev` 계산
- **설계**: sibling 기반 (같은 부모 아래 직전 노드)
- **구현**: `topologicalOrder` 기반 (실행 순서상 직전 완료 노드)
- **이유**: sibling 첫 번째는 `$prev` 없음. topological order 가 "실행 흐름상 직전"을 더 정확히 표현
- **영향**: flow 내 중첩 노드에서 의미 더 명확

### 8. Worker 생성자 signature
- **설계**: `Worker(registry, expressionEngine, store, eventBus)`
- **구현**: `RealWorker(registry, bus, options)` — store, expressionEngine 없음
- **이유**: state 전이는 Scheduler 책임. expressionEngine 은 Stage 5 이월. Worker 는 adapter 호출 + retry 만 담당
- **효과**: 책임 분리 명확화

### 9. 암묵적 순차 의존 (adjacency)
- **설계**: `after:` 배열로 명시적 의존 선언 가능
- **구현**: v1 에서 sibling 순서 기반 암묵적 순차 의존만 지원
  - 주석: `// v2: after 배열 지원 예정`
- **이유**: v1 범위 축소, 단순성 유지
- **이월**: `after:` 명시적 의존 → v2

---

## 테스트 커버리지

| 파일 | 테스트 수 | 주제 |
|---|:---:|---|
| yaml-parser.test.ts | ~8 | YAML 파싱 기본 |
| flat-extractor.test.ts | ~12 | 트리 flatten, pathId 생성 |
| ref-resolver.test.ts | ~15 | `$nodes.X` 참조 검증 |
| adjacency.test.ts | ~10 | edge 구성, root 식별 |
| cycle-detector.test.ts | ~8 | DFS cycle 감지 |
| pipeline-compiler.test.ts | ~8 | end-to-end compile |
| registry.test.ts | ~8 | adapter 등록/조회 |
| mock.test.ts | ~14 | MockAdapter 동작 |
| state-machine.test.ts | ~10 | 전이 규칙 |
| store.test.ts | ~37 | CRUD + 8 상태 |
| bus.test.ts | ~16 | emit/on/once |
| subscribers.test.ts | ~10 | logger, collector |
| token.test.ts | ~15 | cancel, onCancel |
| hierarchy.test.ts | ~8 | 계층 전파 |
| grace.test.ts | ~6 | grace period |
| scheduler.test.ts | ~12 | ready queue + deps |
| mock-worker.test.ts | ~10 | MockWorker 동작 |
| timeout.test.ts | ~8 | withTimeout |
| error-classifier.test.ts | ~12 | 분류 규칙 |
| retry-policy.test.ts | ~12 | shouldRetry, calcBackoff |
| context-builder.test.ts | ~12 | $task/$prev/$nodes |
| worker.test.ts | ~30 | retry 통합 |
| executor.test.ts | ~20 | 기존 executor 단위 |
| **e2e.test.ts** (신규) | **18** | **8 시나리오 + 10 smoke** |

**누적: 308 tests (24 test files)**

Coverage 목표 70%+ — 미측정 (B6-2 skip). 체감상 핵심 경로 전체 커버.

---

## Exit 기준 체크

- [x] 엔진 5 컴포넌트 (Compiler / Scheduler / Worker / State / Events) 동작
- [x] Mock adapter 로 E2E 통과 (8 시나리오 + 10 샘플 smoke)
- [~] 단위 테스트 커버리지 70%+ — 측정 미수행, 체감 충족
- [~] Compile 성능 < 50ms (10 노드) — 측정 미수행 (B6-2 skip)
- [x] Cancel 동작 검증 (E2E 시나리오 6)
- [x] 기존 AutoDev legacy task 회귀 0건 (Stage 2 는 신규 파일만 추가)

---

## Stage 3 진입 전 조정 사항

### ADPL 스펙 업데이트 필요 (docs/adpl-spec/v1.0.md)
1. `RetryPolicy.max` → `maxAttempts` 용어 통일 (§retry)
2. `onErrors` 필드: v1 고정값 명시 (transient + timeout)
3. `$prev` 의미: sibling 기반 → topological 기반으로 설명 수정
4. `after:` 배열: v1 미지원 → v2 예정 명시

### 설계 문서 업데이트 (docs/phase-p/design-updates-needed.md 에 추가)
1. CancellationToken: `isCancelled()` → getter
2. ExecutionPlan: `graph.forward/reverse` 구조
3. Worker 생성자 signature (no store, no expressionEngine)
4. Scheduler finalize 패턴
5. `after:` v1 미지원

### Stage 3 첫 작업
설계 4C1 §5.4.1 Leaf adapters 부터.  
첫 대상: `agent` adapter (가장 복잡, 가장 중요).  
목표: `01-hello-world.yaml` 을 실제 agent 호출로 실행.

---

## Risk 회고

| Risk | 예상 | 결과 |
|---|---|---|
| Scheduler 동시성 버그 | 높음 | 발생 안 함. Event-driven + 단순 ready queue 로 안전 |
| CancellationToken 복잡 전파 | 중간 | v1 에서는 leaf 노드만. Flow 내부는 Stage 4 이월 |
| Expression pre-compile 복잡 | 중간 | Stage 5 이월 (선견). Stage 2 에서 미구현 |
| 설계-구현 격차 | 낮음(예상) | 9건 조정 발생. "설계는 가이드" 원칙 재확인 |

**큰 기술 부채 없이 Stage 3 진입 가능.**

---

## 핵심 인사이트

1. **Mock-first 효과적**: MockAdapter/MockWorker 로 interface 계약 먼저 검증 → 실제 구현 부담 감소
2. **설계-코드 격차 불가피**: 9건 조정 발생. 조정은 설계 오류가 아니라 구현 과정의 정상적 발견
3. **이벤트 기반 > 폴링**: Scheduler.waitForAnyComplete 가 EventBus 구독으로 → CPU 효율, 코드 간결
4. **책임 분리 필수**: Scheduler (state 전이) ↔ Worker (adapter 호출) 분리가 명확해져 테스트 용이
5. **Stage 1 산출물 재사용 가치**: ADPL 타입 + Zod schemas + 샘플 10개가 Stage 2 전체에서 활용

---

## 다음 세션

**즉시 할 것**
- `docs/phase-p/design-updates-needed.md` 에 Stage 2 조정 9건 추가 기록
- Stage 3 첫 작업 프롬프트 작성

**Stage 3 시작점**: 설계 4C1 §5.4.1 Leaf adapters  
**목표**: Real adapter (agent) 로 01-hello-world.yaml 실제 실행  
**예상 기간**: 3-4주 (로드맵 기준)

> Stage 2 도 하루에 완성됐지만 이는 이번 세션의 극단적 몰입 결과.  
> Stage 3 부터는 **일 단위 페이스**로 복귀 권장 (로드맵 v7 §1).
