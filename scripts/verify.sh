#!/bin/bash
set -e

MODE="${1:-quick}"  # quick, full, or cross
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "🔍 Verify mode: $MODE"
echo ""

# Score tracking
TOTAL_SCORE=0
MAX_SCORE=0
DETAILS=""

add_score() {
  local name="$1"
  local points="$2"
  local max="$3"
  local note="$4"
  TOTAL_SCORE=$((TOTAL_SCORE + points))
  MAX_SCORE=$((MAX_SCORE + max))
  if [ "$points" -eq "$max" ]; then
    DETAILS="${DETAILS}│ $(printf '%-18s' "$name") │ $(printf '%3s' "$points")/${max} │ ✅ ${note}\n"
  elif [ "$points" -eq 0 ]; then
    DETAILS="${DETAILS}│ $(printf '%-18s' "$name") │ $(printf '%3s' "$points")/${max} │ ❌ ${note}\n"
  else
    DETAILS="${DETAILS}│ $(printf '%-18s' "$name") │ $(printf '%3s' "$points")/${max} │ ⚠️  ${note}\n"
  fi
}

# ─── Step 1: Build (30점) ─────────────────────
echo "=== Step 1: Build ==="
BUILD_OUTPUT=$(pnpm build 2>&1)
BUILD_EXIT=$?
echo "$BUILD_OUTPUT" | tail -3

if [ $BUILD_EXIT -eq 0 ]; then
  add_score "Build" 30 30 "exit 0"
else
  add_score "Build" 0 30 "FAILED"
  # Build fail = instant F
  echo ""
  echo "┌────────────────────┬───────┬──────────┐"
  echo "│       항목         │ 점수  │   상태   │"
  echo "├────────────────────┼───────┼──────────┤"
  echo "│ Build              │  0/30 │ ❌ FAIL  │"
  echo "├────────────────────┼───────┼──────────┤"
  echo "│ TOTAL              │  0    │ F (빌드 실패) │"
  echo "└────────────────────┴───────┴──────────┘"
  exit 1
fi
echo ""

# ─── Step 2: TypeScript Errors (20점) ─────────
echo "=== Step 2: TypeScript ==="
TS_ERRORS=$(echo "$BUILD_OUTPUT" | grep -c "Type error" || true)
if [ "$TS_ERRORS" -eq 0 ]; then
  add_score "TypeScript" 20 20 "에러 0건"
  echo "  ✅ TypeScript 에러 없음"
else
  add_score "TypeScript" 0 20 "${TS_ERRORS}건 에러"
  echo "  ❌ TypeScript 에러 ${TS_ERRORS}건"
fi
echo ""

# ─── Step 3: API Health (20점) ────────────────
echo "=== Step 3: API Health ==="
pnpm dev > /dev/null 2>&1 &
DEV_PID=$!
sleep 6

API_PASS=0
API_TOTAL=0
for EP in "/api/status" "/api/projects" "/api/tasks" "/api/mcp" "/api/harness" "/api/pipeline" "/api/usage"; do
  API_TOTAL=$((API_TOTAL + 1))
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000${EP}" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "  ✅ $EP → $STATUS"
    API_PASS=$((API_PASS + 1))
  else
    echo "  ❌ $EP → $STATUS"
  fi
done

# Cleanup
kill $DEV_PID 2>/dev/null
sleep 1
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

if [ $API_PASS -eq $API_TOTAL ]; then
  add_score "API Health" 20 20 "${API_PASS}/${API_TOTAL} OK"
elif [ $API_PASS -gt 0 ]; then
  PARTIAL=$((20 * API_PASS / API_TOTAL))
  add_score "API Health" $PARTIAL 20 "${API_PASS}/${API_TOTAL} OK"
else
  add_score "API Health" 0 20 "전부 실패"
fi
echo ""

# ─── Step 4: UI Check (full/cross만, 15점) ────
if [ "$MODE" = "full" ] || [ "$MODE" = "cross" ]; then
  echo "=== Step 4: UI Check ==="
  pnpm dev > /dev/null 2>&1 &
  DEV_PID=$!
  sleep 6

  UI_PASS=0
  UI_TOTAL=0
  for PAGE in "/" "/harness"; do
    UI_TOTAL=$((UI_TOTAL + 1))
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000${PAGE}" 2>/dev/null)
    if [ "$STATUS" = "200" ]; then
      echo "  ✅ ${PAGE} → ${STATUS}"
      UI_PASS=$((UI_PASS + 1))
    else
      echo "  ❌ ${PAGE} → ${STATUS}"
    fi
  done

  kill $DEV_PID 2>/dev/null
  sleep 1
  lsof -ti:3000 | xargs kill -9 2>/dev/null || true

  if [ $UI_PASS -eq $UI_TOTAL ]; then
    add_score "UI Pages" 15 15 "${UI_PASS}/${UI_TOTAL} OK"
  else
    PARTIAL=$((15 * UI_PASS / UI_TOTAL))
    add_score "UI Pages" $PARTIAL 15 "${UI_PASS}/${UI_TOTAL} OK"
  fi
  echo ""
