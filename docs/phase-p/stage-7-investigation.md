# Stage 7 사전 조사 — UX Layer (YAML editor + AI Builder)

> 작성: 2026-04-25 (Stage 6 종결 직후)
> 목적: Stage 7 구현 전 UI 자산·설계 문서·외부 패키지·테스트 인프라 현황 파악
> 수정 금지: 본 문서는 조사 산출물, 코드/테스트 변경 없음

---

## 1장. 로드맵 §Stage 7 구성

### 1.1 원본 인용

**원본 파일**: `AutoDev_로드맵_v7.md` (사전 독본 후보 `docs/phase-p/27_PhaseP_roadmap_v1.md` 는 **부재** — Stage 5/6 조사와 동일 패턴)

`AutoDev_로드맵_v7.md:107`:
```
| 7 | UX Layer (YAML editor + AI Builder) | 3-4주 | |
```

전체 표 (lines 98–110):
```
| 1 | Foundation                                       | 1-2주 | ✅ 완료 |
| 2 | Engine Core                                      | 3-4주 | ✅ 완료 |
| 3 | Leaf Adapters                                    | 2-3주 | ✅ 완료 |
| 4 | Flow Adapters                                    | 2-3주 | ✅ 완료 |
| 5 | Triggers + Expression                            | 2-3주 | ✅ 완료 |
| — | v0.5 Beta 출시 후보                              |   —   |       |
| 6 | Durability + Observability                       |  2주  | ✅ 완료 |
| 7 | UX Layer (YAML editor + AI Builder)              | 3-4주 |   →   |
| — | v1.0 RC → GA                                      |   —   |       |
```

### 1.2 하위 작업 블록 정의 — 로드맵 내 부재

로드맵 v7 에는 **Stage 7 의 G1/G2/... 분해 정의 없음**. Stage 6 도 동일 (조사가 분해 보충). Stage 7 도 본 조사가 작업 블록을 제안.

§4 (line 135) 출시 전략 부분에서 단서:
> 시나리오 B (v1.0 RC 시점) 장점: **자연어 → 파이프라인** 핵심 차별화 완성 후 공개

→ AI Builder 가 Stage 7 의 핵심 차별화로 명시. Pipeline UI / YAML editor 는 그 전제 인프라.

### 1.3 원 예상 기간

3-4주. Stage 6 (2주 → 실제 2일) 추세를 반영하면 실제 소요는 더 짧을 가능성. 단 UI 작업 + LLM 호출 비결정성 때문에 직전 Stage 보다 시간 배율 클 수 있음.

---

## 2장. 기존 UI 자산 파악

### 2.1 Page 라우트 (`src/app/**/page.tsx`)

총 **6개**:

| 경로 | 역할 |
|------|------|
| `src/app/page.tsx` | Mission Control (메인 대시보드, kanban/grid/timeline/projects 4 view) |
| `src/app/setup/page.tsx` | 초기 셋업 wizard |
| `src/app/projects/[dir]/page.tsx` | 프로젝트별 detail |
| `src/app/tasks/[id]/page.tsx` | Task detail (단일 작업 추적) |
| `src/app/usage/page.tsx` | 비용/토큰 통계 |
| `src/app/harness/page.tsx` | Harness Engineering — agent prompt + MCP 설정 |

→ **Pipeline 전용 page 부재**. ADPL run 조회 / 편집 / 결과 보기 어떤 라우트도 없음.

### 2.2 컴포넌트 (`src/app/**/components/*.tsx`, **`src/components/` 폴더 부재**)

총 **25개** (모두 `src/app/{route}/components/` 내부, Next.js App Router 컨벤션):

**전역 (`src/app/components/`)** — 14개:
- 셸: `ClientShell.tsx`, `ThemeInitializer.tsx`, `ThemeToggle.tsx`, `LanguageToggle.tsx`
- UX: `OnboardingTour.tsx` (driver.js 기반), `Tooltip.tsx`, `CommandPalette.tsx` (cmdk 기반)
- 도메인: `EvolveModal.tsx`, `WebhooksTab.tsx`, `AgentHealthBar.tsx`
- mission/: `MissionHeader.tsx`, `KanbanView.tsx`, `KanbanCard.tsx`, `GridView.tsx`, `GridTile.tsx`, `TimelineView.tsx`, `TimelineRow.tsx`, `ProjectsView.tsx`, `KpiBar.tsx`, `NewTaskModal.tsx`

