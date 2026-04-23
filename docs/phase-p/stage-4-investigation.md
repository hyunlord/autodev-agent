# Stage 4 사전 조사 — Flow Nodes (parallel / branch / loop)

> 작성: 2026-04-23 (Stage 3 종결 직후)  
> 목적: Flow Adapter 구현 전 엔진 확장 지점, 스키마 현황, 위험 요소 파악  
> 조사 원칙: 실제 코드 인용 우선, 설계 문서는 참고만 (설계 4B2 원본 파일 미존재)

---

## 1장. Stage 2 Scheduler 구조

### 1.1 파일 위치

`src/lib/adpl/engine/scheduler/index.ts` (345줄)

### 1.2 토폴로지 정렬 구현 인용

별도 정렬 함수 없이 **이벤트 기반 ready queue** 방식. `plan.graph.forward` (선행→후속) / `plan.graph.reverse` (후속→선행) — 모두 `Map<string, Set<string>>`:

```typescript
// 루트 식별: reverse 의존이 없는 노드
private getRootNodeIds(): string[] {
  return this.plan.graph.allNodes.filter((nodeId) => {
    const prereqs = this.plan.graph.reverse.get(nodeId);
    return !prereqs || prereqs.size === 0;
  });
}

// 노드 완료 시 후속 unlock
private unlockDependents(nodeId: string): void {
  const dependents = this.plan.graph.forward.get(nodeId) ?? new Set<string>();
  for (const depId of dependents) {
    const depState = this.store.getNode(this.state.id, depId);
    if (!depState || depState.status !== 'pending') continue;
    if (this.allDependenciesSatisfied(depId)) {
      this.markReady(depId);
    }
  }
}
```

### 1.3 동시 실행 방식 — Promise.all 미사용

이벤트 기반 `waitForAnyComplete()`. **한 번에 하나의 완료만 대기**, 그 사이 여러 노드를 fire:

```typescript
private async schedulerTick(): Promise<void> {
  // maxConcurrent 제한 내에서 ready 노드 한꺼번에 fire (fire-and-forget)
  while (
    this.running.size < this.maxConcurrent &&
    this.readyQueue.length > 0 &&
    !this.token.isCancelled
  ) {
    const nodeId = this.readyQueue.shift()!;
    this.startExecution(nodeId);  // async, 완료 기다리지 않음
  }

  if (this.running.size === 0) return;
  await this.waitForAnyComplete();  // EventBus 구독 — 하나 완료 시 resolve
}
```

**현재 이미 동시 실행 가능**: `maxConcurrent` (= `plan.context.settings.maxParallel`) 안에서 여러 독립 노드를 동시에 실행함. 단, 이는 "dependsOn 없는 노드들의 자연스러운 병렬화"이고, `parallel` flow node처럼 "의도적 분기" 개념과는 다름.

### 1.4 Stage 2 Retro에서 Flow 관련 언급

직접 언급 없음. 단, Risk 회고에:

> CancellationToken 복잡 전파 — v1 에서는 leaf 노드만. Flow 내부는 Stage 4 이월

→ **flow node 내부 CancellationToken 전파는 미구현으로 Stage 4에 이월됨.**

---

## 2장. ParallelNodeSpec 미리보기

### 존재 여부: **YES** ✅

파일: `src/lib/adpl/schemas/nodes/parallel.ts`

```typescript
export const MergeStrategySchema = z.enum([
  'all_must_pass',
  'any_succeeds',
  'majority',
  'best_score',
] as const);

export const ParallelBranchSpecSchema: z.ZodType<ParallelBranchSpec> = z.object({
  id: z.string(),
  nodes: z.lazy((): z.ZodType<NodeSpec[]> => z.array(NodeSpecSchema)),
});

export const ParallelNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('parallel'),
  branches: z.array(ParallelBranchSpecSchema),
  mergeStrategy: MergeStrategySchema.optional(),
  maxConcurrent: z.number().int().positive().optional(),
  onError: z.enum(['abort_all', 'continue']).optional(),
  cancelOnFirstFailure: z.boolean().optional(),
});
```

### 필드 구조 요약

