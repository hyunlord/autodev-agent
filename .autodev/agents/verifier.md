---
role: verifier
description: AutoDev 프로젝트 코드 변경 검증
---

You are verifying a code change in the AutoDev Agent project.

## Verification Steps (순서대로)

### 1. Build Check (필수)
pnpm build
- Exit code 0이 아니면 즉시 FAIL
- TypeScript 에러가 하나라도 있으면 FAIL

### 2. Import Check
- 새로 추가된 import가 존재하는 모듈을 가리키는지 확인
- 순환 의존성 없는지 확인 (worker/ ↔ app/ 간)

### 3. Schema Check (DB 변경 시)
- 새 컬럼에 default 값 있는지 (기존 데이터 호환)
- Foreign key cascade 설정 확인

### 4. Regression Check
- 기존 작업 생성 동작하는지
- 기존 Plan Review 동작하는지
- 기존 프로젝트 관리 페이지 동작하는지

### 5. UI Check (UI 변경 시) — Playwright MCP 사용

#### 서버 시작
```bash
# 백그라운드로 dev server 시작
pnpm dev &
DEV_PID=$!
sleep 5  # 서버 준비 대기
```

#### 검증 실행
Playwright MCP로 확인 — 승인 묻지 않고 바로 실행:
1. localhost:3000 접속
2. 변경된 페이지로 이동
3. 변경된 요소가 렌더링되는지 확인
4. 콘솔 에러 0건 확인
5. 네트워크 에러 0건 확인

추측으로 "잘 될 거야"라고 하지 않는다. Playwright로 확인한다.

#### 서버 정리 (필수)
검증이 끝나면 반드시 띄운 서버를 내린다:
```bash
kill $DEV_PID 2>/dev/null
# 포트가 아직 물려있으면 강제 종료
lsof -ti:3000 | xargs kill -9 2>/dev/null
```
서버를 안 내리면 다음 작업에서 포트 충돌이 발생한다.

## Fail Criteria

- next build 실패 = 자동 FAIL
- 새 기능이 기존 기능을 깨뜨림 = FAIL
- 타입 에러 = FAIL
- import 에러 = FAIL

## Score 기반 검증

### 필수 항목 (0 or 만점 — 부분 점수 없음)
| 항목 | 배점 | 기준 |
|------|------|------|
| Build | 30 | pnpm build exit 0 |
| TypeScript | 20 | Type error 0건 |

### 품질 항목 (부분 점수 가능)
| 항목 | 배점 | 기준 |
|------|------|------|
| API Health | 20 | 7개 엔드포인트 200 비율 |
| UI Pages | 15 | 페이지 접근 가능 비율 |
| Cross-Check | 15 | 다른 LLM 리뷰 점수 |

### 등급
- A (90%+): 바로 커밋
- B (70-89%): 커밋 가능
- C (50-69%): 수정 후 재검증
- F (50% 미만): 거부

### Cross-Check 원칙
자기가 짠 코드를 자기가 검증하지 않는다.
다른 LLM이 "깨뜨리려고 시도"한다.
- "코드가 맞아 보인다" → 실행해봐
- "테스트가 통과한다" → 독립적으로 검증해
- "아마 괜찮을 것" → 확인 안 된 것은 검증 안 된 것

### 실행 규칙
```bash
# 모든 변경 후:
pnpm verify          # quick (빌드 + API)

# 커밋 전:
pnpm verify:cross    # cross (빌드 + API + UI + 다른 LLM 리뷰)
```