**Task detail (`src/app/tasks/[id]/components/`)** — 13개:
- 시각화: `MermaidDiagram.tsx`, `DagView.tsx` (xyflow/react), `TimelineView.tsx`, `StageNode.tsx`
- 비교: `DiffView.tsx`, `DiffViewer.tsx`, `ScreenshotCompare.tsx`, `ArtifactView.tsx`, `ArtifactPreview.tsx`
- 사이드: `Sidebar.tsx`, `TaskHeader.tsx`, `PlanCardView.tsx`
- 정보: `VlmCard.tsx`, `CodeBlock.tsx` (highlight.js), `CostBreakdown.tsx`

### 2.3 shadcn/ui 설치 여부

**미설치**. `src/components/ui/*.tsx` 폴더 전체가 부재. 기존 컴포넌트는 shadcn 프리미티브 의존 없이 자체 구현 (Radix UI 도 부재).

### 2.4 Tailwind 설정 상태

`tailwind.config.ts` (전 14줄):
```typescript
{
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: [],
}
```

→ **확장 0건**. 컬러·타이포·spacing 모두 Tailwind 기본 + CSS 변수.

### 2.5 디자인 시스템 — CSS 변수 기반 테마

`KanbanView.tsx` 발췌 (line 18-23):
```tsx
{ id: 'queued',  dotColor: 'bg-[var(--border-color)]', textColor: 'text-[var(--text-secondary)]' },
{ id: 'running', dotColor: 'bg-blue-500',              textColor: 'text-blue-400', pulse: true },
{ id: 'review',  dotColor: 'bg-amber-500',             textColor: 'text-amber-400' },
{ id: 'done',    dotColor: 'bg-emerald-500',           textColor: 'text-emerald-400' },
{ id: 'failed',  dotColor: 'bg-red-500',               textColor: 'text-red-400' },
```

**디자인 시스템 요약**:
- 컬러: Tailwind 기본 (blue/amber/emerald/red) + CSS 변수 (`--text-secondary`, `--border-color`, `--bg-card`)
- 다크모드: `ThemeToggle` + `ThemeInitializer` 로 변수 토글
- i18n: `src/i18n/context.tsx` 의 `useTranslations(namespace)` 훅 (`@/i18n/context`)
- 상태 색상 컨벤션: `pending=gray`, `running=blue+pulse`, `review=amber`, `done=emerald`, `failed=red`

### 2.6 이미 설치된 UI 라이브러리 (Stage 7 활용 가능)

`package.json` 의존성 중 UI 관련:

| 패키지 | 버전 | 용도 |
|--------|------|------|
| `@xyflow/react` | ^12.10 | 노드 그래프 (이미 `DagView.tsx` 사용) |
| `dagre` | ^0.8 | 그래프 layout (xyflow 보조) |
| `mermaid` | ^11.14 | 다이어그램 렌더링 |
| `highlight.js` | ^11.11 | 코드 syntax highlight |
| `cmdk` | ^1.1 | Command palette |
| `driver.js` | ^1.4 | Onboarding tour |
| `js-yaml` | ^4.1 | YAML 파싱/직렬화 |
| `tailwindcss` | ^4.2 | 스타일링 |

→ **Pipeline 시각화 / YAML 파싱 / 코드 표시 모두 이미 보유**. 외부 패키지 추가 없이 구현 가능 영역이 큼.

---

## 3장. 설계 문서 실체 확인

### 3.1 `13_PhaseP_design2_ui_ux.md` 존재 여부

**부재**. `docs/phase-p/` 디렉토리 전체 19 파일 중 13_ 프리픽스 파일 없음 (28_ 만 존재).

### 3.2 `25_PhaseP_design4e_ai_builder.md` 존재 여부

**부재**. 25_ 프리픽스 파일도 없음.

### 3.3 phase-p 디렉토리 실체