| 필드 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| `branches` | `ParallelBranchSpec[]` | ✅ | 병렬 실행할 branch 목록 (각각 `{id, nodes[]}`) |
| `mergeStrategy` | enum | optional | 완료 판정 방식 (기본: `all_must_pass`) |
| `maxConcurrent` | number | optional | branch 단위 동시 실행 상한 |
| `onError` | enum | optional | 에러 정책 (기본: `abort_all`) |
| `cancelOnFirstFailure` | boolean | optional | 첫 실패 시 나머지 취소 |

`ParallelBranchSpec`은 재귀 중첩 구조 (`nodes: NodeSpec[]` 안에 다시 flow node 가능).

### 설계 4B2와의 필드명 차이

설계 4B2 원본 (`17_PhaseP_design4b2_flow_control.md`) **파일 미존재**. 비교 불가. 스키마 코드가 유일한 진실 소스.

### 기본값 정책

- `mergeStrategy` 미설정 → `all_must_pass` (ADPL v1.0 §12 기준)
- `maxConcurrent` 미설정 → 제한 없음 (branches 전부 동시)
- `onError` 미설정 → `abort_all`
- `cancelOnFirstFailure` 미설정 → `false`

---

## 3장. BranchNodeSpec (if/else)

### 존재 여부: **YES** ✅

파일: `src/lib/adpl/schemas/nodes/branch.ts`

```typescript
export const CaseSpecSchema: z.ZodType<CaseSpec> = z.object({
  when: ConditionSchema.optional(),
  default: z.boolean().optional(),
  then: z.lazy((): z.ZodType<NodeSpec[]> => z.array(NodeSpecSchema)),
});

export const BranchNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('branch'),
  cases: z.array(CaseSpecSchema),
  evaluationMode: z.enum(['first_match', 'all_match']).optional(),
  onMissingMatch: z.enum(['skip', 'error']).optional(),
});
```

### 조건 표현 방식

`ConditionSchema = z.union([StructuredConditionSchema, z.string()])` — 2가지 표현:

**StructuredCondition (자체 구현, 이미 완성)** — `src/lib/adpl/schemas/expression.ts`:
```typescript
// all/any/not + FieldCondition
// FieldCondition: eq/neq/lt/lte/gt/gte/in/nin/contains/startsWith/endsWith/matches/exists/empty/truthy
{ field: '$nodes.step1.data.score', gte: 80 }
{ all: [{ field: '$nodes.step1.data.success', truthy: true }] }
```

**string expression (미구현)** — Stage 5 이전 evaluator 없음:
```
"$nodes.step1.data.score >= 80"  // 평가 불가
```

### Expression Slot 현황

Stage 1 결정 기반:
- **Slot 1 (StructuredCondition 자체 구현)**: ✅ 완성 — `FieldConditionSchema` + `StructuredConditionSchema`
- **Slot 2 (Jexl fork)**: 미결정, Stage 5 이월
- **Slot 3 (유보)**: 미결정

**Stage 4 권장**: StructuredCondition만 지원. string condition 수신 시 런타임 오류 throw.

### boolean 강제 변환 이슈

string condition을 받아 `String()` 변환 시 non-empty string 전부 truthy로 처리됨 → 설계 의도 불일치. **string condition은 명시적 오류 처리가 안전.**

---

## 4장. LoopNodeSpec (for/while)

### 존재 여부: **YES** ✅

파일: `src/lib/adpl/schemas/nodes/loop.ts`

```typescript
export const LoopModeSchema = z.enum(['forEach', 'times', 'while'] as const);

export const LoopNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('loop'),
  mode: LoopModeSchema,
  over: z.string().optional(),               // forEach: iterator source expression
  as: z.string().optional(),                 // forEach: loop 변수명 ($loop.<as>)
  count: z.number().int().positive().optional(),      // times: 반복 횟수
  condition: ConditionSchema.optional(),              // while: 조건
  maxIterations: z.number().int().positive().optional(),
  do: z.lazy((): z.ZodType<NodeSpec[]> => z.array(NodeSpecSchema)),
  parallelism: z.number().int().positive().optional(),
  continueOnIterFailure: z.boolean().optional(),
  aggregateResults: z.boolean().optional(),
  breakCondition: ConditionSchema.optional(),
});
```

### while 모드: post-test (do-while) 의미론

