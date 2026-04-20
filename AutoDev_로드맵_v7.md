# AutoDev Agent — 통합 로드맵 v7

> 작성: 2026-04-19 (Phase P Stage 1 완료 시점)
> 이전 로드맵: v2 (초기) → v3 (Wave) → v4 (사용자 피드백) → v5 (Phase H) → v6 (H7 출시 중심, 외부 문서)
> **이 문서가 현재 유효. v2-v6 모두 아카이브.**

---

## 0. 이 문서의 목적

v6 (2026-04-18 작성, 외부 계획 문서) 는 **H7 출시 선행** 을 권고했으나,
2026-04-19 사용자 판단으로 **Phase P 우선 진행** 결정.

하루 만에 Phase P 설계 시리즈 (20,000줄) 완결 + Stage 1 구현 (13 commits, avg 97.5 A) 달성.
현재 Stage 2 진입 대기 상태.

v7 은 이 **새 현실** 을 반영:
- Phase P 가 주 작업 (현재)
- H7 출시는 Phase P v0.5 또는 v1.0 시점 재검토
- v6 의 부채/런타임/차별화/UI 카테고리는 포스트 Phase P 로 재분류

---

## 1. 프로젝트 스냅샷 (2026-04-19)

- **레포**: `hyunlord/autodev-agent` (main)
- **규모**: ~218 commits, ~217 TS/TSX source files
- **스택**: Next.js 15 + TypeScript strict + SQLite + Drizzle + pnpm
- **최근**: Phase P Stage 1 완료 (13 commits, avg verify:cross 97.5 A)
- **다음**: Phase P Stage 2 Engine Core

### 핵심 철학 (Pre-Phase P 수립, 변경 없음)

1. **Planning/Verify 분리** — 계획과 검증은 독립 단계
2. **Strangler Fig 전환** — 기존 기능 깨뜨리지 않는 점진적 도입
3. **verify:cross 95+ 필수** — A등급 미만 commit 차단
4. **pnpm ship 경유** — 직접 git commit/push 금지
5. **globalThis 싱글톤** — HMR 대응 DB/Worker 관리
6. **에러 emit 전파** — 조용한 삼킴 금지

### 추가 원칙 (Phase P 체득)

7. **설계는 가이드, 코드베이스가 진실** — 실구현 시 블로커 발견이 정상.
   사전 조사 패턴 (Bash + Read 병렬) 이 핵심.

8. **지속 가능한 페이스** — Stage 1 하루 완성은 예외. Stage 2+ 는 주 단위 프로젝트.

---

## 2. 완료된 것

### Pre-Phase P (Session 1-5, ~204 commits)

| 영역 | 상태 |
|---|:---:|
| MVP (Task CRUD + SSE + Pipeline) | ✅ |
| Multi-Agent (Planner/Coder/Verifier) | ✅ |
| Core Intelligence (Debate, Evaluator, Agent Select) | ✅ |
| Harness Engineering (Evolve UI, Hooks, Config) | ✅ |
| Phase R (Retry + Escalation) | ✅ |
| Phase D (DB 안정화) | ✅ |
| Phase E (Error 추적) | ✅ |
| Phase F (Flow 개선) | ✅ |
| Phase G (Gemini 통합) | ✅ |
| Phase H1-H4 (Harness 고도화) | ✅ |
| 기능 영역 전반 | ~100% |

### Phase P 설계 (2026-04-19 오전)

- 설계 시리즈 14 문서 (~19,200줄)
- 실행 로드맵 1,488줄
- **ADPL** (YAML 기반 파이프라인 언어) 확정
- **Strangler Fig** 전환 전략
- **Hybrid 표현식** (Slot 1 자체 / Slot 2 Jexl fork / Slot 3 v1.5)
- 4C1 아키텍처: Compiler / Context / Control / Communication

### Phase P Stage 1 — Foundation (2026-04-19, 13 commits)

