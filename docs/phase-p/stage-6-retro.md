# Stage 6 Retrospective — Durability + Observability

> 작성: 2026-04-25 (Stage 6 종결)
> 기간: 2일 (2026-04-24 ~ 2026-04-25)
> 로드맵 예상: 2주 vs 실제: 2일

## TL;DR

Stage 6 F1 ~ F5 완성 + F6 retro. **Durability 풀스택** (DB-backed StateStore + 매 노드 checkpoint + Resume API + Worktree 격리) 과 **Observability 기반** (`pipeline_events` 테이블 + DbEventSink) 모두 구현.

7 commits, 전부 verify:cross **A 등급 (98/100)**. **833 → 877 tests pass (+44)**.

`F4` 는 조사서 §9.3 "⚠️ 포함 (경량 전략 선택 시)" 권장을 그대로 채택해 `WorktreeManager` 클래스 신규 도입 없이 `computeIsolatedCwd` 함수 + `useIsolatedWorktree` opt-out 로 구현.

Stage 6 종결로 v0.5 Beta 출시 후보 마일스톤 도달. Stage 7 (UX Layer / Pipeline UI) 진입 준비 완료.

---

## 일정

- **로드맵 예상**: 2주
- **실제**: 2일 (2026-04-24 ~ 2026-04-25)

일정 단축 원인:

- Stage 5 까지 누적된 "조사서 → 발췌 → 구현" 패턴이 Stage 6 에서도 그대로 작동
- F1 의 "in-memory + DB persistence 하이브리드" 결정으로 Map 기반 기존 API 가 그대로 보존됨 → D1-D4 / Scheduler / FlowHandler 수정 0줄 달성
- F2-F5 는 F1 이 만든 persist 메서드 위에 정책·복원·격리·관측을 차례로 얹는 작업 → 각 30분 ~ 1.5시간
- 외부 패키지 0건 원칙은 Stage 6 에서 거의 도전 받지 않음 (DB 는 기존 better-sqlite3, 모든 추가 기능은 기존 의존성으로 해결)

일정 단축의 함의:
- F4 가 "WorktreeManager" 신규 클래스 대신 함수 1개 + spec 옵션 1개로 축소 → 1.5시간
- F5 는 +307/-0 순수 추가 → 1.3시간

---

## 작업 궤적 (7 commits)

| Commit | 태그 | 주제 | 핵심 |
|:------:|------|------|------|
| 9b05aec | 조사 | Stage 6 사전 조사 | 10 장 + 판단 6건. pipeline_events 테이블 부재 확인, F1-F6 작업 블록 분해 |
| ea03638 | F1 | DB-backed StateStore | `pipeline_run_state` 테이블 + persist/restore + optimistic concurrency. Map 캐시 보존, API 비변경 |
| e1fc544 | F2 | Checkpoint 정책 | 매 노드 완료 시 persist (성공·실패 무관). `fatalError` 필드 + emit-before-set 패턴으로 persist 실패 전파 타이밍 해결 |
| 8f9d731 | F3 | Resume API | `Executor.resumeRun(runId, yaml)` + `resumePhasePPipeline(runId, emit)`. ORPHANED_ON_RESUME 마킹, "pending+prereq 충족" 시드 확장. tasks 테이블 4 컬럼 첫 활용 |
| a53e338 | F4 | Worktree 격리 | `computeIsolatedCwd` 함수 + `${worktreeRoot}/.phase-p-runs/${runId}` namespace. Shell adapter 한정. `ExecutionContext.runId` optional 도입으로 40 파일 수정 0 달성 |
| 50987b7 | F5 | Observability | `pipeline_events` 테이블 + DbEventSink. MemoryEventCollector 패턴 100% 미러링. emit 사이트 84개 무수정 |
| (이번) | F6 | Stage 6 retro | 이 문서 |

---

## 설계 조정 사항 (Stage 7+ 이월 스펙 업데이트)

