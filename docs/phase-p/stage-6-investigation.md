# Stage 6 사전 조사 — Durability + Observability

> 작성: 2026-04-24 (Stage 5 완료 직후)
> 목적: Stage 6 구현 전 코드베이스 현황 파악 및 설계 판단 준비
> 수정 금지: 이 문서는 조사 산출물, 코드/테스트 수정 없음

---

## 1장. 로드맵 §Stage 6 구성

### 1.1 원본 로드맵 인용

**출처**: `AutoDev_로드맵_v7.md` (사전 선행 독본에 기재된 `docs/phase-p/27_PhaseP_roadmap_v1.md` 는 **파일 없음**. 동일 패턴 확인.)

로드맵 표 (line 106):

```
| 6 | Durability + Observability | 2주 | |
```

전체 Stage 궤적 (lines 98–108):

```
| 1 | Foundation (DB + 스펙 + 타입 + CLI)               | 1-2주 | ✅ 완료 |
| 2 | Engine Core (Compiler/Scheduler/Worker/State)     | 3-4주 | ✅ 완료 |
| 3 | Leaf Adapters (agent/shell/http/webhook_out)      | 2-3주 | ✅ 완료 |
| 4 | Flow Adapters (branch/parallel/loop/gate)         | 2-3주 | ✅ 완료 |
| 5 | Triggers + Expression                             | 2-3주 | ✅ 완료 |
| — | v0.5 Beta 출시 후보                                 |   —   |       |
| 6 | Durability + Observability                        |  2주  |   →   |
| 7 | UX Layer (YAML editor + AI Builder)               | 3-4주 |       |
| — | v1.0 RC → GA                                      |   —   |       |
```

### 1.2 Stage 6 상세 정의 (로드맵 내 없음 → retro 에서 추출)

로드맵 v7 에는 Stage 6 의 서브블록(F1/F2/…) 정의가 **없다**. Stage 5 retro (`stage-5-retro.md` §Stage 6+ 이월 항목)에서 추출한 Stage 6 범위:

| 항목 | 우선순위 | 출처 |
|------|----------|------|
| DB-backed StateStore (in-memory → SQLite 직렬화) | 높음 | stage-5-retro.md:219 |
| Checkpoint 복원 (lastCheckpointAt/resumedFromRunId 활용) | 높음 | stage-5-retro.md:220 |
| DB/worktree 격리 (parallel branch + loop parallelism race 방지) | 중간 | stage-5-retro.md:221 |
| $trigger 타입 통합 (두 TriggerContext 타입 통합) | 낮음 | stage-5-retro.md:224 |
| 설계 문서 sync (Stage 3 retro 조정 9건) | 낮음 | stage-5-retro.md:227 |
| forEach parallelism > 1 (격리 구현 후 활성화) | 중간 | stage-5-retro.md:230 |
| Pipeline UI → **Stage 7** 로 이월 | 높음 | stage-5-retro.md:222 |

Stage 5 retro (line 275-282) 의 Stage 6 주요 목표 요약:

> 1. DB-backed StateStore — in-memory → SQLite 직렬화, pipeline_nodes/node_runs 테이블 활용
> 2. Checkpoint 복원 — lastCheckpointAt, resumedFromRunId, resumeCount 컬럼 실활용
> 3. DB/worktree 격리 — parallel branch + loop forEach parallelism 에서 race condition 방지
> 4. Observability — pipeline_events 테이블 실활용, 실시간 상태 스트리밍

---

## 2장. 현재 StateStore 구조

### 2.1 파일 위치

`src/lib/adpl/engine/state/store.ts` (185줄)

### 2.2 저장 구조

```typescript
// store.ts:14
private runs = new Map<string, PipelineRunState>();
```

**Map 기반 (in-memory only)**. 프로세스 재시작 시 전부 소멸.

### 2.3 주요 API 메서드 목록