```
docs/phase-p/ (19 파일)
├── 28_PhaseP_design6_stage3_leaf_adapters.md   ← 유일한 design 문서
├── design-updates-needed.md                     ← Stage 1 산출물
├── known-issues-fixed.md
├── spawn-util-investigation.md
├── stage-{1,2,3,4,5,6}-retro.md                ← retro 6개
├── stage-{4,5,6}-investigation.md              ← investigation 3개
├── stage-3-c{7-1,7-1.5,7-2,8-1,9-1}-investigation.md
└── stage-1-integration-report.md
```

→ Stage 5 retro §3.1 에서 언급된 패턴 그대로: **로드맵에 인용된 14 design 문서가 실제로는 대부분 부재**. Stage 7 도 설계 부재. **본 조사가 설계 제안을 병행해야 함**.

### 3.4 결론

13_/25_ 모두 부재 → "참고 설계 없음" 상태에서 출발. 장점: 자유롭게 결정 가능. 단점: 결정 사항 회수 위험 (Stage 6 처럼 매 블록 조정 발생).

**완화**: 본 조사의 §4-§9 가 실질적 설계 제안. Stage 7 첫 작업 블록 진입 전 사용자 확인 단계 권장.

---

## 4장. Pipeline UI 요구사항

### 4.1 기존 page 에 ADPL pipeline 다루는 곳 존재 여부

**없음**. 현재 6개 page 중 어떤 것도 ADPL pipeline 을 직접 시각화하지 않음.

가장 가까운 후보:
- `src/app/tasks/[id]/page.tsx` — task detail (legacy task 기준)
- `src/app/tasks/[id]/components/DagView.tsx` — xyflow 기반 stage 그래프

→ legacy `attempts/verifications` 데이터를 그래프로 그림. ADPL `pipeline_run_state` 가 아님.

### 4.2 Task 상태 조회 경로

**기존**: `legacy events` 테이블 + `attempts/verifications` REST API.

API:
- `GET /api/tasks/[id]` — task row
- `GET /api/tasks/[id]/events` — `events` 테이블 (legacy taskId 기반, polling)
- `GET /api/events?taskId=...` — SSE (taskId 기준, 단일 stream)

→ **Phase P run/event 조회 경로 0건**. `pipeline_runs`/`pipeline_run_state`/`pipeline_events` 테이블을 read 하는 코드는 src/app/ 전체에 부재 (grep 0 매치).

### 4.3 F5 의 `pipeline_events` 조회 API 구현 필요 여부

**필요 (필수)**. F5 에서 write 만 구현, read API 0건. UI 가 timeline / 노드 별 이벤트 표시하려면 다음이 필요:

| API | 역할 | 우선순위 |
|-----|------|---------|
| `GET /api/pipeline-runs` | 활성/완료 run 목록 | 높음 |
| `GET /api/pipeline-runs/:runId` | 특정 run 상태 (PipelineRunState 직렬화) | 높음 |
| `GET /api/pipeline-runs/:runId/events` | 이벤트 list (페이지네이션) | 높음 |
| `GET /api/pipeline-runs/:runId/stream` | SSE 라이브 (현재 진행 중일 때) | 중 |
| `POST /api/pipeline-runs/:runId/resume` | F3 의 `resumePhasePPipeline(runId)` 호출 | 중 |
| `POST /api/pipeline-runs/:runId/cancel` | Executor.cancel(runId) | 중 |

### 4.4 SSE 구현 현재 상태

**부분적 — legacy 만 존재**. `src/app/api/events/route.ts` (lines 7-61) 가 SSE stream 구현하나 다음 한계:
- `taskId` 파라미터 기준만 (legacy)
- `WorkerManager.instance.on(taskId, ...)` + `eventBus.on(taskId, ...)` 두 source 합침
- Phase P `runId` 기준 분기 0줄

Phase P 용 신규 SSE route 가 필요하거나 기존 `/api/events` 에 `runId` 파라미터 분기 추가가 필요. 후자가 변화 적음.

### 4.5 pipeline_runs row 라이프사이클 (Stage 6 retro 이슈 1)

UI 가 활성 run 목록을 권위 있게 조회하려면 `pipeline_runs` 행이 채워져 있어야 함. F1-F5 전체에서 이 테이블에 insert/update 하는 코드 **0줄** (Stage 6 retro §알려진 이슈 1 에서 명시).