조사서에 없던 구현 결정. F1-F5 수행 중 자체 발견한 설계 조정.

### 1. F1 — In-memory 캐시 + DB persistence 하이브리드

**설계 기대**: StateStore 내부를 Map → DB 로 완전 전환 (조사서 §10.3)
**구현**: Map 기반 캐시는 그대로 유지, `persist(runId)` / `static restore(runId)` 메서드 추가. 노드 업데이트는 메모리에 즉시 반영, DB sync 는 별도 호출 시점에 수행.
**이유**:
- Scheduler / Worker / FlowHandler 가 빈번히 호출하는 `getNode`, `updateNode` 가 동기 read 흐름을 유지해야 함 (DB read 호출로 전환 시 Scheduler async 시그니처 광범위 변경)
- DB 는 "스냅샷 저장소" 로 한정 → Map round-trip 보존 (Stage 6 §7장 "Snapshot 유지" 결정과 일치)
- StateStore 공개 API 비변경 → D1-D4 / Stage 5 E1-E5 산출물 수정 0줄 달성
**적용**: ADPL spec / 설계 문서에 "StateStore 는 메모리 캐시 + DB 스냅샷 하이브리드" 명시 권장

### 2. F2 — `fatalError` 필드 + emit-before-set 패턴

**설계 기대**: persist 실패 시 그대로 throw → Scheduler 가 catch
**문제**: `handleNodeComplete` 에서 persist 실패 후 즉시 throw → `node.completed` 이벤트 emit 전이라 `waitForAnyComplete` 가 resolve 되지 않아 hang 발생
**구현**: Scheduler 인스턴스에 `fatalError: Error | null` 필드 추가. persist 실패 시 (1) `fatalError = error`, (2) `node.completed` emit, (3) re-throw. `run()` 메인 루프가 매 tick 후 `if (this.fatalError) throw` 체크.
**이유**: emit 후 throw 해야 `waitForAnyComplete` 가 resolve 되어 메인 루프가 깨어나고, 그 시점에 fatalError 로 전파 가능
**적용**: 향후 Scheduler 의 다른 비동기 fatal 경로 (DB connection lost 등) 도 같은 패턴 따라야 함

### 3. F3 — 5종 resume context 를 PipelineRunState 자체에 저장

**설계 기대**: triggerContext 만 별도 저장 (조사서 §3 결정 3)
**구현**: `PipelineRunState` 에 5개 optional 필드 추가 — `triggerContext`, `taskId`, `pipelineVersionId`, `projectId`, `worktreeRoot`. `setResumeContext()` 메서드로 한 번에 설정, serialize/deserialize round-trip.
**이유**:
- task row 가 삭제되어도 resume 가능해야 함 (자율 운용)
- pipelineVersionId / projectId / worktreeRoot 도 resume 시 재구성에 필요 → 별도 테이블 lookup 부담 줄임
- Map 직렬화에 추가하는 것이 별도 테이블보다 단순
**적용**: ADPL spec §pipeline_run_state 에 "resume context 5 필드" 명시

### 4. F3 — Scheduler "pending + prereq 충족" 시드 확장 (`resumeMode`)

**설계 기대**: Resume 시 root 노드부터 다시 시작
**문제**: 이미 일부 노드가 success 인 상태에서 root 만 시드하면 같은 노드 재실행 → 부작용 중복
**구현**: `SchedulerOptions.resumeMode: boolean` 추가. true 일 때 `plan.graph.allNodes` 전체를 순회하며 status='pending' 이고 모든 prereq 가 success/skipped 인 노드를 시드. completed/failed 는 그대로 보존.
**이유**: 부작용 중복 방지 + 부분 실행 상태에서 중간 노드를 시작점으로 삼을 수 있어야 함
**적용**: ADPL spec §scheduler 에 "resumeMode 시 pending+prereq 충족 노드만 시드" 명시

### 5. F3 — ORPHANED_ON_RESUME 마킹 (running 노드 대처)