| 메서드 | 시그니처 | 위치 | 설명 |
|--------|---------|------|------|
| `create` | `(plan: ExecutionPlan): PipelineRunState` | line 16 | 새 run 초기화 |
| `get` | `(runId: string): PipelineRunState \| null` | line 49 | run 조회 |
| `getNode` | `(runId, nodeId): NodeRunState \| null` | line 53 | 노드 상태 조회 |
| `getFlow` | `(runId, flowNodeId): FlowRunState \| null` | line 57 | flow 상태 조회 |
| `registerDynamicNode` | `(runId, nodeId): void` | line 65 | 런타임 노드 등록 (idempotent) |
| `updateNode` | `(runId, nodeId, updater): NodeRunState` | line 73 | 노드 상태 업데이트 (전이 검증 포함) |
| `updateFlow` | `(runId, flowNodeId, updater): FlowRunState` | line 94 | flow 상태 업데이트 |
| `updatePipeline` | `(runId, status): PipelineRunState` | line 109 | 파이프라인 상태 전이 |
| `incrementMetrics` | `(runId, deltas): void` | line 119 | cost/token 누적 |
| `listByStatus` | `(runId, status): NodeRunState[]` | line 130 | 상태별 노드 목록 |
| `listReady` | `(runId): NodeRunState[]` | line 136 | ready 노드 목록 |
| `listRunning` | `(runId): NodeRunState[]` | line 140 | running 노드 목록 |
| `isAllTerminal` | `(runId): boolean` | line 144 | 전체 종료 여부 |
| `delete` | `(runId): boolean` | line 153 | run 제거 |
| `size` | `(): number` | line 157 | 저장된 run 수 |

**없는 메서드**: `restore()`, `load()`, `serialize()` — DB 백업/복원 관련 메서드 전무.

### 2.4 registerDynamicNode 위치 (Stage 4 D3)

`store.ts:65-71`:

```typescript
registerDynamicNode(runId: string, nodeId: string): void {
  const state = this.runs.get(runId);
  if (!state) throw new Error(`PipelineRun "${runId}" 가 존재하지 않습니다`);
  if (!state.nodes.has(nodeId)) {
    state.nodes.set(nodeId, { nodeId, status: 'pending', attemptNumber: 0 });
  }
}
```

loop 반복 실행 시 컴파일 타임에 없는 pathId 를 런타임 등록.

### 2.5 FlowRunState.currentLoopCtx + setLoopCtx (Stage 5 E1)

- `currentLoopCtx?: LoopContext` — `src/lib/adpl/engine/state/types.ts:42` (FlowRunState 인터페이스 필드)
- `setLoopCtx` 콜백 — `src/lib/adpl/engine/scheduler/index.ts:152-160` (buildFlowHandlerOptions 내부 정의)
  - loop-handler 가 각 iteration 시작 시 호출 → Scheduler 가 StateStore `currentLoopCtx` 업데이트 → Worker 가 `$loop` 주입
  - 순환 의존 방지를 위한 콜백 주입 패턴

### 2.6 FlowRunState 내 복원 가능 필드

```typescript
// parallel: branchResults = Map<branchId, 'pending'|'completed'|'failed'>
{ flowNodeId, type: 'parallel', branchResults: Map<string, ...> }

// loop: iteration 진행 상태
{ flowNodeId, type: 'loop', currentIteration: 0, completedIterations: 0, iterationResults: [] }
```

`store.ts:166-184` — 이 필드들은 DB 직렬화 없이 메모리에만 존재.

---

## 3장. DB 스키마 현황 vs 사용 현황 대조

### 3.1 pipeline_runs Checkpoint 관련 컬럼

`src/lib/db/schema.ts:184-218` 에서 `pipeline_runs` 테이블 전체 컬럼 확인:

```typescript
export const pipelineRuns = sqliteTable('pipeline_runs', {
  id:                text('id').primaryKey(),
  taskId:            text('task_id').notNull(),
  pipelineVersionId: text('pipeline_version_id').notNull(),
  projectId:         text('project_id').notNull(),
  status: text('status', {
    enum: ['initializing', 'running', 'completed', 'failed', 'cancelled', 'resumed'],
  }).notNull(),
  startedAt:         text('started_at').notNull(),
  completedAt:       text('completed_at'),
  lastCheckpointAt:  text('last_checkpoint_at'),          // ← Checkpoint 컬럼 1
  nodesCompleted: integer('nodes_completed').default(0),
  nodesFailed:    integer('nodes_failed').default(0),
  totalCostUsd:   real('total_cost_usd').default(0),
  totalTokensIn:  integer('total_tokens_in').default(0),
  totalTokensOut: integer('total_tokens_out').default(0),
  triggerContext: text('trigger_context', { mode: 'json' }),
  error:         text('error', { mode: 'json' }),
  failedNodeId:  text('failed_node_id'),
  resumedFromRunId: text('resumed_from_run_id'),          // ← Checkpoint 컬럼 2
  lastResumedAt:    text('last_resumed_at'),
  resumeCount:      integer('resume_count').default(0),   // ← Checkpoint 컬럼 3
}, ...);
```

`'resumed'` — status enum 값으로 포함됨 (`schema.ts:192`).

### 3.2 Checkpoint 컬럼 사용 현황 (grep 결과)

| 컬럼 | 스키마 정의 | src/ 내 write 코드 | 결론 |
|------|------------|-------------------|------|
| `lastCheckpointAt` | schema.ts:197 | **NO** — docs/ 만 (stage-5-investigation.md, stage-5-retro.md) | 미사용 |
| `resumedFromRunId` | schema.ts:210 | **NO** — docs/ 만 | 미사용 |
| `resumeCount` | schema.ts:212 | **NO** — docs/ 만 | 미사용 |
| `status = 'resumed'` | schema.ts:192 (enum) | **NO** — write 코드 없음 | 미사용 |

**요약**: 4개 컬럼 모두 스키마 정의는 있으나, 실제로 이 값을 쓰는 src/ 코드 **0줄**.

### 3.3 pipeline_events 테이블 존재 여부

`src/lib/db/schema.ts` 에서 `pipelineEvents|pipeline_events` grep → **NO MATCHES**.

`pipeline_events` 라는 Drizzle 테이블은 **존재하지 않는다**. CLAUDE.md 의 Phase P 추가 테이블 목록에는 `pipeline_events` 가 기재되어 있으나 실제 schema.ts 에 정의 없음. 미구현 상태.

### 3.4 events 테이블 (legacy) 사용 현황

`src/lib/db/schema.ts:73-82` 에 `events` 테이블 존재 (legacy pipeline 전용):

```typescript
export const events = sqliteTable('events', {
  id, taskId, type, data, createdAt
});
```

실제 write 위치:
- `src/worker/pipeline.ts:27` — legacy pipeline 시작 시
- `src/worker/pipeline.ts:1268` — legacy pipeline recordEvent 함수
- `src/worker/pipeline-facade.ts:24` — facade 레벨 이벤트

Phase P executor (PipelineExecutor) 는 in-memory EventBus 만 사용하며 이 `events` 테이블에도 **write 안 함**.

---

## 4장. Worker Lifecycle

### 4.1 진입점 파일

**`src/worker/pipeline-facade.ts`** — Phase P + legacy + shadow 분기 진입점

```typescript
// pipeline-facade.ts:45-75
export async function runPipeline(
  taskId: string,
  rawEmit: EmitFn,
  signal?: AbortSignal,
): Promise<void> {
  const mode: string = task.pipelineMode ?? 'legacy';
  switch (mode) {
    case 'legacy':  return runLegacyPipeline(taskId, rawEmit, signal);
    case 'phase_p': return runPhasePPipeline(task, emit);
    case 'shadow':  return runShadow(task, rawEmit, emit, signal);
    default:        failTask(taskId, emit, 'UNKNOWN_PIPELINE_MODE', ...);
  }
}
```

**`src/worker/pipeline.ts`** — legacy pipeline 전체 로직 (1276줄)

### 4.2 Phase P 실행 흐름 (pipeline-facade.ts)