fi

# ─── Step 5: Cross-Check (cross만, 15점) ──────
if [ "$MODE" = "cross" ]; then
  echo "=== Step 5: Cross-Check (다른 CLI로 코드 리뷰) ==="

  # Get recent git diff
  DIFF=$(git diff HEAD~1 --stat 2>/dev/null || echo "no diff")
  CHANGED=$(git diff HEAD~1 --name-only 2>/dev/null | head -10 || echo "")

  if [ -n "$CHANGED" ]; then
    REVIEW_PROMPT="Review this code change for issues. Be critical — try to find bugs, type errors, missing error handling, or regressions.

Changed files:
$CHANGED

Diff summary:
$DIFF

Score the change 0-15:
- 15: No issues found
- 10-14: Minor style issues only
- 5-9: Missing error handling or edge cases
- 0-4: Likely bugs or regressions

Respond with ONLY a JSON: {\"score\": N, \"issues\": [\"issue1\", ...], \"verdict\": \"ok|warn|fail\"}"

    CROSS_RESULT=""

    # Try gemini CLI
    if command -v gemini &> /dev/null; then
      echo "  Using Gemini CLI for cross-check..."
      CROSS_RESULT=$(gemini -p "$REVIEW_PROMPT" 2>/dev/null | tail -20 || echo "")
    fi

    # Fallback: try claude API via curl
    if [ -z "$CROSS_RESULT" ] && [ -n "$ANTHROPIC_API_KEY" ]; then
      echo "  Using Claude API for cross-check..."
      CROSS_RESULT=$(curl -s https://api.anthropic.com/v1/messages \
        -H "content-type: application/json" \
        -H "x-api-key: $ANTHROPIC_API_KEY" \
        -H "anthropic-version: 2023-06-01" \
        -d "{\"model\":\"claude-sonnet-4-20250514\",\"max_tokens\":500,\"messages\":[{\"role\":\"user\",\"content\":\"$REVIEW_PROMPT\"}]}" 2>/dev/null | grep -o '"text":"[^"]*"' | head -1 || echo "")
    fi

    if [ -n "$CROSS_RESULT" ]; then
      CROSS_SCORE=$(echo "$CROSS_RESULT" | grep -o '"score":[[:space:]]*[0-9]*' | grep -o '[0-9]*' | head -1)
      if [ -n "$CROSS_SCORE" ] && [ "$CROSS_SCORE" -le 15 ]; then
        add_score "Cross-Check" "$CROSS_SCORE" 15 "다른 LLM 리뷰"
        echo "  Score: ${CROSS_SCORE}/15"
        echo "$CROSS_RESULT" | grep -o '"issues":\[[^]]*\]' | head -1 || true
      else
        add_score "Cross-Check" 10 15 "파싱 실패, 기본 점수"
        echo "  ⚠ 점수 파싱 실패, 기본 10점"
      fi
    else
      add_score "Cross-Check" 0 15 "CLI 없음"
      echo "  ⚠ Cross-check CLI를 찾지 못함 (gemini 또는 ANTHROPIC_API_KEY 필요)"
    fi
    echo ""
  else
    add_score "Cross-Check" 15 15 "변경 없음"
    echo "  ✅ 변경된 파일 없음 (skip)"
    echo ""
  fi
fi

# ─── Step 6: E2E 안내 (cross만) ──────────────
if [ "$MODE" = "cross" ]; then
  echo "=== Step 6: E2E Test ==="
  echo "  파이프라인 변경 시 별도 실행: pnpm verify:e2e"
  echo "  (자동 실행 시 5분+ 소요 — cross에서는 안내만)"
  echo ""
fi

# ─── Score Summary ────────────────────────────
PERCENT=$((TOTAL_SCORE * 100 / MAX_SCORE))

if [ $PERCENT -ge 90 ]; then
  GRADE="A"
  LABEL="Ship it"
elif [ $PERCENT -ge 70 ]; then
  GRADE="B"
  LABEL="Acceptable"
elif [ $PERCENT -ge 50 ]; then
  GRADE="C"
  LABEL="Needs work"
else
  GRADE="F"
  LABEL="Reject"
fi

echo "┌────────────────────┬───────┬──────────────────────┐"
echo "│       항목         │ 점수  │        상태          │"
echo "├────────────────────┼───────┼──────────────────────┤"
printf "$DETAILS"
echo "├────────────────────┼───────┼──────────────────────┤"
echo "│ TOTAL              │ $(printf '%3s' $TOTAL_SCORE)/${MAX_SCORE} │ ${GRADE} (${LABEL}) ${PERCENT}%     │"
echo "└────────────────────┴───────┴──────────────────────┘"

if [ "$GRADE" = "F" ]; then
  exit 1
fi