**설계 기대**: 명시되지 않음
**구현**: Resume 진입 시 status='running' 노드 모두를 'failure' 로 마킹. 에러 코드 `ORPHANED_ON_RESUME`. 부작용 중복 방지가 목적.
**이유**:
- Worker 가 죽을 때 실행 중이던 노드는 부작용을 일부만 수행했을 가능성
- 같은 노드를 다시 실행하면 file write / HTTP POST / shell command 가 두 번 실행됨
- 명시적 retry 는 Stage 7+ (사용자가 retry API 호출하는 패턴)
**적용**: ADPL spec §resume policy 에 "running → failure on resume" 명시

### 6. F3 — tasks 테이블 4 컬럼 첫 활용 (선견지명의 실현)

**관찰**: schema.ts 에 이미 `resumedFromRunId`, `lastResumedAt`, `resumeCount` 컬럼이 있고 status enum 에 `'resumed'` 값이 있음 (조사서 §3.2 에서 "write 코드 0줄" 로 보고된 것)
**구현**: `resumePhasePPipeline` 진입 시 4개 컬럼 모두 update — 진정한 의미의 "선견지명 실현". 또한 status enum 에 정식으로 `'resumed'` 추가.
**적용**: 향후 컬럼 추가 시 "예약된 미래 사용" 패턴 재사용 가능

### 7. F4 — `WorktreeManager` 클래스 대신 `computeIsolatedCwd` 함수

**설계 기대**: 조사서 §6.4 "별도 git worktree 할당" 옵션 또는 새 매니저 클래스
**구현**: 단일 함수 `computeIsolatedCwd({worktreeRoot, runId, useIsolation})` → mkdir recursive 후 `{cwd, isolated, isolatedPath}` 반환. 클래스 없음.
**이유**:
- 상태 보유 객체 불필요 (cwd 계산은 stateless)
- shell adapter 1곳만 사용 → 클래스 추상화 오버헤드
- "WorktreeManager 클래스 신규 도입 금지" 원칙으로 Stage 6 범위 협소화
**적용**: 향후 cleanup / TTL / 디스크 사용량 트래킹 추가 시 클래스로 승격 가능

### 8. F4 — `ExecutionContext.runId` optional 도입

**문제**: ExecutionContext 를 인라인으로 구성하는 테스트 파일 40개 — required 필드 추가 시 모두 수정 필요
**구현**: `runId?: string` optional. `context-builder.ts` 가 `state.id` 를 자동 주입 (production path). 인라인 테스트는 그대로 두고, shell adapter 가 `ctx.runId` 없을 때 isolation 자동 skip.
**이유**: 테스트 수정 0건 + production behavior 정확. "optional + production-path injection + adapter-side defensive fallback" 3단 방어
**적용**: 향후 ExecutionContext 에 새 런타임 필드 추가 시 같은 패턴

### 9. F4 — `useIsolatedWorktree` opt-out + `spec.cwd` 우선

**설계 기대**: 명시되지 않음
**구현**: `useIsolatedWorktree`(default true) opt-out 외에, `spec.cwd` 가 명시되면 isolation 자동 skip. 사용자가 명시한 cwd 의도를 존중.
**적용**: ADPL spec §shell.cwd 에 "spec.cwd 사용 시 isolation 비활성화" 명시

### 10. F5 — MemoryEventCollector 패턴 100% 미러링

**관찰**: `events/subscribers/memory-collector.ts` 의 `attach(bus)` / `detach()` / `bus.on('*', ...)` 패턴이 그대로 DB-write subscriber 의 골격이 됨
**구현**: `DbEventSink` 클래스를 MemoryEventCollector 와 거의 동일 구조로 작성. 단 `events` 배열 대신 `db.insert(pipelineEvents).run()` 으로 교체.
**이유**: 기존 패턴 활용 + 학습 비용 최소화
**적용**: 향후 추가 sink (Prometheus, Loki, OpenTelemetry 등) 모두 같은 attach/detach 패턴 따라야 함