```
Part A: ensureDefault (try-catch, lines 82-93)
Part B: version fetch (lines 96-108)
Part C: executor (lines 110-156)
  - triggerContext 빌드 (lines 113-117)
  - in-memory EventBus + listeners 생성 (lines 119-122)
  - PipelineExecutor 인스턴스 생성 (lines 124-129)
  - executor.run() 호출 (lines 134-143)
  - catch → failTask() 호출
```

### 4.3 Worker 재시작 시나리오별 현황

| 시나리오 | 현황 | 결론 |
|----------|------|------|
| OS 재부팅 | 재부팅 후 Next.js 서버 재시작 → runPipeline() 자동 호출 코드 **없음** | 자동 resume 발동 코드 없음 |
| Worker crash (executor throw) | try-catch 로 잡아 failTask() 호출. 상위 재시작 로직 없음 | 재시작 없음, fail 처리 |
| 프로세스 레벨 crash (uncaught) | process-level crash handler 없음 (grep 결과) | OS/pm2 레벨에서만 재시작 가능 |
| StateStore 복원 | create() 만 있음. restore()/load() 없음 | 재시작 후 상태 복원 불가 |

### 4.4 Worker 아키텍처 판정

Next.js API route 기반 + **long-running async function** 구조. 별도 worker 프로세스 없음.
`src/worker/pipeline-facade.ts` → `src/worker/pipeline.ts` 는 Next.js request context 에서 직접 실행.

**Resume 방식 선택에 미치는 영향**: 자동 resume (OS 재부팅 시 자동 발동)은 어디서도 트리거할 주체가 없음 → **명시적 API 호출 방식**이 현실적.

---

## 5장. Checkpoint 자료 범위

### 5.1 복원에 필요한 상태 분석

프로세스 재시작 후 pipeline 을 재개하려면 다음을 DB 에서 복원해야 함:

| 데이터 | 현재 위치 | 직렬화 필요 여부 |
|--------|----------|----------------|
| 완료된 노드 output | `NodeRunState.output` (메모리) | **필요** |
| 노드 status (completed/failed/running) | `NodeRunState.status` (메모리) | **필요** |
| parallel branchResults | `FlowRunState.branchResults` (Map) | **필요** (Map → JSON) |
| loop currentIteration/completedIterations | `FlowRunState.{currentIteration, completedIterations}` (메모리) | **필요** |
| loop iterationResults | `FlowRunState.iterationResults` (메모리) | **필요** |
| $nodes/$loop/$trigger context | `ExecutionContext` (매 노드 실행 시 재구성 가능) | 부분적 재구성 가능 |
| 파이프라인 status | `PipelineRunState.status` (메모리) → `pipeline_runs.status` (DB, 하지만 미동기) | **필요** |
| metrics (cost/tokens) | `PipelineRunState.{totalCostUsd, ...}` | 있으나 낮은 우선순위 |

### 5.2 Checkpoint 저장 주기 판단

**매 노드 완료 시점** vs **마일스톤 시점만**:

- 매 노드 완료 시점: DB write 횟수 = 노드 수. 현재 in-memory StateStore 의 `updateNode()` 호출이 이미 각 노드 완료마다 발생하므로, 이 시점에 DB write 를 끼워넣으면 오버헤드는 SQLite sync 횟수만큼 증가.
- 마일스톤 시점: flow node 완료, loop iteration 완료 등 굵은 경계만. 구현 단순, 중간 노드 재실행 필요성 있음.

**판정**: §마지막 섹션에서 결정.

---

## 6장. Worktree 격리 현황

### 6.1 WorktreeManager 존재 여부

`WorktreeManager` grep → **NO MATCHES**. 해당 클래스 없음.

`worktree_path` grep → **NO MATCHES**. 해당 컬럼/변수 없음.

### 6.2 현재 worktree 관련 코드 지점