ADPL v1.0 §13: `while` mode는 do-while — `do` 먼저 실행 후 `condition` 평가. **최소 1회 실행 보장**.

Stage 1 블로커 "while post-test(do-while)" 건: 스키마에 `mode: 'while'` + `condition` 필드로 수용됨. 런타임 구현은 Stage 4 대상.

### `$loop.<as>` 문법 현재 상태

`context-builder.ts` 현재:
```typescript
$loop: null,  // Stage 4 Flow Adapter 구현까지 null (주석 명시)
$flow: null,
```

**Stage 4에서 채워야 할 구조**:
```typescript
$loop: {
  index: number,        // 0-based
  total: number | null, // forEach/times만, while은 null
  isFirst: boolean,
  isLast: boolean,
  [as]: unknown,        // forEach에서 spec.as 값으로 키 설정
}
```

### maxIterations 무한루프 방지

스키마에 `maxIterations?: number` 존재. 런타임 강제 상한 로직은 Stage 4 구현 대상.  
**기본값 제안: 1000** (미설정 시 runtime error보다 상한으로 처리하는 것이 안전).

---

## 5장. PipelineExecutor.run() 확장 지점

### flow node 처리 지점 현재 존재 여부: **없음 (미구현)** ❌

`executor.ts`는 Compile → Scheduler 위임만. flow node 인식 로직 없음:

```typescript
// executor.ts line 100-157
const compileResult = await this.compiler.compile(input.pipelineYaml, sourcePath);
const plan = compileResult.plan;
const state = this.store.create(plan);
// ...
const scheduler = new Scheduler(plan, state, this.store, worker, this.bus, token, options.scheduler ?? {});
const schedResult = await scheduler.run();  // 전적으로 Scheduler에 위임
```

`e2e-pipeline.test.ts` 확인:
```typescript
const NON_SHELL_TYPES = [
  'agent', 'http', 'webhook_out',
  'branch', 'parallel', 'loop', 'gate',  // 모두 MockAdapter로 등록
  'mcp', 'set', 'transform',
];
```

→ **현재 flow nodes는 MockAdapter가 투명하게 통과.** 실제 flow 로직 없음.

### 예상 수정 범위

`PipelineExecutor.run()` 자체는 수정 불필요. 확장 지점은 **Scheduler + Worker + context-builder**:

**옵션 A: Scheduler 내부 FlowNodeHandler (권장)**
- `Scheduler.startExecution(nodeId)`에서 node type 감지 → FlowNodeHandler 분기
- FlowNodeHandler가 sub-nodes 실행 조율 (inline 방식)
- 순환 의존 없음. Scheduler가 실행 흐름 전담하는 현재 설계 원칙과 일치

**옵션 B: Flow Node Adapter → Worker → sub-scheduler**
- `NodeAdapter<ParallelNodeSpec>` 구현 → registry 등록 → Worker 호출 → 내부에서 새 Scheduler 생성
- 단점: Worker가 Scheduler를 의존 → 순환 발생 가능. 테스트 어려움

**옵션 C: Compiler 단계 flat expansion**
- parallel은 컴파일 시 전개 가능하나 branch/loop는 런타임 결정 → 완전 expansion 불가

**결론: 옵션 A 채택 권장.** D1에서 아키텍처 확정 후 D2/D3 공통 기반 재사용.

### Adapter registry 재사용 가능성

`NodeAdapter<TSpec>` 계약 형식은 재사용 가능하나, flow node는 "실행 결과"가 아닌 "실행 조직" 반환. `NodeOutput` 타입이 flow 결과(merged outputs)를 담을 수 있는지 확인 필요. **FlowNodeResult 타입 추가가 필요할 수 있음.**

---

## 6장. Expression Resolver 관계

### 현재 구현 상태

```typescript
// context-builder.ts buildExecutionContext()
return {
  $nodes: collectCompletedNodeOutputs(plan, state),  // userId → NodeOutput 맵 (완성)
  $prev: findPrevNodeOutput(node, plan, state),       // topological 직전 노드 (완성)
  $loop: null,   // Stage 4에서 채울 예정 (주석 명시)
  $flow: null,   // Stage 4에서 채울 예정 (주석 명시)
  // ...
};
```