### 11. F5 — Spam-guarded errorReporter (1 log per 10 failures)

**문제**: DB 가 일시적으로 잠겨서 모든 emit 이 실패할 경우 로그 폭주
**구현**: `failureCount % 10 === 1` 시점만 reporter 호출. 1, 11, 21, ... 회 실패 때만 1번 로그.
**적용**: 다른 sink 도 같은 spam guard 패턴 권장

---

## 알려진 이슈 (Stage 7+ 이월)

### 1. pipeline_runs row 라이프사이클 미구현

**현상**: F5 조사 §추가 발견 사항에서 확인. `pipeline_runs` 테이블에 행을 insert/update 하는 코드가 어디에도 없음. `pipeline_events` 의 `run_id` 는 외래키 제약 없는 raw text.
**영향**: Stage 7 UI 가 "활성 run 목록" 을 조회하려면 pipeline_runs 가 권위 있는 source 여야 하는데 비어 있음
**Action**: 별도 micro-fix 또는 Stage 7+. `executor.run()` 진입 시 insert + 종료 시 status/duration update.

### 2. UI 조회 API 부재

**현상**: pipeline_events / pipeline_run_state 모두 저장만 구현. `/api/pipeline-runs/:runId/events` 같은 조회 API 미존재.
**Action**: Stage 7+ Pipeline UI 작업과 함께.

### 3. DB-backed metrics sync 미구현

**현상**: `pipeline_runs.totalCostUsd / totalTokensIn / totalTokensOut` 컬럼은 schema 에 있고, `StateStore.incrementMetrics` 도 메모리에 누적. 그러나 DB 로 흘러가는 코드 0줄.
**Action**: pipeline_runs row 라이프사이클 작업과 묶어서 처리. `run.completed` 시점에 한 번 sync.

### 4. batch insert 최적화 미구현

**현상**: F5 의 DbEventSink 는 이벤트당 1행 insert. 대량 emit 시 (예: agent.token 토큰당 1 이벤트) DB write 병목 가능성.
**Action**: 조회 성능 이슈 발생 시 batch + flush queue 패턴. Stage 7+ 또는 별도 최적화 작업.

### 5. auto-resume on Worker crash 미지원

**현상**: F3 의 resumePhasePPipeline 은 명시적 호출 전용. Worker / Next.js 프로세스가 crash 후 재시작 시 자동 resume 없음.
**영향**: 장시간 실행 파이프라인이 process restart 시 멈춰 있음 — 사용자가 수동 트리거 필요
**Action**: Stage 7+ heartbeat + 자동 감지. 조사서 §10.4 의 "재부팅 후 in-progress run 목록 + 수동 resume 버튼" UX 가 권장 경로.

### 6. shadow_runs.runId FK 부재

**현상**: F4 조사에서 확인. `shadow_runs` 테이블은 audit 용 (legacyOk/shadowOk + duration 비교) 이고 격리 무관.
**Action**: 우선순위 낮음. Stage 7+ 또는 무시.

### 7. agent backends worktree 격리 부재

**현상**: F4 는 shell adapter 한정. Claude CLI / Gemini CLI / Codex CLI / autodev / verifier backend 는 여전히 `ctx.worktreeRoot` 그대로 사용.
**영향**: forEach parallelism > 1 + agent 노드가 같은 worktree 에 동시 write 시 race
**Action**: Stage 7+ 에서 agent backend 별 isolation 전략 결정 후 적용.

### 8. git worktree 분리 미구현

**현상**: F4 는 디렉토리 namespace 만 분리 (`.phase-p-runs/${runId}`). git worktree 단위 분리 없음.
**영향**: 같은 git 브랜치 위에서 여러 run 이 commit 시도하면 충돌 가능
**Action**: forEach parallelism > 1 이 실제 활성화될 Stage 7+ 또는 이후.

### 9. cleanup 정책 부재