- DB 인프라: backup/restore/verify 명령 (pre-drop + retry 래퍼)
- Phase P 7 테이블 스키마 + tasks 컬럼 확장
- ADPL v1.0 공식 스펙 (`docs/adpl-spec/v1.0.md`, 4,900줄)
- TypeScript types 25 파일 (`src/lib/adpl/types/`)
- Zod runtime schemas 29 파일 (`src/lib/adpl/schemas/`)
- CLI validate: `pnpm adpl:validate` (glob + JSON format 지원)
- 샘플 YAML 10개 (`examples/adpl/`)
- 통합 테스트 + Stage 1 회고 + 블로커 6건 문서화
- avg verify:cross 97.5 (A등급)

### Stage 1-post (1 commit, baa8a69)

- db:push 인덱스 중복 해결 (pre-drop + retry)
- pnpm ship push exit code 체크 (silent skip 제거)

---

## 3. 현재 위치 → Phase P 전체 궤적

| Stage | 범위 | 예상 기간 | 상태 |
|:---:|---|:---:|:---:|
| 1 | Foundation (DB + 스펙 + 타입 + CLI) | 1-2주 | **✅ 완료** (1일) |
| 2 | Engine Core (Compiler/Scheduler/Worker/State/Events) | 3-4주 | ⏸️ 다음 |
| 3 | Leaf Adapters (agent/shell/http/webhook_out) + Facade + Shadow | 2-3주 | |
| 4 | Flow Adapters (branch/parallel/loop/gate) | 2-3주 | |
| 5 | Triggers + Expression | 2-3주 | |
| — | **v0.5 Beta 출시 후보** | — | |
| 6 | Durability + Observability | 2주 | |
| 7 | UX Layer (YAML editor + AI Builder) | 3-4주 | |
| — | **v1.0 RC → GA** | — | |

총 예상: 15-21주 (3.5-5개월)

### Stage 2 Engine Core 상세 (다음 작업)

설계 4C1 기반:

- **B3 Compiler**: YAML → AST, flat extract, ref resolver, ExecutionPlan
- **B4 State 기초**: NodeAdapter, MockAdapter, StateStore, EventBus, CancellationToken
- **B5 Scheduler + Worker**: concurrency, timeout, retry, PipelineExecutor
- **B6 통합**: Mock adapter 로 linear 5 노드 chain 실행 + 성능 측정 + 회고

Deliverable: `executor.run(yaml)` 로 linear pipeline 완주 가능.

---

## 4. H7 오픈소스 출시 재평가

v6 에서 H7 (README/LICENSE/CI/CD/스크린샷/CHANGELOG/npm) 이 **최우선** 이었음.
v7 에서 **재평가** — Phase P 중간/완료 시점으로 연기.

### 시나리오 A: v0.5 Beta 시점 출시 (Stage 5 완료 후)
- 예상 시점: Week 14-16 (약 4개월 후)
- 장점: 초기 공개, Phase P 파이프라인 기능 일부 검증됨
- 단점: AI Builder (Stage 7) 없어 핵심 차별화 미완성

### 시나리오 B: v1.0 RC 시점 출시 (Stage 7 완료 후) ← **v7 기본 권고**
- 예상 시점: Week 19-23 (약 5-6개월 후)
- 장점: **자연어 → 파이프라인** 핵심 차별화 완성 후 공개
- 단점: 공개 더 늦음

### 시나리오 C: Phase P 없이 현재 상태 출시 (v6 권고)
- 예상 시점: 2-3주 작업
- 장점: 가장 빠름
- 단점: Phase P 가 출시 후 큰 변경 → 사용자 혼란, 브랜딩 손실

**결론**: 시나리오 B 기본. 시나리오 A 는 Stage 5 완료 시점 재검토 옵션.

---

## 5. 포스트 Phase P (v1.5+)

Phase P v1.0 출시 후 검토 목록:

### v1.5 후보
- **Plugin 공개 API**: 외부 개발자 커스텀 노드 등록
- **Slot 3 표현식**: 고급 변환 (filter/map/pluck)
- **MCP Apps**: MCP 서버 UI resources 통합
- **템플릿 마켓플레이스**: 공유 파이프라인 레퍼런스
- **다국어 에러 메시지**: 한국어 → 영어/일본어 확장

### v2 후보 (장기)
- **분산 실행**: Multi-instance (Redis + BullMQ)
- **Event Sourcing**: Time travel debugging
- **VS Code 확장**: 에디터 네이티브 통합

### v6 잔여 항목 재분류
- **부채**: Evaluator 실제 구현, Playwright MCP timeout, task category 자유 입력
  → Phase P Stage 3+ 에서 흡수 가능 여부 판단
- **차별화**: Worker Pool, 모델 비용 라우팅, VS Code 확장
  → v1.5 또는 v2

---

## 6. 진행률

```
## 기능 영역 (Pre-Phase P)
MVP / Multi-Agent         ██████████  100%  ✅
Core Intelligence         ██████████  100%  ✅
Harness Engineering       ██████████  100%  ✅
Phase R/D/E/F/G/H1-H4    ██████████  100%  ✅

## Phase P 설계
설계 시리즈 (14 문서)      ██████████  100%  ✅
실행 로드맵 v1             ██████████  100%  ✅

## Phase P 구현 (7 Stage)
Stage 1  Foundation       ██████████  100%  ✅  (1일 완료)
Stage 2  Engine Core      ░░░░░░░░░░    0%  ⏸️  (다음)
Stage 3  Leaf Adapters    ░░░░░░░░░░    0%
Stage 4  Flow Adapters    ░░░░░░░░░░    0%
Stage 5  Triggers + Expr  ░░░░░░░░░░    0%
Stage 6  Durability + Obs ░░░░░░░░░░    0%
Stage 7  UX + AI Builder  ░░░░░░░░░░    0%

## 출시 준비
H7 오픈소스 출시           Phase P v1.0 시점 (시나리오 B)

Phase P 전체: 약 14% (Stage 1/7 완료)
Phase P 완료까지: 약 15-21주 예상
```

---

## 7. 의사결정 원칙 (v7)

세션 내 작업 선택 시:

1. **현재 Stage 완료 우선** — Stage 2 진입 후 Stage 2 일관 진행
2. **Stage 전환 시 회고 + 설계 반영** — A2-4 패턴 (통합 테스트 → 회고 → 설계 업데이트)
3. **블로커 발견 시 사용자 판단 대기** — Claude Code 사전 조사 후 보고
4. **외부 긴급 이슈는 별도 처리** — H7 필수 요소 발견 시 즉시 보고
5. **지속 가능한 페이스** — Stage 1 하루 완성은 예외; Stage 2+ 는 주 단위

**금지**:
- Stage 범위 확대 (다음 Stage 작업 선취)
- 설계 4C1 의 Stage 순서 역전
- verify:cross 95+ 미달 commit
- 직접 git commit / git push

---

## 8. 참조

### Phase P 산출물 (레포 내)
- `docs/adpl-spec/v1.0.md` — 공식 스펙
- `src/lib/adpl/` — 타입 + 스키마
- `examples/adpl/` — 샘플 10개
- `docs/phase-p/` — 진행 문서 4종

### 아카이브된 로드맵 (외부 문서)
- `AutoDev_구현로드맵_v2.md` — Phase A-D 초기
- `AutoDev_6차통합분석.md` — ~56%
- `AutoDev_7차통합분석_로드맵v3.md` — 60 commits
- `AutoDev_로드맵_v3.jsx` — Wave 1/2/3
- `AutoDev_8차통합분석_로드맵v5.md` — 98 commits
- `AutoDev_로드맵_v4.md` — 사용자 피드백 기반
- `AutoDev_로드맵_v6.md` — H7 출시 중심 (**Phase P 우선 결정으로 보류**)

v7 이후 변경은 **v8 작성 없이 이 문서 섹션 업데이트로 관리** 목표.
