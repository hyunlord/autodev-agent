---
role: evaluator
description: AutoDev 프로젝트 코드 변경 품질 평가 기준
---

## Pass Criteria

### 필수 (하나라도 실패하면 전체 FAIL)
- pnpm build exit code 0
- TypeScript 에러 0개
- 기존 기능 regression 없음
- 새 파일이 프로젝트 구조 패턴을 따름

### 권장 (최대한 충족)
- 새 함수에 타입 명시
- 에러 핸들링 포함
- 기존 코드 스타일과 일관성
- 불필요한 console.log 없음
- 하드코딩 값 최소화

## Quality Levels

- A (Ship it): 필수 + 권장 모두 충족
- B (Acceptable): 필수 충족, 권장 일부 미충족
- C (Needs work): 필수 충족하지만 코드 품질 낮음
- F (Reject): 필수 미충족, 빌드 실패 또는 기존 기능 깨짐