→ **Stage 7 진입 전 우선 작업 후보**: `pipeline_runs` 라이프사이클 micro-fix (Executor.run 시작 시 insert + 종료 시 status/duration update).

---

## 5장. YAML editor 요구사항

### 5.1 Monaco / CodeMirror 설치 상태

**미설치**. `package.json` 의존성에 `monaco-editor`/`@monaco-editor/react`/`codemirror` 어떤 것도 없음.

기존 코드 표시는 `highlight.js` 사용 (`CodeBlock.tsx`) — read-only 만 가능.

### 5.2 ADPL 문법 검증 — 기존 zod schema 재사용 가능성

**가능**. `src/lib/adpl/schemas/nodes/*.ts` 에 zod 스키마 25 파일 존재 (Stage 1 산출물). `js-yaml` 로 파싱 후 `safeParse()` 로 즉시 검증 가능.

CLI 의 `pnpm adpl:validate` 가 동일 zod 사용 → 같은 검증을 브라우저 (또는 server action) 으로 옮기면 됨.

### 5.3 자동완성 범위

도구 없이도 가능한 범위:
- 노드 타입 (`agent / shell / http / webhook_out / branch / parallel / loop / gate / mcp / set / transform`) — 11종 enum
- top-level 키 (`adplVersion / triggers / pipeline / settings / variables`)
- 노드별 필수 필드 (zod 에서 추출 가능)

도구 필요 (Monaco/CodeMirror 도입 시):
- 인라인 에러 표시 (LSP-like)
- 자동 들여쓰기, 폴딩
- 표현식 자동완성 (`$nodes.X.Y.Z` 노드 ID 추론)

### 5.4 Syntax highlighting

YAML highlight 은 `highlight.js` 가 이미 지원 (기본 lang `yaml`). read-only 표시는 신규 라이브러리 0건.

쓰기 모드 (편집)는 Monaco / CodeMirror 필수. `<textarea>` + onChange 로 시작은 가능하나 사용자 경험 큰 차이.

### 5.5 외부 패키지 추가 필요성 — 31 commits 0건 원칙과의 충돌

**판단 필요 시점**:

| 옵션 | 외부 패키지 | UX 품질 | 소요 |
|------|-----------|---------|------|
| A. read-only + textarea 편집 | 0건 | 낮음 | 1-2일 |
| B. CodeMirror 6 (`@codemirror/lang-yaml`) | +5~7 패키지 | 중 | 3-4일 |
| C. Monaco Editor (`@monaco-editor/react`) | +1 패키지 (큰 번들) | 높음 | 3-4일 |

**조사 권고**: B 또는 C 둘 중 하나. 31 commits 원칙은 이미 Phase P engine core 에서 가치 입증됐으나 UX layer 까지 확장하는 것은 사용자 가치 손실. 원칙 부분 완화 (UX layer 한정 1-2 패키지 허용) 권장.

---

## 6장. AI Builder 요구사항

### 6.1 자연어 → ADPL YAML 변환 LLM

**Anthropic Claude 사용 가능 (이미 설치)**:
- `@anthropic-ai/sdk@^0.80.0` — REST API 클라이언트
- `@anthropic-ai/claude-agent-sdk@^0.2.86` — 상위 agent 추상화

기존 사용처 3곳:
- `src/worker/planning.ts` — Plan 생성에 SDK 호출
- `src/app/api/harness/ai-edit/route.ts` — Harness AI 편집
- `src/lib/plugins/agents/claude-code.ts` — agent backend

→ **Anthropic SDK 의 prompt 호출 패턴이 이미 codebase 에 정착**. AI Builder 도 동일 패턴으로 구현 가능, 추가 패키지 0건.

### 6.2 Prompt template 관리

기존 패턴: `.autodev/agents/*.md` (planner/coder/verifier/evaluator/debate-drafter) — 프롬프트가 Markdown 파일로 저장, `loadPrompt(role, projectDir)` 로 로드.

→ AI Builder 프롬프트도 같은 위치에 추가 (`.autodev/agents/builder.md`) 가 자연스러움. system prompt + few-shot 예시 (`examples/adpl/01-hello-world.yaml` 등을 인용) 패턴.

### 6.3 생성된 YAML 검증 경로

