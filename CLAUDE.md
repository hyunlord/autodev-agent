# AutoDev Agent — Project Instructions

> Claude Code가 이 프로젝트에서 작업할 때 반드시 읽어야 하는 지시서

## 프로젝트 개요

AutoDev Agent는 AI 코딩 에이전트를 조율하는 유니버설 오케스트레이터.
사용자가 자연어로 작업을 지시하면 Planning → Coding → Verification 파이프라인으로 자동 실행.

## 기술 스택

- **런타임**: Node.js (Next.js 15, App Router)
- **언어**: TypeScript (strict)
- **DB**: SQLite + Drizzle ORM
- **UI**: React (Next.js pages, Tailwind CSS)
- **프로세스**: Worker (IPC) — `src/worker/index.ts`
- **패키지 매니저**: pnpm
- **빌드**: `pnpm build` (= `next build`)
- **개발**: `pnpm dev` (= `next dev`)

## 아키텍처

```
src/
├── app/                    ← Next.js pages + API routes
│   ├── page.tsx            ← Dashboard (작업 생성, 프로젝트 목록)
│   ├── tasks/[id]/page.tsx ← Task Detail (실시간 이벤트, Plan 리뷰)
│   ├── projects/[dir]/     ← Project Management (파일, 이력, 삭제)
│   └── api/                ← REST API (tasks, events, projects, files, usage)
├── lib/                    ← 공유 라이브러리
│   ├── db/                 ← SQLite schema + client (Drizzle)
│   ├── plugins/
│   │   ├── agents/         ← 5 coding agents (claude-code, codex-cli, gemini-cli, aider, cline-cli)
│   │   ├── verifiers/      ← 8 verification types
│   │   └── vlm/            ← Vision language model
│   ├── agent-selector.ts   ← LLM 추천 기반 에이전트 선택
│   ├── prompts/presets.ts  ← 6 system prompt presets
│   └── types.ts            ← 공통 타입
└── worker/                 ← 백그라운드 파이프라인
    ├── pipeline.ts         ← 메인 오케스트레이터
    ├── planning.ts         ← Plan 생성 (Claude CLI / Gemini CLI / API)
    ├── verification.ts     ← 검증 실행
    ├── retry.ts            ← 재시도 컨트롤러
    └── escalation.ts       ← 에스컬레이션 리포트
```

## 코딩 규칙

1. TypeScript strict — any 사용 최소화, 타입 명시
2. next build 필수 통과 — 모든 변경 후 빌드 에러 0 확인
3. Drizzle ORM — raw SQL 금지, 스키마 변경 시 migration 생성
4. execa — 외부 프로세스 실행은 `src/lib/execa.ts` 래퍼 사용
5. nanoid — ID 생성은 항상 nanoid 사용
6. 에러 핸들링 — try/catch 후 emit으로 에러 전파, 조용히 삼키지 않기
7. globalThis 싱글톤 — DB, Worker는 globalThis에 저장 (HMR 대응)
8. 경로 — 절대 경로 금지, 프로젝트 루트 기준 상대 경로
9. 기존 기능 유지 — 새 기능 추가 시 기존 동작 깨뜨리지 않기
10. 한국어 주석 OK — 코드 내 한국어 주석 허용, 변수명은 영어

## 파이프라인 흐름

```
Task 생성 → Planning (CLI/API) → Plan Review (사용자 승인)
→ Agent Selection (LLM 추천) → Coding (선택된 에이전트)
→ Verification (8 types) → Retry (max 3) → Complete/Escalation

Auto-cycle 모드: 위 흐름을 GOAL_COMPLETE까지 반복 (max N cycles)
```

## DB 테이블

- tasks — 작업 (status, plan, prompt, config)
- attempts — 코딩 시도 (agentId, costUsd, tokenCount)
- verifications — 검증 결과 (checkId, status, expected/actual)
- events — SSE 이벤트 (type, data, timestamp)

## 파일 수정 시 주의

- pipeline.ts 수정 → Worker 재시작 필요 (IPC)
- schema.ts 수정 → pnpm db:generate + pnpm db:push 필요
- page.tsx 수정 → 'use client' 확인, SSE EventSource 처리
- API route 추가 → src/app/api/{name}/route.ts 패턴

## .autodev/ 구조

이 프로젝트는 harness engineering 구조를 사용합니다.
`.autodev/agents/` 폴더의 .md 파일들이 각 에이전트의 지시서입니다.

## MCP 서버 (개발 환경)

이 프로젝트는 4개의 MCP 서버가 설치되어 있다.

### 사용법