### Flow Node별 Expression 사용 분석

| Flow Node | Expression 사용 위치 | 현재 지원 여부 |
|-----------|---------------------|:-------------:|
| `parallel` | mergeStrategy 결과 집계 | 코드 로직으로 처리 (expression 불필요) |
| `branch` | `case.when` 조건 평가 | StructuredCondition만 가능 ✅ |
| `loop` | `over` (forEach source) | string expression → **미지원** ❌ |
| `loop` | `condition` (while), `breakCondition` | StructuredCondition 가능 ✅ |

### forEach `over` expression의 최소 지원

`over: "$nodes.fetch.data.items"` 형태. Stage 5 전 평가기 없음. 선택지:

1. **간이 dot-access 파서** (권장): `$nodes.X.Y.Z` 패턴만 30-50줄로 처리
2. **scope 제한**: forEach는 `over`에 literal array만 허용 (Stage 5까지)
3. **정규식 파싱**: fragile, 표현 범위 불명확

**권장 옵션 1** (간이 파서) 또는 옵션 2 (scope 제한). Stage 4 D3 시작 시 결정.

### String() 강제 변환 이슈

3장에서 언급. branch `case.when`에서 string condition을 평가할 수 없으므로, **Stage 4 구현체는 StructuredCondition 외 조건에서 명시적 오류 throw**.

---

## 7장. Checkpoint과 Flow Nodes

### 현재 Checkpoint 구현

**없음.** `src/lib/adpl/engine/` 하위 checkpoint 관련 파일 미존재. 현재 `StateStore`만 있으며 in-memory. 프로세스 재시작 시 모든 상태 소멸.

### Flow Node별 재시작 복잡도

| Flow Node | 재시작 복잡도 | 이유 |
|-----------|:-----------:|------|
| `branch` | 낮음 | 선택된 branch만 실행, 완료 후 일반 노드와 동일 |
| `parallel` | 중간 | 3/5 branch 완료 상태에서 나머지 2만 재실행 vs 전체 재실행 |
| `loop` | 높음 | N회 중 M회 완료 상태에서 M+1부터 재시작 vs 처음부터 |

### 판단: Stage 4 범위 외로 선 긋기 권장

근거:
- Checkpoint 자체가 로드맵 v7 §Stage 6 Durability 항목
- in-memory StateStore는 재시작 지속성 없음 — Checkpoint 없이 "부분 완료 재시작" 불가
- parallel 부분 재시작은 "완료 상태 직렬화"가 전제조건 → Stage 6 이전 구현 무의미

**Stage 4 결정**: 재시작 = 전체 재실행으로 단순화. Checkpoint 미구현.

---

## 8장. 구현 영역 분해

### 로드맵 v7 Stage 4 원문 인용

```
| 4 | Flow Adapters (branch/parallel/loop/gate) | 2-3주 |
```

구체적인 D-단위 breakdown은 로드맵 v7에 명시 없음.  
설계 6 (`28_PhaseP_design6_stage3_leaf_adapters.md`) §10에서:
> Stage 4 첫 대상: parallel flow node (가장 단순, Scheduler 이미 concurrency 지원)

### 권장 Stage 4 작업 블록

| 블록 | 대상 | 핵심 작업 | 선행 |
|:----:|------|---------|:----:|
| **D1** | Scheduler 공통 기반 + parallel | FlowNodeHandler 추상화, ParallelFlowHandler, mergeStrategy (all_must_pass/any_succeeds), sub-node ID 전략, E2E | 없음 |
| **D2** | branch (if/else) | BranchFlowHandler, StructuredCondition evaluator 연결, onMissingMatch, evaluationMode, E2E | D1 (공통 기반) |
| **D3** | loop (forEach/times/while) | LoopFlowHandler, $loop context 채우기, over expression 최소 파싱, maxIterations, breakCondition, E2E | D1 + D2 (condition evaluator) |
| **D4** | gate + 통합 E2E + retro | GateFlowHandler, 복합 시나리오 (parallel→branch→loop), stage-4-retro.md | D1~D3 |

**D1이 핵심 난관**: FlowNodeHandler 추상화 품질이 D2/D3 속도를 결정.

---