| 위치 | 내용 |
|------|------|
| `src/lib/db/schema.ts` (worktrees 테이블, 142-182) | `id, projectId, name, path, gitBranch, isMain, status, portOffset, sessionMode, autoCleanup, cleanupAfterDays, createdAt, lastUsedAt` |
| `src/lib/db/schema.ts` (worktreeSessions 테이블) | `id, worktreeId, status, currentTaskId, tasksExecuted, startedAt, lastActivityAt, closedAt` |
| `src/worker/pipeline-worktree.ts` | legacy pipeline 전용 worktree 생성/merge/cleanup |
| `src/lib/adpl/engine/executor.ts:22` | `ExecutorInput.worktreeRoot: string` (필수 입력) |
| `src/lib/adpl/engine/executor.ts:88-90` | `path.isAbsolute(input.worktreeRoot)` 검증 |
| `src/worker/pipeline-facade.ts:110-111` | `const worktreeRoot = resolve(task.projectDir ?? process.cwd())` |

### 6.3 Shadow mode 현황

stage-5-retro.md:150:
> Phase P executor 가 legacy 와 동일 SQLite DB / worktreeRoot 사용. Shadow mode 포함.
> parallel flow node + loop forEach parallelism > 1 에서 race condition 잠재 우려

**현재 모든 실행 모드 (legacy/phase_p/shadow) 가 동일 worktreeRoot 사용**.

### 6.4 격리 전략 선택지

| 전략 | 설명 | 구현 비용 | race condition 해소 |
|------|------|----------|---------------------|
| 그대로 | parallelism ≤ 1 유지, 격리 없음 | 0 | ❌ (forEach parallelism > 1 불가) |
| DB write prefix | 실행 runId prefix 로 namespace 분리 | 낮음 | 부분 (파일 충돌 미해소) |
| 별도 git worktree 할당 | 실행별 git worktree checkout | 높음 | ✅ (파일 분리 완전) |
| in-memory lock | 파일 write 시 mutex | 중간 | 부분 (같은 파일 충돌 시) |

---

## 7장. Event Sourcing 아닌 것의 재확인

### 7.1 현재 모델

Snapshot 기반. `StateStore` 는 전체 상태를 Map 에 보관하며 이벤트 로그 없음.

### 7.2 Event Sourcing 도입 재검토

**Event Sourcing 도입 시 장점**:
- 이벤트 로그로 디버그 재현 가능 (각 노드 전이 히스토리)
- 시간 여행(time-travel) 디버깅 가능

**Event Sourcing 도입 시 단점**:
- 이벤트 충돌 처리 (두 branch 가 동시 이벤트 발생 시 순서 정의 필요)
- Replay 복잡도: loop 수백 회 iteration 을 replay 하는 비용
- pipeline_runs 에서 직접 snapshot 재구성이 훨씬 단순

**결론**: Stage 6 에서 Event Sourcing **도입하지 않는다**. Snapshot 방식 유지. 이유:
1. 현재 StateStore API 는 이미 snapshot 기반으로 설계됨
2. loop/parallel 상태를 event replay 로 복원하는 것은 오히려 복잡도 증가
3. `pipeline_runs.lastCheckpointAt` + `pipeline_nodes` 테이블 로 직접 재구성이 심플

---

## 8장. Observability 범위

### 8.1 pipeline_events DB 저장 코드 존재 여부

**존재하지 않는다** (schema 테이블 자체가 없음, §3.3 참조).

Phase P executor 는 `EventBus` (in-memory, `src/lib/adpl/engine/executor.ts:119-122`) 를 사용하며, 이 이벤트가 DB 에 저장되는 경로 없음.

`events` 테이블 (legacy) 에도 Phase P 실행 이벤트 write 없음.

**결론**: pipeline_events 저장 코드 존재 — **NO**.

### 8.2 현재 이벤트 흐름 (Phase P)

```
PipelineExecutor.run()
  └── EventBus.emit(...)     ← in-memory only
       └── listeners (pipeline-facade.ts:119-122)
            └── rawEmit()/emit() → SSE (브라우저로 전달)
                ※ DB write 없음
```

### 8.3 이벤트 구조 일관성

Phase P 이벤트 타입 (`src/lib/adpl/engine/events/types.ts` 추정):
- `flow.parallel.start` / `flow.parallel.branch.complete`
- `flow.loop.iteration` / `flow.loop.break`
- `shell.stdout` / `agent.token`
- `node.start` / `node.complete` / `node.failed`

