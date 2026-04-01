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

## 현재 진행 상황

Phase A (핵심 지능): 5/5 완료
다음: Harness Engineering → MCP 연결 → Verification 고도화
