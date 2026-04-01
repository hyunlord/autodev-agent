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

### 자동 검증 규칙 (필수)

**모든 코드 변경 후 반드시 아래를 실행한다. 예외 없음.**

#### Step 1: Build Check
```bash
pnpm build
```
exit code 0이 아니면 즉시 수정한다. 커밋하지 않는다.

#### Step 2: Import/Type Check
- 새로 추가한 import가 존재하는 모듈을 가리키는지 확인
- TypeScript 타입 에러가 없는지 확인

#### Step 3: Regression Check
변경한 파일이 기존 기능에 영향을 주는지 확인:
- API route 변경 → 해당 엔드포인트 curl로 200 확인
- page.tsx 변경 → pnpm dev 시작 후 Playwright로 페이지 렌더링 확인
- worker/ 변경 → 작업 생성 → 파이프라인 정상 동작 확인

#### Step 4: UI Check (UI 변경 시)
Playwright MCP로 실제 브라우저에서 확인:
```bash
pnpm dev &
DEV_PID=$!
sleep 5
```
- localhost:3000 접속
- 변경된 요소 렌더링 확인
- 콘솔 에러 0건 확인
- 검증 완료 후 서버 정리:
```bash
kill $DEV_PID 2>/dev/null
lsof -ti:3000 | xargs kill -9 2>/dev/null
```

#### 금지
- "빌드는 아마 통과할 거야" → 반드시 실행해서 확인
- "UI는 잘 될 거야" → Playwright로 확인
- 검증 없이 "완료했습니다" 라고 하지 않는다
- 서버를 띄웠으면 반드시 내린다

## 현재 진행 상황

Phase A (핵심 지능): 5/5 완료
다음: Harness Engineering → MCP 연결 → Verification 고도화