#### Sequential Thinking — 복잡한 설계
복잡한 기능을 구현하기 전에 Sequential Thinking을 사용해서 계획을 세운다.
- 현재 상태 파악 → 목표 정의 → 작업 분해 → 검증 방법 설계

#### Context7 — 라이브러리 문서
라이브러리 사용법이 불확실하면 Context7로 최신 문서를 참조한다.
"use context7"을 붙여서 사용.
- Next.js 15 App Router, Drizzle ORM, Tailwind CSS 등

#### Playwright — UI 검증
UI 변경 후 Playwright MCP로 브라우저에서 실제 확인한다.
- pnpm dev를 백그라운드로 시작 (pnpm dev &)
- localhost:3000 접속 → 요소 확인 → 콘솔 에러 체크
- 검증 완료 후 반드시 dev server를 kill한다 (포트 충돌 방지)
- 승인 묻지 않고 바로 실행한다

#### Memory — 세션 간 기억
중요한 결정이나 발견한 문제는 Memory MCP에 저장한다.
- 아키텍처 결정, 해결한 버그 패턴, 테스트 결과 등

#### Firecrawl — 외부 문서 크롤링
외부 API 문서나 참고 사이트의 내용이 필요하면 Firecrawl로 크롤링한다.
- API 공식 문서 수집, 예제 코드 참조

#### GitHub — 코드 검색/PR 관리
GitHub 레포에서 구현 패턴을 검색하거나 이슈/PR을 관리한다.
- 유사 구현 검색, 코드 리뷰, 이슈 추적

### 작업 프로토콜 — Plan → Code → Verify

모든 작업은 이 3단계를 순환한다.

1. **Plan**: Sequential Thinking으로 계획 수립. agents/planner.md 참조.
2. **Code**: Context7로 문서 확인하면서 코드 작성. agents/coder.md 참조.
3. **Verify**: 코드 수정이 끝나면 반드시 agents/verifier.md를 읽고 검증을 실행한다.
   - PASS → 완료
   - FAIL → Plan으로 돌아가서 원인 분석 → 재시도 (최대 3회)

### 자동 검증 규칙 — 위반 시 작업 미완료 처리

**이 규칙은 선택이 아니다. 모든 코드 변경에 반드시 적용한다.**

#### 검증 레벨

| 레벨 | 명령어 | 언제 | 점수 | 검증 방식 |
|------|--------|------|------|----------|
| quick | `pnpm verify` | 모든 코드 변경 후 | 70점 만점 | 빌드 + TypeScript + API |
| full | `pnpm verify:full` | UI 변경 시 | 85점 만점 | + UI 페이지 체크 |
| cross | `pnpm verify:cross` | 커밋 전 (필수) | 100점 만점 | + **Verify Agent (다른 LLM이 코드 리뷰)** |
| e2e | `pnpm verify:e2e` | 파이프라인 변경 시 | 100점 만점 | 실제 작업 실행 |
| agent | `pnpm verify:agent` | 수동 실행 | - | Verify Agent만 단독 실행 |

#### Verify Agent 규칙 (레이어 1)

커밋 전 `pnpm verify:cross` 실행 시, **Verify Agent가 변경된 코드를 리뷰**한다.
- Claude Code로 코딩했으면 → Gemini CLI 또는 Codex CLI가 리뷰
- Verify Agent가 없으면 → score 10/15 + warn (빌드를 막지 않음)
- Verify Agent는 레이어 2(서비스)에서 사용하는 것과 **같은 Verify Agent**

#### 등급 기준

| 등급 | 점수 | 의미 |
|------|------|------|
| A | 90%+ | Ship it — 바로 커밋 |
| B | 70-89% | Acceptable — 커밋 가능, 개선 권장 |
| C | 50-69% | Needs work — 수정 후 재검증 |
| F | 50% 미만 | Reject — 반드시 수정 |

#### Cross-Check 규칙 (Verify 에이전트 분리)

**커밋 전에 반드시 `pnpm verify:cross`를 실행한다.**

Cross-check는 **코드를 작성한 LLM과 다른 LLM**이 리뷰한다:
- Claude Code로 코딩했으면 → Gemini CLI가 리뷰
- Gemini CLI로 코딩했으면 → Claude API가 리뷰

이유: 같은 LLM이 자기 코드를 검증하면 자기 합리화가 발생한다.
"코드가 맞아 보인다" → FAIL. 다른 시각에서 깨뜨리려고 시도해야 한다.

#### 절차

1. 코드 수정 완료
2. `pnpm verify` 실행
3. **결과를 반드시 아래 형식으로 사용자에게 보여준다:**