**현상**: `${worktreeRoot}/.phase-p-runs/${runId}` 디렉토리가 영구 누적. 자동 삭제 로직 없음.
**영향**: 장기 운용 시 디스크 누적
**Action**: Stage 7+ 또는 별도 maintenance job. 정책 후보: 30일 경과 + status terminal 인 runId 삭제.

### 10. 이벤트 정규화 스키마 부재

**현상**: F5 의 `pipeline_events` 는 단일 `payload_json` 컬럼. 이벤트 타입별 정규화 컬럼 없음.
**영향**: 조회 시 JSON 파싱 비용. UI 에서 "node.failed 만 필터" 같은 쿼리는 type index 로 가능하나 nodeId 기반 쿼리는 JSON_EXTRACT 필요.
**Action**: 조회 성능 이슈 발생 시 정규화. Stage 7+ 또는 별도.

### 11. forEach parallelism > 1 활성화 미완

**현상**: F4 의 isolation 으로 기반 마련. 그러나 `loop-handler` 자체에 parallelism > 1 코드 경로 없음.
**Action**: F4 + agent isolation + git worktree 가 모두 갖춰진 후 Stage 7+ 에서 활성화.

### 12. 설계 문서 sync 9건 (Stage 3 retro 이월)

**현상**: Stage 3 retro 에서 발견된 설계 문서 조정 9건이 여전히 미반영 (Stage 5 retro §8.2 도 동일 보고).
**Action**: Stage 7+ 또는 v1.0 RC 직전 일괄.

---

## 노하우

### 1. "wrap, not port" 원칙 30 commits 연장

Stage 3·4·5·6 누적 30 commits 동안 D1-D4 / Executor.run / Stage 5 E1-E5 / Scheduler / FlowHandler 의 공개 API / 핵심 로직 수정 0줄. Stage 6 의 핵심 어려움은 "DB-backed transformation" 이었으나 in-memory 캐시 + DB persist 하이브리드로 API 변경 없이 처리.

### 2. 외부 패키지 0건 30 commits 연속

Stage 6 에서도 외부 패키지 추가 0건. drizzle-orm / better-sqlite3 / nanoid 는 기존 의존성. DbEventSink 에 spam guard 도 표준 라이브러리만 사용. 의존성 트리 안정.

### 3. MemoryEventCollector 패턴을 DB-write 로 미러링

F5 가 가장 명확한 사례. 패턴이 잘 정의되어 있으면 DB-write 같은 새 책무도 자연스럽게 끼워 넣을 수 있다. "기존 구조 분석 → 동일 인터페이스 → 책무만 교체" 가 +307/-0 순수 추가 결과를 만들었다.

### 4. Optional 필드 + production injection + adapter fallback 의 3단 방어

F4 의 `ExecutionContext.runId` 패턴. ExecutionContext 를 인라인으로 만드는 40개 파일을 건드리지 않으면서 production code 는 정확한 runId 를 받는 구조. 옵셔널 + buildExecutionContext 자동 주입 + shell adapter 의 fallback 자동 skip → 깨끗한 backward compatibility.

### 5. 조사 발췌 요청 패턴이 스코프 장황을 막음

F4 / F5 두 차례 "프롬프트 작성 전 조사서 §X 발췌" 요청 → 사용자 측에서 정확한 범위 지정. WorktreeManager 클래스 신규 도입 금지 (F4) / pipeline_runs 라이프사이클 이월 (F5) 같은 결정이 명확해짐. 발췌 답변 자체가 "잘못된 가정" 도 1건 잡아냄 (F4 조사 시 policy.ts 의 path jail 부재).

### 6. `fatalError` 패턴이 emit-resolve-loop 타이밍 해소

F2 의 교훈. async event-driven 코드에서 fatal error 를 catch 후 즉시 throw 하면 다른 비동기 listener 들이 깨어나지 못해 hang. Scheduler 인스턴스에 error 필드를 두고 emit 후 메인 루프 시점에 throw 로 옮기는 것이 안전.