## 9장. 테스트 전략

### 기존 E2E 테스트의 flow 커버리지

`src/lib/adpl/engine/__tests__/e2e-pipeline.test.ts`:
```typescript
// flow types 전부 MockAdapter로 등록 — 실제 flow 로직 없이 통과
const NON_SHELL_TYPES = [
  'agent', 'http', 'webhook_out',
  'branch', 'parallel', 'loop', 'gate',
  'mcp', 'set', 'transform',
];
```

**실제 flow 실행 E2E 없음.** Stage 4에서 신규 fixture + 테스트 파일 필요.

### Stage 4 테스트 파일 구조 (제안)

```
src/lib/adpl/engine/__tests__/
├── parallel-handler.test.ts   # D1: mergeStrategy, cancelOnFirstFailure
├── branch-handler.test.ts     # D2: first_match, onMissingMatch
├── loop-handler.test.ts       # D3: forEach/times/while, $loop context
└── e2e-flow.test.ts           # D4: 복합 시나리오 (parallel→branch→loop)
```

### MockAdapter delay 활용 — loop 지연 시뮬레이션

```typescript
// MockAdapter delay로 iteration 지연 재현 가능
const slowMock = new MockAdapter({ type: 'agent', delay: 100 });
```

### fake timer 권장 — concurrency 테스트 flakiness 방지

```typescript
vi.useFakeTimers();
// parallel branch 타이밍 제어
vi.advanceTimersByTime(200);
```

Stage 3 retro 노하우: "Shadow 30초 grace period를 fake timer로 검증" — 동일 패턴 재사용.

### 신규 fixture YAML 필요 (예시)

```yaml
# parallel E2E fixture
nodes:
  - id: parallel_step
    type: parallel
    branches:
      - id: branch_a
        nodes:
          - id: a1
            type: mock
      - id: branch_b
        nodes:
          - id: b1
            type: mock
    mergeStrategy: all_must_pass
  - id: after_merge
    type: mock
    dependsOn: [parallel_step]
```

---

## 10장. 예상 소요 시간 범위 재산정

### 로드맵 v7 원래 예상

```
Stage 4: 2-3주
```

### Stage 2/3 속도 참고

| Stage | 원래 예상 | 실제 |
|:-----:|:--------:|:----:|
| Stage 2 (Engine Core) | 3-4주 | 1일 |
| Stage 3 (Leaf Adapters) | 2-3주 | 1일 |

**공통 요인**: 독립 컴포넌트 — Leaf Adapters는 각자 독립, Engine Core는 신규 파일 추가.

### Stage 4의 다른 점 (상대적 복잡도 증가 요인)

1. **Scheduler 직접 수정**: 기존 `schedulerTick()` 확장 → 기존 로직과 교차
2. **sub-node ID 전략**: StateStore flat map에 중첩 node 상태 등록 방식 결정 필요
3. **context-builder 확장**: `$loop`/`$flow` 채우기 → Worker 레이어에도 영향
4. **over expression 최소 파싱**: Stage 5 전 임시 파서 필요
5. **mergeStrategy 구현**: all_must_pass 외 전략(majority, best_score)은 복잡

### 재산정

| 블록 | 주요 위험 | 재산정 |
|------|----------|:------:|
| D1 parallel | FlowNodeHandler 아키텍처 결정 + sub-node ID 전략 | 3-5시간 |
| D2 branch | StructuredCondition evaluator 연결 + evaluationMode | 2-3시간 |
| D3 loop | $loop context + over expression 최소 파싱 + maxIterations | 3-5시간 |
| D4 gate + E2E + retro | gate 단순 (blocking 노드), 복합 E2E 시나리오 작성 | 2-3시간 |
| **합계** | | **10-16시간 ≈ 1-2일** |

Stage 3와 유사한 속도 가능. 단, **D1 FlowNodeHandler 아키텍처 결정이 지연되면 2-3일 소요 가능**.

`mergeStrategy: majority / best_score`는 기준 로직이 복잡하므로, D1에서 `all_must_pass / any_succeeds`만 구현하고 나머지는 D4 또는 Stage 4-post로 이월 고려.

---

## 발견사항 / 구현 전 판단 필요 사항