현재 이들이 DB 에 저장되지 않으므로 UI 에서 히스토리 조회 불가.

### 8.4 UI 노드 상태 조회 가능 여부

현재 불가. `pipeline_nodes` 테이블은 schema 에 존재하나 Phase P 가 이 테이블에 write 하는 코드 없음 (StateStore 는 in-memory 만).

### 8.5 메트릭 콜렉터

Prometheus 또는 별도 metrics 콜렉터 코드 없음. `pipeline_runs.totalCostUsd/totalTokensIn/totalTokensOut` 컬럼은 있으나 Phase P executor 가 이 컬럼을 업데이트하는 코드 없음.

### 8.6 Observability 범위 권장

현재 Phase P 에는 Observability 레이어가 사실상 전무함 (SSE 스트림만 존재). 작업량:
- pipeline_events 테이블 schema 추가
- Phase P EventBus 리스너 → DB insert 연결
- 노드별 상태를 pipeline_nodes 테이블에 sync

이 작업은 DB-backed StateStore (F1) 와 긴밀하게 연결됨. F1 이 DB write 경로를 만들면 Observability 도 자연스럽게 편입 가능. **Stage 6 내 F5 로 포함 추천** (단, F1-F3 이후로 순서 고정).

---

## 9장. 작업 블록 분해 제안

### 9.1 블록 목록

| 블록 | 범위 | 예상 소요 | 의존성 |
|------|------|----------|--------|
| **F1** DB-backed StateStore 전환 | StateStore 내부를 DB read/write 로 전환 (API 동일 유지) | 2-3일 | 없음 (첫 블록) |
| **F2** Checkpoint 저장 | 노드 완료 시 lastCheckpointAt + 노드 상태 DB 기록 | 1-2일 | F1 이후 |
| **F3** Resume 로직 | API 호출 → 기존 run 의 DB 상태로 StateStore 복원, resume 진행 | 1-2일 | F2 이후 |
| **F4** Worktree 격리 | phase-p 전용 write prefix 또는 git worktree 분기 | 1-2일 | F1 이후 (F3 와 병행 가능) |
| **F5** Observability 강화 | pipeline_events schema + Phase P EventBus → DB insert, UI 상태 조회 | 1-2일 | F1 이후 |
| **F6** Stage 6 retro | stage-6-retro.md 작성, 이월 항목 정리 | 0.5일 | 마지막 |

### 9.2 선후 순서 다이어그램

```
F1 (DB-backed StateStore)
  ├── F2 (Checkpoint 저장)
  │     └── F3 (Resume 로직)
  ├── F4 (Worktree 격리)       ← F2/F3 와 병행 가능
  └── F5 (Observability)       ← F4 와 병행 가능
                    └── F6 (retro)
```

### 9.3 Stage 6 범위 포함/제외 권장

| 항목 | Stage 6 포함 여부 | 이유 |
|------|-----------------|------|
| F1 DB-backed StateStore | ✅ 포함 | 핵심 인프라, F2~F5 전제 |
| F2 Checkpoint 저장 | ✅ 포함 | Durability 핵심 |
| F3 Resume 로직 | ✅ 포함 | Durability 핵심 |
| F4 Worktree 격리 | ⚠️ 포함 (경량 전략 선택 시) | forEach parallelism > 1 선행 조건 |
| F5 Observability | ✅ 포함 (F1 완료 후 자연스럽게 편입) | Stage 7 UI 의 전제 |
| forEach parallelism > 1 | 조건부 (F4 완료 후만) | 격리 없이 불가 |
| $trigger 타입 통합 | ✅ 포함 (경량 정리) | 낮은 비용 |
| Pipeline UI | ❌ Stage 7 | 별도 프론트엔드 작업 |
| human-approval gate | ❌ Stage 5+ 이월 유지 | 별도 설계 필요 |

---

## 10장. 리스크 분석

### 10.1 "wrap, not port" 원칙 유지 가능성