```
┌────────────────────┬───────┬──────────────────────┐
│       항목         │ 점수  │        상태          │
├────────────────────┼───────┼──────────────────────┤
│ Build              │ 30/30 │ ✅ exit 0             │
│ TypeScript         │ 20/20 │ ✅ 에러 0건           │
│ API Health         │ 20/20 │ ✅ 7/7 OK             │
├────────────────────┼───────┼──────────────────────┤
│ TOTAL              │ 70/70 │ A (Ship it) 100%     │
└────────────────────┴───────┴──────────────────────┘
```

4. FAIL이면 즉시 수정 → 다시 verify → PASS까지 반복
5. **결과 표 없이 "완료했습니다"는 금지**

#### hooks가 안 걸려있을 때

세션 시작 시 hooks가 없을 수 있다. 그래도 규칙은 동일:
- 코드 수정 후 `pnpm verify` 직접 실행
- 결과 표 출력
- PASS 확인 후 커밋

hooks 재등록 (선택):
```bash
claude hooks add post-tool-use --scope project \
  --command "cd $(pwd) && pnpm verify 2>&1 | tail -5" \
  --match "Write|Edit|MultiEdit|CreateFile"
```

#### 절대 하지 않는 것

- ❌ 자기가 짠 코드를 자기가 "PASS" 주기
- ❌ Cross-check 없이 커밋
- ❌ 점수가 C 이하인데 커밋
- ❌ "빌드가 통과할 것 같아서" verify 스킵
- ❌ "문서만 수정했으니까" verify 스킵 — 문서도 `pnpm verify` 실행
- ❌ "사소한 변경이니까" verify 스킵 — 한 줄 변경도 verify
- ❌ verify 실패 상태에서 "완료했습니다" 보고
- ❌ verify 없이 커밋

#### verify 실패 시

1. 에러 메시지를 읽는다
2. 해당 파일을 수정한다
3. 다시 `pnpm verify` 실행한다
4. PASS가 나올 때까지 반복한다
5. "3번 시도했는데 안 됩니다"는 허용 — 사용자에게 보고

### Harness 설정 변경 (자연어 제어)

사용자가 harness 설정 변경을 요청하면 해당 .autodev/ 파일을 직접 수정한다.

#### MCP 설정 변경
요청 예시: "Planning에서 context7 빼줘", "Verification에 firecrawl 추가해줘"
→ `.autodev/mcp/config.json` 파일의 `pipeline_mapping` 수정
→ 파일이 없으면 생성 (기본값 기반)

```json
{
  "servers": {},
  "pipeline_mapping": {
    "planning": ["context7", "websearch"],
    "coding": ["codex"],
    "verification": ["playwright"]
  }
}
```

#### 에이전트 프롬프트 변경
요청 예시: "planner에 React 규칙 추가해줘", "verifier에서 빈 파일 기준 100바이트로"
→ `.autodev/agents/{role}.md` 파일 수정
→ frontmatter(---) 유지, 본문만 수정

#### 파이프라인 흐름 변경
요청 예시: "auto-approve 기본으로 켜줘", "retry 5번으로 늘려줘"
→ `.autodev/config.yaml` 생성/수정

```yaml
default_coding_agent: auto
default_planning_mode: claude-cli
auto_approve: true
max_retries: 5
```

#### 규칙
- 변경 후 반드시 변경된 파일 내용을 보여줘서 확인
- JSON/YAML 문법 에러 없는지 확인
- 기존 설정 유지하면서 요청된 부분만 수정
- "리셋해줘" → 해당 .autodev/ 파일 삭제 (코드 기본값으로 폴백)

#### 아키텍처 문서
- v2 재설계: `docs/architecture-v2.md` — 에이전트 분리, Verify Agent, 파이프라인 구조

## 현재 진행 상황

Phase A (핵심 지능): 5/5 완료
다음: Harness Engineering → MCP 연결 → Verification 고도화

## 작업 보고 규칙

모든 코드 변경 작업 완료 시 다음을 순서대로 보고한다:

### 1. Plan 단계
- 어떤 파일을 왜 변경/생성하기로 했는지
- 의존성 순서

### 2. Code 단계
- 실제 변경한 파일 목록 (신규/수정 구분)
- 각 파일의 핵심 변경 내용 (1-2줄)

### 3. Verify 단계
- pnpm build 결과 (통과/실패)
- 발견된 이슈가 있으면 나열

### 4. 요약
- 전체 변경 통계 (파일 수, 줄 수)
- 다음에 해야 할 것 (있으면)

이 보고 없이 "완료"라고만 하지 않는다.