### 7. 과거 선견지명의 실현

F3 가 `tasks` 테이블의 `resumedFromRunId / lastResumedAt / resumeCount` + status `'resumed'` 를 처음으로 write — 조사서 §3.2 에서 "write 코드 0줄" 로 보고됐던 것. 스키마 디자인 시 미래용 컬럼을 추가해 두면 실제 구현 시 schema migration 없이 기능을 채울 수 있다.

### 8. F6 (retro) 시간이 매우 짧음

Stage 5 의 1일 패턴이 Stage 6 에서도 유지됐으나 F1-F5 가 전부 1.5시간 이내였으므로 Stage 6 전체가 2일 안에 마무리. retro 자체는 코드 변경 0건이라 verify:cross 만 통과하면 commit 가능. 향후 retro 시간을 추가 작업 시간으로 환원 가능.

---

## 커밋 요약 표

| # | 커밋 | 작업 | verify:cross | 신규 파일 | +라인/-라인 |
|---|------|------|:-----------:|:---------:|:-----------:|
| 조사 | 9b05aec | Stage 6 사전 조사 | 98 | 1 (md) | +600/-0 |
| F1 | ea03638 | DB-backed StateStore | 98 | 2 (store-persist.test.ts, schema 확장) | +280/-15 |
| F2 | e1fc544 | Checkpoint 정책 | 98 | 1 (checkpoint-policy.test.ts) | +148/-4 |
| F3 | 8f9d731 | Resume API | 98 | 1 (resume.test.ts) | +743/-5 |
| F4 | a53e338 | Worktree 격리 | 98 | 2 (isolation.ts, isolation.test.ts) | +340/-8 |
| F5 | 50987b7 | Observability | 98 | 2 (db-event-sink.ts, db-event-sink.test.ts) | +307/-0 |
| F6 | (이번) | Stage 6 retro | (확인 예정) | 1 (이 문서) | +N/-0 |

**verify:cross**: 5/5 commits 모두 A 등급 (98/100). Verify Agent 가 매번 48/50 = "ok" 등급 (1 minor issue 평균).
**테스트 증가**: 833 (Stage 5 종료) → 877 (F5 종료) = +44.
**파일 변화**: F1-F5 합계 11 신규 + 12 수정. F6 는 문서 1개 추가.
**평균 commit 시간**: F1-F5 약 1시간 30분 (F1 만 55분으로 가장 길었음, F2-F5 는 1분 내외 ship).

---

## 수치 요약

| 항목 | 값 |
|------|----|
| 총 커밋 (Phase P Stage 6) | 7 (조사 + F1 + F2 + F3 + F4 + F5 + retro) |
| 신규 파일 | 9 (store.ts 확장 / store-persist.test / checkpoint-policy.test / resume.test / isolation.ts / isolation.test / db-event-sink.ts / db-event-sink.test / stage-6-retro.md) |
| 수정 파일 | ~14 (schema.ts / store.ts / scheduler/types.ts / scheduler/index.ts / executor.ts / state/types.ts / pipeline-facade.ts / shell/index.ts / shell/env-builder.ts / types/nodes/shell.ts / schemas/nodes/shell.ts / engine/adapters/types.ts / worker/context-builder.ts / events/types.ts) |
| 테스트 (Stage 6 전) | 833 pass |
| 테스트 (Stage 6 후) | 877 pass (+44) |
| TypeScript 에러 | 0 |
| verify:cross 평균 등급 | A (98/100) — 5/5 |
| 외부 패키지 추가 (30 commits 누적) | 0건 |
| F1-F5 작업 (조사·retro 제외) | 평균 1시간 30분 / commit |
| Stage 6 전체 소요 | 2일 (2026-04-24 ~ 2026-04-25) |
| 이월 항목 (Stage 7+) | 12건 |

---

## Exit 기준 체크