Stage 3·4·5 공통 원칙: 외부 인터페이스(API) 는 그대로, 내부 구현만 교체.

| 컴포넌트 | 변경 범위 | Wrap 가능 여부 |
|----------|----------|--------------|
| `StateStore` public API | 동일 유지 (create/get/updateNode 등) | ✅ 가능 — 내부만 Map → DB 전환 |
| `Scheduler` | 변경 0줄 목표 | ✅ StateStore API 동일하면 무수정 |
| `FlowHandler` 4종 | 변경 0줄 목표 | ✅ 동일 |
| `PipelineExecutor` | resume API 추가 필요 (`executor.resume(runId)`) | ⚠️ 새 메서드 추가 (기존 run() 변경 없음) |
| `pipeline-facade.ts` | resume 라우팅 추가 | ⚠️ 새 분기 추가 (기존 runPhasePPipeline 변경 없음) |
| `pipeline.ts` (legacy) | 변경 없음 | ✅ 무관 |

### 10.2 DB write 오버헤드

매 노드 완료 시 SQLite write 추가. 현재 Stage 2~5 통합 E2E 30 시나리오는 모두 in-memory. DB write 추가 시:
- SQLite is synchronous-friendly, 소규모 파이프라인(< 100 nodes) 에서는 체감 무시 가능
- 단, loop 1,000 회 iteration 시 1,000번 DB write — 성능 측정 필요

완화: DB write 를 async 로 처리하거나, 노드 완료 시 batch queue 에 쌓고 주기적 flush.

### 10.3 통합 테스트 fixture 복잡도

현재 통합 테스트 (`scheduler/__tests__/`, `e2e.test.ts`) 는 DB 없이 in-memory StateStore 사용.
F1 전환 후:
- 테스트 각각이 DB instance (`:memory:` SQLite) 를 초기화해야 함
- 기존 테스트 변경 불가 원칙과 충돌 가능성 → **테스트 변경 0줄 목표 달성 어려울 수 있음**

완화 전략: StateStore 를 DI(의존성 주입) 방식으로 전환. 테스트 환경에서는 in-memory 구현, 프로덕션에서는 DB-backed 구현 주입. 인터페이스(`IStateStore`) 추출 필요.

### 10.4 Worker lifecycle 변경 영향

resume API 도입 시 `pipeline-facade.ts` 에 새 진입점 추가 필요.
현재 `runPipeline(taskId, ...)` 패턴에서 `resumePipeline(runId, ...)` 로 분기.
기존 `pipeline.ts` (legacy) 에 영향 없음.

### 10.5 목표: Stage 4-5 산출물 수정 0줄

| 산출물 | 수정 0줄 달성 가능 여부 |
|--------|----------------------|
| Stage 4 D1-D4 (FlowHandler 4종) | ✅ StateStore API 동일 유지 시 |
| Stage 5 E1-E3, E5 (expression, trigger) | ✅ 무관한 레이어 |
| Stage 2 Compiler/Scheduler | ⚠️ IStateStore 추출 시 Scheduler 생성자 시그니처 변경 가능 |
| Stage 2 EventBus | ✅ 변경 없음 |

가장 위험한 지점: **Scheduler 생성자에 StateStore 인스턴스를 주입하는 방식** — 현재 `new StateStore()` 를 어디서 생성하는지에 따라 수정 범위 결정됨.

---

## 마지막 섹션 — 구현 전 판단 필요 사항

### 판단 1. 작업 블록 분해 추천 + 프쀬 범위

**추천 순서**: F1 → F2 → F3 → (F4, F5 병행) → F6

**Stage 6 포함**: F1, F2, F3, F5, F6 (필수)
**조건부 포함**: F4 (경량 전략 시 — DB prefix 방식으로 1일 처리 시 포함, git worktree 분리는 Stage 7 이후)
**Stage 7 이월**: Pipeline UI, Verifier adapter 고도화

### 판단 2. Checkpoint 저장 주기

**추천: 매 노드 완료 시점**.