**완비**:
- `js-yaml.load()` 로 파싱
- `PipelineCompiler.compile(yaml)` 로 ADPL 컴파일 (Stage 2 산출물)
- 실패 시 LLM 에 에러 피드백해 재생성

→ AI Builder 의 핵심 가치 (검증 → 자동 수정 루프) 가 기존 인프라로 즉시 가능.

### 6.4 Iterative refinement (사용자 피드백 → 재생성)

API 흐름:
```
POST /api/ai-builder/generate
  body: { prompt: "...", previousAttempt?: yaml, feedback?: "..." }
  resp: { yaml: string, compileErrors?: [...] }
```

세션 상태 보존:
- 단순: 매 요청 stateless (사용자가 prompt 에 모든 컨텍스트 포함)
- 향상: `ai_builder_sessions` 테이블 (대화 turn 보존) — Stage 7 내 또는 Stage 7+ 결정

### 6.5 비용 / 토큰 한도

`pipeline_runs.totalCostUsd / totalTokensIn / totalTokensOut` 컬럼은 Phase P 용. AI Builder 호출은 별도 추적 필요. 기존 `usage/page.tsx` 가 어떤 데이터를 모으는지 확인 후 통합 또는 분리 결정.

---

## 7장. 테스트 전략

### 7.1 React Testing Library 설치 여부

**미설치**. `package.json` devDependencies 에 `@testing-library/react` / `@testing-library/jest-dom` / `@testing-library/user-event` 0건.

### 7.2 Playwright 설치 여부

**설치 ✅**: `playwright@^1.58.2` (dependencies). 단 현재 사용은 visual regression 또는 task screenshot 비교 (`screenshot-desktop`, `sharp` 함께 사용). Browser E2E 테스트는 `verify:e2e` script 형태로 존재하나 UI 컴포넌트 단위 테스트 부재.

### 7.3 vitest 환경

`vitest.config.ts` (14줄):
```typescript
test: {
  environment: 'node',
  include: ['src/**/*.test.ts'],
}
```

→ **`environment: 'node'` + `.test.ts` 만 포함**. `.tsx` 파일은 vitest 매칭 0건. UI 컴포넌트 테스트 작성하려면:
1. `environment: 'jsdom'` 또는 `happy-dom` 으로 변경
2. include 패턴에 `.tsx` 추가
3. `@testing-library/react` 또는 동등 라이브러리 도입

### 7.4 기존 UI 컴포넌트 테스트 관례

**부재**. 877 테스트 전부 backend 코드 (`.test.ts`). UI 컴포넌트 (25 파일) 에 대응 테스트 0건.

### 7.5 Visual regression 구축 상태

부분적. `src/app/tasks/[id]/components/ScreenshotCompare.tsx` 는 task 비교용 (legacy verifier output). UI 컴포넌트 회귀 테스트는 미구축.

### 7.6 Verify Agent 의 UI 코드 평가 가능성

Stage 1-6 의 verify:cross 는 backend 코드 정확성 (typecheck + API health + 다른 LLM 리뷰) 위주. UI 코드 평가 시 다음 영역에서 명확성 떨어짐:
- 시각적 디자인 일관성 (색상, spacing, 정렬)
- 접근성 (ARIA, 키보드 네비게이션)
- 반응형 동작
- 사용성 (UX heuristics)

→ Verify Agent 의 점수 계단 효과 (98 vs 96) 가 UI commit 에서 더 변동성 클 수 있음.

---

## 8장. Verify 점수 우려

### 8.1 Stage 5-6 점수 패턴

5 commits (Stage 5 E1-E3, E5) + 7 commits (Stage 6 조사·F1-F5·retro) **모두 A 98/100** (48/50 Verify Agent). "0 issues = 48/50 = 98점" 일관 유지.

### 8.2 Stage 7 평균 예상

**중립 ~ 약간 하락**. 근거:
- UI 코드는 Verify Agent 가 평가하기 어려운 영역 (8.6 참조)
- "이 버튼 크기가 적절한가" / "spacing 일관성" / "접근성 부족" 같은 지적 발생 가능
- 기존 디자인 시스템 (`var(--text-secondary)` 등) 따라가면 일관성 어느 정도 보장
- Verify Agent 가 모르는 문제: "사용자가 실제로 쓸 만한가" (Verify 는 PR 같은 코드만 봄)