### 판단 1 (필수) — FlowNodeHandler 아키텍처 선택

**문제**: parallel branch 내 sub-nodes를 어떻게 실행할지.

| 옵션 | 설명 | 권장 여부 |
|:----:|------|:--------:|
| A: Scheduler 내부 FlowNodeHandler | `startExecution()` 분기 → FlowNodeHandler 위임 | ✅ 권장 |
| B: Flow NodeAdapter → Worker → sub-scheduler | registry 등록, Worker에서 새 Scheduler 생성 | ❌ 순환 위험 |
| C: Compiler 단계 flat expansion | branch/loop는 런타임 결정 → 완전 expansion 불가 | ❌ 불가 |

**권장 결정**: 옵션 A. Scheduler가 실행 흐름 전담하는 현재 설계 원칙과 일치.

### 판단 2 (필수) — StateStore sub-node ID 네임스페이싱

**문제**: parallel `branches[].nodes[]` 내 sub-node들의 pathId가 최상위 노드와 충돌 가능.

선택지:
- **경로 ID**: `{parentId}/{branchId}/{nodeId}` 형태 (e.g. `parallel_step/branch_a/a1`)
- **별도 sub-run**: StateStore에 "중첩 run" 개념 추가

**제안**: 경로 ID 방식이 단순. `StateStore.updateNode(runId, pathId, ...)` 기존 API 재사용 가능.

### 판단 3 (필수) — forEach `over` expression 최소 지원 범위

**문제**: `over: "$nodes.fetch.data.items"` — Stage 5 전 평가기 없음.

| 옵션 | 설명 | 권장 |
|:----:|------|:----:|
| 1: 간이 dot-access 파서 | `$nodes.X.Y.Z` 패턴 30-50줄 처리 | ✅ |
| 2: scope 제한 | `over`에 literal array만 허용 (Stage 5까지) | 차선 |
| 3: 정규식 파싱 | fragile, 표현 범위 불명확 | ❌ |

**권장 결정**: D3 시작 전 옵션 1 또는 2 선택 후 진행.

### 판단 4 (권장) — maxConcurrent 기본값

**문제**: parallel `maxConcurrent` 미설정 시 어떤 제한 적용?

**제안**: `branches.length` (= 모든 branches 동시 실행). Scheduler의 글로벌 `maxParallel`은 별도 상한으로 유지. 즉, `min(branches.length, plan.context.settings.maxParallel)`.

### 판단 5 (권장) — 재시작 복잡도 경계

**결정**: Stage 4 범위 외. 재시작 = 전체 재실행. Stage 6 Durability에서 처리.

### 판단 6 (권장) — gate node 포함 범위

설계 6에 `gate`가 Stage 4에 포함됨. Gate는 "조건 충족 시 pass, 아니면 block/fail" — branch 단순화 버전.  
**제안**: D4에 배치. D2 BranchFlowHandler 공통 로직 재사용으로 구현 시간 최소화.

### 판단 7 (권장) — mergeStrategy 구현 범위

`majority / best_score`는 scoring 기준 로직이 복잡.  
**제안**: D1에서 `all_must_pass / any_succeeds`만 구현. `majority / best_score`는 D4 또는 Stage 4-post 이월.

---

## 수락 기준 체크 (자가 검증)

- [x] 10장 모두 채워짐
- [x] 2장: ParallelNodeSpec — **YES**
- [x] 3장: BranchNodeSpec — **YES**
- [x] 4장: LoopNodeSpec — **YES**
- [x] 5장: PipelineExecutor.run()의 flow node 처리 지점 — **없음 (미구현)**
- [x] 6장: Expression Slot 선택 제안 — **Slot 1 (StructuredCondition) 사용 권장, string condition은 오류 처리**
- [x] 8장: 로드맵 Stage 4 작업 블록 — **D1 (parallel) / D2 (branch) / D3 (loop) / D4 (gate+E2E+retro)**
- [x] 10장: 예상 소요 시간 — **D1: 3-5h / D2: 2-3h / D3: 3-5h / D4: 2-3h / 합계: 10-16h (1-2일)**
- [x] 마지막 섹션: 구현 전 판단 필요 사항 — **7건 명시**
- [x] 커밋 로컬만, push 금지