이유:
1. StateStore.updateNode() 호출이 이미 각 노드 완료마다 발생 — 이 시점에 DB sync 를 끼워넣으면 추가 API 설계 불필요
2. SQLite write 는 소규모 파이프라인(< 100 nodes) 에서 허용 가능한 오버헤드
3. 마일스톤 방식은 중간 실패 시 완료된 노드를 재실행하는 낭비 발생

완화: 고빈도 loop(> 100 iterations) 는 `currentIteration` 을 일정 주기(10 iteration) 마다 flush 하는 옵션 추가 가능.

### 판단 3. Resume 방식

**추천: 명시적 API 호출 방식** (자동 resume 거부).

이유:
1. Worker 는 Next.js request context — 재부팅 후 자동 resume 트리거 주체 없음
2. 자동 resume 은 의도치 않은 부작용(중복 실행, DB dirty state) 위험
3. 명시적 API `POST /api/pipelines/:runId/resume` → `resumePipeline(runId)` 패턴이 안전하고 테스트 가능

재부팅 후 "in-progress 상태 run 목록 노출 + 수동 resume 버튼" 로 UX 처리.

### 판단 4. Worktree 격리 전략

**추천: DB write prefix 방식 (경량) — Stage 6 내 포함**.

이유:
1. `git worktree add` 는 구현 비용 높고 CI 환경 의존성 증가
2. 현재 parallelism ≤ 1 이므로 실제 race condition 미발생
3. Phase P executor 에 `worktreeRoot` + `runId` 기반 namespace prefix 를 적용하면 추후 parallelism 증가 시 충돌 방지 기반 마련 가능
4. `git worktree` 분리는 forEach parallelism > 1 이 실제로 필요해질 Stage 7+ 에서 검토

git worktree 분리는 **이월**. Stage 6 에서는 DB-level isolation (run-scoped key prefix) 만 구현.

### 판단 5. Event Sourcing 재검토 결론

**Snapshot 유지** (Event Sourcing 도입 거부, §7장 결론과 동일).

추가 근거:
- Stage 6 에서 DB-backed StateStore 전환 시 snapshot serialize/deserialize 구현이 Event Sourcing replay 보다 훨씬 단순
- `pipeline_runs + pipeline_nodes` 테이블 구조가 이미 snapshot 기반으로 설계됨
- Event Sourcing 은 `pipeline_events` 테이블 완성 후 별도 audit layer 로 추가 가능 (상호 배타적이지 않음)

### 판단 6. 첫 구현 작업 추천

**F1 (DB-backed StateStore) 부터 시작**.

이유:
- F2~F5 전부 F1 에 의존
- F1 의 핵심은 `IStateStore` 인터페이스 추출 + `DbStateStore` 구현 — 이 작업이 가장 영향 범위가 넓으므로 먼저 끝내야 후속 블록이 안정됨
- F1 이 Scheduler 생성자 변경을 요구하는지 확인 후 → 필요 시 `StateStore` 를 DI 주입으로 전환

F1 이 예상보다 무거울 경우 (IStateStore 추출 시 Scheduler 시그니처 변경이 광범위하면):
- F5 (Observability 기반 — pipeline_events schema 추가 + EventBus 리스너 DB insert) 를 먼저 처리해 관측 인프라를 확보한 뒤 F1 진입

---

## 수락 기준 점검

- [x] 10장 모두 채워짐
- [x] 2장에서 StateStore API 주요 메서드 나열 (15개)
- [x] 3장에서 Checkpoint 준비 컬럼 4종 사용점 각각 확인 — 전부 **NO** (미사용)
- [x] 4장에서 Worker 진입점 파일 명시 — `src/worker/pipeline-facade.ts`
- [x] 6장에서 현 worktree 관리 코드 지점 — schema.ts(worktrees 테이블), pipeline-worktree.ts, executor.ts
- [x] 8장에서 pipeline_events 저장 코드 존재 — **NO** (테이블 자체 없음)
- [x] 9장에서 작업 블록 6개 + 각 예상 소요 기재
- [x] 마지막 섹션에 판단 6건 (요청 5건 + 추가 1건)
- [x] 커밋 로컬만 (push 금지)