### 8.3 점수 유지 전략

- 기존 mission/* 컴포넌트 패턴 (KanbanView, GridView, ...) 미러링
- Tailwind 클래스 + CSS 변수 일관 사용
- i18n (`useTranslations`) 도입 (외부 시각 일관성 + 다국어 대응)
- Storybook 같은 외부 도구는 도입 안 함 (외부 패키지 0 원칙)

### 8.4 새 score 영역 가능성

verify:cross 의 "Verify Agent Review" 단계를 UI 친화적으로 확장? 예: "디자인 토큰 일관성" 체크리스트 추가. **Stage 7 범위 밖, 별도 작업** (verify:cross 자체 개편).

---

## 9장. 작업 블록 분해 제안

### 9.1 블록 목록

| 블록 | 범위 | 예상 소요 | 의존성 |
|------|------|----------|--------|
| **G0** Pipeline 조회 API + pipeline_runs 라이프사이클 | `/api/pipeline-runs/*` 5종 + Executor.run insert/update | 1-2일 | 없음 (백엔드, Stage 6 결산) |
| **G1** Pipeline list page (`/pipelines`) | 활성 + 완료 run 목록, 상태별 필터 | 1일 | G0 |
| **G2** Pipeline detail page (`/pipelines/[runId]`) | DagView 재활용으로 노드 그래프 + 이벤트 timeline | 1-2일 | G0, G1 |
| **G3** Real-time event stream | `/api/pipeline-runs/[runId]/stream` (SSE) + UI 구독 hook | 1일 | G0, G2 |
| **G4** YAML viewer (read-only) | highlight.js + ADPL 컴파일 결과 표시 | 0.5일 | G2 |
| **G5** YAML editor (편집) | CodeMirror 또는 Monaco + zod 라이브 검증 | 2-3일 | G4 + 외부 패키지 결정 |
| **G6** AI Builder (자연어 → YAML) | Anthropic SDK 호출 + `.autodev/agents/builder.md` + 검증 루프 | 2-3일 | G5 |
| **G7** Resume / cancel UI | F3 의 resumePhasePPipeline 트리거 버튼 + cancel 모달 | 0.5일 | G2, G3 |
| **G8** Stage 7 retro | stage-7-retro.md | 0.5일 | 마지막 |

총 예상: 9.5 ~ 13.5일 (3-4주 로드맵 추정과 일치).

### 9.2 선후 순서 다이어그램

```
G0 (조회 API + 라이프사이클)
  └── G1 (list page)
        └── G2 (detail page + DagView)
              ├── G3 (SSE 라이브)
              ├── G4 (YAML viewer)
              │     └── G5 (YAML editor)
              │           └── G6 (AI Builder)
              └── G7 (resume/cancel UI)
                    └── G8 (retro)
```

병렬 가능: G3 ⇄ G4, G7 ⇄ G6 (G6 가 길면 G7 먼저 끝남).

### 9.3 Stage 7 범위 포함/제외 권장

| 항목 | 포함 여부 | 이유 |
|------|---------|------|
| G0 조회 API + pipeline_runs lifecycle | ✅ 필수 | UI 의 단일 source of truth |
| G1 list / G2 detail | ✅ 필수 | 가장 사용자 가시성 큰 가치 |
| G3 SSE | ✅ 필수 | 실시간 진행 표시 |
| G4 YAML viewer | ✅ 필수 | 읽기는 모든 page 에서 부담 없음 |
| G5 YAML editor | ⚠️ 조건부 | 외부 패키지 필요 — 결정 1번 |
| G6 AI Builder | ✅ 핵심 차별화 | v1.0 RC 의 차별화 (로드맵 §4 시나리오 B) |
| G7 resume/cancel UI | ✅ 포함 | F3 의 resumeRun 활용 |
| 메트릭 sync (`pipeline_runs.totalCostUsd` 등) | ⚠️ 조건부 | G0 와 함께 또는 별도 Stage 7+ |
| Verifier adapter UI | ❌ Stage 7+ | 별도 영역, Stage 5 retro 이월 |
| 다국어 UI (Phase P 영역) | ✅ 부수 | i18n 패턴 이미 있음, 함께 작업 |

---

## 10장. 리스크 분석

### 10.1 Verify Agent 명확성 부족

UI 코드의 "잘 만들어진"과 "그럭저럭"의 차이를 Verify Agent (다른 LLM) 가 잡기 어려움. 점수 인플레 또는 의외의 디플레 발생 가능. 완화: `verify:cross` 가 UI 영역에서는 사용자 manual smoke test 권장 + 자체 체크리스트 (8.3) 사용.

### 10.2 외부 패키지 추가 권고 압력

YAML editor (Monaco/CodeMirror), 차트 (recharts/visx), 폼 (react-hook-form) 등 권고 받기 쉬움. 31 commits 원칙을 어느 영역까지 고수할지 1번 결정 필요.

### 10.3 AI Builder 비결정성

LLM 호출은:
- 응답 시간 5-30초 (사용자 대기 UX 필요)
- 비결정적 (같은 입력 다른 출력)
- 비용 발생 (token 한도 관리 필수)
- 테스트 어려움 (mock 외에 정확성 검증 곤란)

완화: `ai_builder_sessions` 테이블 + cache. 동일 prompt 24시간 내 재요청 시 cache hit. Stage 7 내 구현 또는 Stage 7+ 이월 결정.

### 10.4 자기참조 구조

AutoDev 가 AutoDev UI 를 만드는 작업. 작업 중 dev server 가 죽으면 본인 작업 페이지가 멈춤. 완화:
- 별도 worktree 분기 작업 권장 (Stage 6 F4 의 격리 결과 활용)
- dev server 별도 process 실행 (`pnpm dev` 백그라운드)
- 변경 후 hot reload 의존성 — 종종 build 실패 시 재시작 필요

### 10.5 Pipeline UI 와 legacy task UI 혼란

기존 `tasks/[id]/page.tsx` 는 legacy task 기준. Stage 7 의 `pipelines/[runId]/page.tsx` 는 ADPL run 기준. **두 page 동시 존재 시 사용자 혼란**.

해결 옵션:
- A. 두 page 분리 유지 (legacy 격리)
- B. `tasks/[id]/page.tsx` 가 task 의 pipelineMode 에 따라 분기 렌더
- C. 통합 — task 가 phase_p mode 면 pipeline run 자동 생성 후 새 page 로 redirect

조사 권고: A (분리 유지) → 충돌 risk 낮음. legacy 회귀 0건 원칙 그대로 유지.

### 10.6 SSE connection 누수

기존 legacy `/api/events` 는 abort listener 로 cleanup 처리됨 (line 44-49). Phase P SSE 도 동일 패턴 따라야 함. 추가 위험: `EventBus.on('*', ...)` 로 attach 하면 모든 run 의 모든 event 가 한 stream 으로 들어옴 → runId 필터 필수.

---

## 마지막 섹션 — 구현 전 판단 필요 사항

### 판단 1. 첫 구현 대상

**추천: G0 (Pipeline 조회 API + pipeline_runs 라이프사이클) 부터 시작**.

이유:
- G1-G7 모두 G0 의 read API 의존
- pipeline_runs 라이프사이클은 Stage 6 retro 의 알려진 이슈 1번 — Stage 7 진입 전 정리하기 적합
- 백엔드 코드 → Verify Agent 평가 안정 영역 (Stage 6 까지의 점수 패턴 유지)
- 완료 후 G1/G2 가 즉시 의미 있는 UI 산출

### 판단 2. 외부 패키지 추가 권고 (Monaco / CodeMirror)

**추천: G5 진입 시점에 결정. CodeMirror 6 권장**.

이유:
- 31 commits 0건 원칙은 engine core 의 가치였음. UX layer 까지 고수는 사용자 가치 손실
- CodeMirror 6 가 Monaco 보다 번들 크기 작고 의존성 가벼움 (`@codemirror/lang-yaml` + `@codemirror/state` + `@codemirror/view` 등 5-7 패키지)
- Monaco 는 큰 번들, Webpack 설정 추가 필요 (Next.js 와 통합 까다로움)

대안: G5 를 textarea 기반 MVP 로 시작 + Stage 7+ 에서 CodeMirror 도입. 단 사용자 경험 큰 차이.

### 판단 3. LLM 호출 아키텍처 (Claude API 직접 vs MCP)

**추천: Claude API 직접 (`@anthropic-ai/sdk`)**.

이유:
- 이미 3곳에서 동일 SDK 사용 (planning.ts / harness ai-edit / claude-code agent)
- MCP 는 외부 시스템 통합 패턴이고 AI Builder 는 내부 LLM 호출
- 직접 호출이 응답 stream / cancel / retry 제어 명확

prompt 위치: `.autodev/agents/builder.md` (기존 5개 + 신규 1개 = 6개로 확장).

### 판단 4. UI 테스트 전략 제안

**추천: 3단계 점진**:

1. **G0-G3 (백엔드 + 데이터 흐름)**: 기존 vitest `.test.ts` 패턴 유지 (RTL 도입 0건). API route 와 hook 만 단위 테스트.
2. **G4-G7 (UI 컴포넌트)**: smoke test 만. Playwright 로 page 가 200 OK 응답 + 핵심 셀렉터 존재 확인.
3. **G6 (AI Builder)**: Anthropic SDK mock + integration test 1-2개. 실제 LLM 호출은 manual + cost 모니터링.

→ **RTL 도입 보류**. vitest 환경 변경 (jsdom 추가) 부담 vs 가치 작음. Playwright 로 충분.

### 판단 5. AI Builder 범위 (1차 vs 2차)

**추천: 1차 = 자연어 → YAML 단일 호출 + 검증 루프 자동 1회만**.

1차 (Stage 7):
- Anthropic SDK 호출 1회
- 결과 yaml → `PipelineCompiler.compile()` 검증
- 실패 시 LLM 에 에러 피드백 후 재호출 (최대 2회)
- 성공 시 사용자에게 표시, 사용자가 그대로 저장 또는 textarea 로 편집

2차 (Stage 7+ 또는 v1.5):
- 대화형 refinement (`ai_builder_sessions` 테이블)
- prompt template 다양화 (도메인별)
- few-shot 예시 동적 선택
- cache layer

이렇게 분리하면 G6 가 1.5-2일 안에 완료 가능.

### 판단 6. F5 의 pipeline_events 조회 API 도 G 블록에 포함

**추천: G0 에 통합**.

이유:
- G0 는 이미 `/api/pipeline-runs/*` 묶음, 거기에 events 조회 추가
- 별도 G 블록으로 분리 시 G0 → G3 의존성 더 복잡
- pipeline_runs 라이프사이클과 events 조회는 같은 백엔드 작업 영역

→ G0 가 단일 작업으로:
- POST 0건 (read 만 + Executor.run lifecycle hook)
- GET 5종 (`/runs`, `/runs/:id`, `/runs/:id/events`, `/runs/:id/stream`)
- POST 2종 (`/runs/:id/resume`, `/runs/:id/cancel`)

---

## 수락 기준 점검

- [x] 1장 로드맵 §Stage 7 인용 — 행 1개 (G 분해 부재 명시)
- [x] 2장 page 파일 목록 6개 — 모두 실제 경로
- [x] 3장 13_ / 25_ 설계 문서 부재 명시 (둘 다 NO)
- [x] 4장 F5 조회 API — NO (부재 명시)
- [x] 4장 SSE 현재 상태 — legacy taskId 기반만 존재 (Phase P NO)
- [x] 5장 Monaco/CodeMirror — 미설치 명시
- [x] 6장 AI Builder LLM — Anthropic SDK 이미 설치 + 3곳 사용 명시
- [x] 7장 RTL 미설치, Playwright 설치 명시
- [x] 8장 Verify 점수 계단 우려 명시
- [x] 9장 G 블록 9개 (G0-G8) + 예상 소요 + 의존성
- [x] 10장 리스크 6건
- [x] 마지막 섹션 판단 6건 (요청 5건 + 추가 1건)
- [x] 코드/테스트 수정 0건 (이 문서만 추가)
- [x] 커밋 로컬만 권장 (push 금지 — 사용자 명시)

---

## 다음 단계

1. 본 조사 commit (로컬, push 없음)
2. 사용자 확인 → G0 진입 결정 또는 판단 6건 중 일부 재조정
3. G0 첫 implementation prompt 작성 (사용자가 작성)
4. Stage 7 시작
