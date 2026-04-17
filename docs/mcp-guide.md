# MCP 서버 사용 가이드

AutoDev가 설치한 6개 MCP 서버(Sequential Thinking, Context7, Playwright, Memory, Firecrawl, GitHub)의 용도와 호출 예시.

## 사용법

### Sequential Thinking — 복잡한 설계
복잡한 기능을 구현하기 전에 Sequential Thinking을 사용해서 계획을 세운다.
- 현재 상태 파악 → 목표 정의 → 작업 분해 → 검증 방법 설계

### Context7 — 라이브러리 문서
라이브러리 사용법이 불확실하면 Context7로 최신 문서를 참조한다.
"use context7"을 붙여서 사용.
- Next.js 15 App Router, Drizzle ORM, Tailwind CSS 등

### Playwright — UI 검증
UI 변경 후 Playwright MCP로 브라우저에서 실제 확인한다.
- `pnpm dev`를 백그라운드로 시작 (`pnpm dev &`)
- localhost:3000 접속 → 요소 확인 → 콘솔 에러 체크
- 검증 완료 후 반드시 dev server를 kill한다 (포트 충돌 방지)
- 승인 묻지 않고 바로 실행한다

### Memory — 세션 간 기억
중요한 결정이나 발견한 문제는 Memory MCP에 저장한다.
- 아키텍처 결정, 해결한 버그 패턴, 테스트 결과 등

### Firecrawl — 외부 문서 크롤링
외부 API 문서나 참고 사이트의 내용이 필요하면 Firecrawl로 크롤링한다.
- API 공식 문서 수집, 예제 코드 참조

### GitHub — 코드 검색/PR 관리
GitHub 레포에서 구현 패턴을 검색하거나 이슈/PR을 관리한다.
- 유사 구현 검색, 코드 리뷰, 이슈 추적

## 작업 프로토콜 — Plan → Code → Verify

모든 작업은 이 3단계를 순환한다.

1. **Plan**: Sequential Thinking으로 계획 수립. `.autodev/agents/planner.md` 참조.
2. **Code**: Context7로 문서 확인하면서 코드 작성. `.autodev/agents/coder.md` 참조.
3. **Verify**: 코드 수정이 끝나면 반드시 `.autodev/agents/verifier.md`를 읽고 검증을 실행한다.
   - PASS → 완료
   - FAIL → Plan으로 돌아가서 원인 분석 → 재시도 (최대 3회)

> 이 가이드는 CLAUDE.md에서 분리됨 (2026-04-17 균형 슬리밍)