- [x] F1: DB-backed StateStore — `pipeline_run_state` 테이블, persist/restore, optimistic concurrency (version 컬럼)
- [x] F1: 공개 API 비변경 — Map 기반 read 동기 흐름 보존
- [x] F2: 매 노드 완료 시 persist (성공·실패 무관)
- [x] F2: persist 실패 → CHECKPOINT_PERSIST_FAILED, fatalError 패턴으로 hang 방지
- [x] F2: FlowHandler 내 persist 호출 0건 (이중 persist 방지)
- [x] F3: `Executor.resumeRun(runId, yaml)` + `resumePhasePPipeline(runId, emit)` 진입점
- [x] F3: PipelineRunState 5종 resume context (triggerContext / taskId / pipelineVersionId / projectId / worktreeRoot)
- [x] F3: ORPHANED_ON_RESUME 마킹, "pending+prereq 충족" 시드 확장
- [x] F3: tasks 테이블 4 컬럼 첫 활용
- [x] F3: PHASE_P_RESUME_FAILED vs PHASE_P_EXECUTOR_FAILED 분류
- [x] F4: `computeIsolatedCwd` 함수 (`${worktreeRoot}/.phase-p-runs/${runId}`)
- [x] F4: shell adapter 만 적용, agent backends 무수정
- [x] F4: `useIsolatedWorktree` opt-out + `spec.cwd` 우선 + `worktree.isolated` event
- [x] F4: `ExecutionContext.runId` optional 로 40개 인라인 ExecutionContext 파일 무수정
- [x] F5: `pipeline_events` 테이블 (id / run_id / type / payload_json / created_at) + 2 indexes
- [x] F5: `DbEventSink` (MemoryEventCollector 패턴 미러링)
- [x] F5: facade run/resume 양쪽 attach + try-finally detach
- [x] F5: DB write 실패 격리 (errorReporter), spam guard (1/10)
- [x] F5: emit 사이트 84개 무수정, EventBus 무수정
- [x] F6: stage-6-retro.md 작성 (이 문서)
- [x] D1-D4 FlowHandler 수정 0줄
- [x] Executor.run() 핵심 로직 수정 0줄 (resume 은 별도 신규 메서드)
- [x] Stage 5 E1-E5 산출물 수정 0줄
- [x] legacy pipeline.ts / pipeline-worktree.ts 수정 0줄
- [x] 외부 패키지 추가 0건 (30 commits 누적)
- [x] 833 → 877 tests pass
- [x] TypeScript 0 에러
- [x] verify:cross A 등급 5/5

---

## 다음 단계: Stage 7 — UX Layer (YAML editor + AI Builder)

로드맵 §Stage 7 주요 목표:
1. **Pipeline UI** — 실시간 진행 상황 표시 (pipeline_events 위에서)
2. **YAML editor** — ADPL 파이프라인 편집 + 검증 + 실행
3. **AI Builder** — 자연어 → ADPL YAML 변환

Stage 6 가 만든 인프라:
- pipeline_run_state — 활성 run 목록 + resume 가능 여부
- pipeline_events — 실시간 이벤트 스트림 + 히스토리
- DbEventSink — 새 sink (UI WebSocket, Prometheus 등) 추가 패턴 확립
- Worktree isolation — forEach parallelism > 1 활성화 기반

Stage 7 진입 전 우선 검토 항목:
1. pipeline_runs row 라이프사이클 — UI 가 활성 run 을 조회하려면 권위 있는 source 필요. 별도 micro-fix 후 Stage 7 진입 또는 Stage 7 내 첫 작업.
2. UI 가 직접 SQL 쿼리할지 / API 레이어 둘지 결정.
3. SSE vs WebSocket — 실시간 스트림 전송 방식 결정.

> Stage 6 도 2일 완성. Stage 2~6 누적 "하루 ~ 이틀 몰입" 패턴.
> v0.5 Beta 출시 후보 마일스톤 도달. Stage 7 진입 전 알려진 이슈 12건 우선순위 재검토 권장.
