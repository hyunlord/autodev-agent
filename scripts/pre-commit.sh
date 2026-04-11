#!/bin/bash
# AutoDev Agent — pre-commit hook
# 커밋 전 빌드 + 타입 체크 + verify:cross PASS 강제
#
# 설치: pnpm hook:install
# 제거: pnpm hook:uninstall
# 건너뛰기: git commit --no-verify (긴급 상황만)

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

echo "🔍 pre-commit: Running build check..."

# ── Step 1: Build check ──
BUILD_OUTPUT=$(pnpm build 2>&1) || true

# 빌드 성공 여부: Next.js 빌드 완료 시 "Route (app)" 출력됨
if ! echo "$BUILD_OUTPUT" | grep -q "Route (app)"; then
  echo ""
  echo "❌ pre-commit FAILED: Build error"
  echo ""
  echo "$BUILD_OUTPUT" | tail -20
  echo ""
  echo "Fix build errors before committing."
  exit 1
fi

# ── Step 2: TypeScript error check ──
TS_ERRORS=$(echo "$BUILD_OUTPUT" | grep -c "Type error" || true)
if [ "$TS_ERRORS" -gt 0 ]; then
  echo ""
  echo "❌ pre-commit FAILED: $TS_ERRORS TypeScript error(s)"
  echo ""
  echo "$BUILD_OUTPUT" | grep -A 3 "Type error"
  echo ""
  echo "Fix TypeScript errors before committing."
  exit 1
fi

echo "✅ pre-commit: Build passed"

# ── Step 3: verify:cross 전체 결과 확인 (cross-result.json) ──
# verify.sh cross가 저장하는 전체 등급/점수를 확인
# verdict.json(개별 Agent 결과)이 아니라 cross-result.json(전체 결과)을 사용

CROSS_RESULT="$HOME/.autodev/cross-result.json"
CROSS_REQUIRED=true
MAX_AGE=600  # 10분

# 현재 staged 상태의 tree hash
CURRENT_TREE_HASH=$(git write-tree 2>/dev/null || echo "unknown")

if [ -f "$CROSS_RESULT" ]; then
  # 파일 수정 시간 (macOS/Linux 호환)
  if stat -f %m "$CROSS_RESULT" >/dev/null 2>&1; then
    FILE_MTIME=$(stat -f %m "$CROSS_RESULT")
  else
    FILE_MTIME=$(stat -c %Y "$CROSS_RESULT")
  fi
  NOW=$(date +%s)
  RESULT_AGE=$(( NOW - FILE_MTIME ))

  if [ $RESULT_AGE -lt $MAX_AGE ]; then
    GRADE=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('grade','?'))" 2>/dev/null || echo "?")
    SCORE=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('score',0))" 2>/dev/null || echo "0")
    MAX_SC=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('maxScore',100))" 2>/dev/null || echo "100")
    PERCENT=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('percent',0))" 2>/dev/null || echo "0")
    RESULT_TREE=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('treeHash',''))" 2>/dev/null || echo "")

    if [ "$GRADE" = "A" ] || [ "$GRADE" = "B" ]; then
      # tree hash 비교 — cross 이후 코드가 변경되었으면 재검증
      if [ -n "$RESULT_TREE" ] && [ "$RESULT_TREE" != "unknown" ] && [ "$RESULT_TREE" != "$CURRENT_TREE_HASH" ]; then
        echo "⚠️  pre-commit: verify:cross ${GRADE} (${SCORE}/${MAX_SC}) 있지만 이후 코드 변경됨"
        echo "   result tree: ${RESULT_TREE:0:12}  current tree: ${CURRENT_TREE_HASH:0:12}"
      else
        echo "✅ pre-commit: verify:cross ${GRADE} confirmed (${SCORE}/${MAX_SC} = ${PERCENT}%, ${RESULT_AGE}s ago)"
        CROSS_REQUIRED=false
      fi
    elif [ "$GRADE" = "F" ]; then
      echo ""
      echo "❌ pre-commit: Recent verify:cross FAILED (grade: F, ${SCORE}/${MAX_SC})"
      echo "   Fix issues and run 'pnpm verify:cross' again."
      exit 1
    else
      echo "⚠️  pre-commit: verify:cross grade ${GRADE} (${SCORE}/${MAX_SC}) — needs improvement"
    fi
  else
    echo "⚠️  pre-commit: cross-result.json is stale (${RESULT_AGE}s old, max ${MAX_AGE}s)"
  fi
fi

if [ "$CROSS_REQUIRED" = true ]; then
  echo ""
  echo "🔄 pre-commit: No valid verify:cross PASS found. Running verify:cross now..."
  echo "   (This ensures a different LLM reviews your code before commit)"
  echo ""

  if bash scripts/verify.sh cross; then
    # 실행 후 결과 재확인
    if [ -f "$CROSS_RESULT" ]; then
      GRADE=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('grade','?'))" 2>/dev/null || echo "?")
      SCORE=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('score',0))" 2>/dev/null || echo "0")
      MAX_SC=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('maxScore',100))" 2>/dev/null || echo "100")

      if [ "$GRADE" = "A" ] || [ "$GRADE" = "B" ]; then
        echo ""
        echo "✅ pre-commit: verify:cross ${GRADE} (${SCORE}/${MAX_SC})"
      else
        echo ""
        echo "❌ pre-commit: verify:cross grade ${GRADE} (${SCORE}/${MAX_SC})"
        echo "   Grade A/B required for commit. Fix issues first."
        exit 1
      fi
    else
      echo ""
      echo "❌ pre-commit: verify:cross ran but no cross-result.json produced"
      echo "   Cross-review is mandatory. Use 'git commit --no-verify' for emergencies."
      exit 1
    fi
  else
    echo ""
    echo "❌ pre-commit: verify:cross FAILED"
    echo "   Fix issues and retry, or use 'git commit --no-verify' for emergencies."
    exit 1
  fi
fi

exit 0
