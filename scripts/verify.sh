#!/bin/bash
# set -e 제거 — 명시적 에러 핸들링 사용 (BUILD_OUTPUT 캡처 시 set -e가 리포팅 분기 우회)

MODE="${1:-quick}"  # quick, full, or cross
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# Configurable port (respects PORT env var, default 3000)
DEV_PORT="${PORT:-3000}"
DEV_BASE="http://localhost:${DEV_PORT}"

# Track dev server PID for cleanup
DEV_PID=""
trap '[ -n "$DEV_PID" ] && cleanup_server "$DEV_PID"' EXIT

echo "🔍 Verify mode: $MODE"
if [ "$CI" = "true" ]; then
  echo "🤖 CI mode — UI check와 Verify Agent 스킵 (브라우저/LLM CLI 없음)"
fi
echo ""

# ─── Helper: wait for dev server (replaces fixed sleep) ─────
wait_for_server() {
  local max_wait=30
  local waited=0
  while [ $waited -lt $max_wait ]; do
    if curl -s -o /dev/null -w "%{http_code}" "${DEV_BASE}/api/status" 2>/dev/null | grep -q "200"; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# ─── Helper: graceful server cleanup ────────────────────────
cleanup_server() {
  local pid="$1"
  kill "$pid" 2>/dev/null
  sleep 2
  # Only force-kill our own dev process if still running
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null
  fi
  sleep 1
}

# ─── Helper: JSON parsing via Node.js (no python3 dependency) ─
json_get() {
  local json="$1"
  local key="$2"
  local default="${3:-}"
  node -e "try{const d=JSON.parse(process.argv[1]);console.log(d[process.argv[2]]??process.argv[3])}catch{console.log(process.argv[3])}" "$json" "$key" "$default" 2>/dev/null
}

json_get_file() {
  local file="$1"
  local key="$2"
  local default="${3:-}"
  node -e "try{const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf-8'));console.log(d[process.argv[2]]??process.argv[3])}catch{console.log(process.argv[3])}" "$file" "$key" "$default" 2>/dev/null
}

json_get_nested() {
  local file="$1"
  local expr="$2"
  local default="${3:-0}"
  # Note: $expr is always a hardcoded JS expression from within this script, not external input
  node -e "try{const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf-8'));console.log($expr)}catch{console.log(process.argv[2])}" "$file" "$default" 2>/dev/null
}

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

# ─── Step 1: Build (20점) ─────────────────────
echo "=== Step 1: Build ==="
BUILD_OUTPUT=$(pnpm build 2>&1)
BUILD_EXIT=$?
echo "$BUILD_OUTPUT" | tail -3

if [ $BUILD_EXIT -eq 0 ]; then
  add_score "Build" 20 20 "exit 0"
else
  add_score "Build" 0 20 "FAILED"
  # Show error-relevant lines for easier diagnosis
  echo ""
  echo "Build errors:"
  echo "$BUILD_OUTPUT" | grep -i "error" | head -10
  echo ""
  echo "┌────────────────────┬───────┬──────────┐"
  echo "│       항목         │ 점수  │   상태   │"
  echo "├────────────────────┼───────┼──────────┤"
  echo "│ Build              │  0/20 │ ❌ FAIL  │"
  echo "├────────────────────┼───────┼──────────┤"
  echo "│ TOTAL              │  0    │ F (빌드 실패) │"
  echo "└────────────────────┴───────┴──────────┘"
  exit 1
fi
echo ""

# ─── Step 2: TypeScript Errors (10점) ─────────
echo "=== Step 2: TypeScript ==="
TS_ERRORS=$(echo "$BUILD_OUTPUT" | grep -c "Type error" || true)
if [ "$TS_ERRORS" -eq 0 ]; then
  add_score "TypeScript" 10 10 "에러 0건"
  echo "  ✅ TypeScript 에러 없음"
else
  add_score "TypeScript" 0 10 "${TS_ERRORS}건 에러"
  echo "  ❌ TypeScript 에러 ${TS_ERRORS}건"
fi
echo ""

# ─── Step 3: API Health (10점) ────────────────
echo "=== Step 3: API Health ==="
PORT=$DEV_PORT pnpm dev > /dev/null 2>&1 &
DEV_PID=$!
if ! wait_for_server; then
  echo "  ❌ Dev server failed to start within 30s"
  add_score "API Health" 0 10 "서버 시작 실패"
else

API_PASS=0
API_TOTAL=0
for EP in "/api/status" "/api/projects" "/api/tasks" "/api/mcp" "/api/harness" "/api/pipeline" "/api/usage"; do
  API_TOTAL=$((API_TOTAL + 1))
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${DEV_BASE}${EP}" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "  ✅ $EP → $STATUS"
    API_PASS=$((API_PASS + 1))
  else
    echo "  ❌ $EP → $STATUS"
  fi
done

if [ $API_PASS -eq $API_TOTAL ]; then
  add_score "API Health" 10 10 "${API_PASS}/${API_TOTAL} OK"
elif [ $API_PASS -gt 0 ]; then
  PARTIAL=$((10 * API_PASS / API_TOTAL))
  add_score "API Health" $PARTIAL 10 "${API_PASS}/${API_TOTAL} OK"
else
  add_score "API Health" 0 10 "전부 실패"
fi

fi  # end wait_for_server else
echo ""

# ─── Step 4: UI Check (full/cross만, 10점) ────
# Reuse dev server from Step 3 (same DEV_PID) to avoid redundant start/stop
if [ "$MODE" = "full" ] || [ "$MODE" = "cross" ]; then
  echo "=== Step 4: UI Check ==="
  if [ "$CI" = "true" ]; then
    echo "  ⏭️  Skipping UI check in CI (no browser)"
    add_score "UI Pages" 10 10 "skipped (CI)"
  else
    UI_PASS=0
    UI_TOTAL=0
    for PAGE in "/" "/harness"; do
      UI_TOTAL=$((UI_TOTAL + 1))
      STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${DEV_BASE}${PAGE}" 2>/dev/null)
      if [ "$STATUS" = "200" ]; then
        echo "  ✅ ${PAGE} → ${STATUS}"
        UI_PASS=$((UI_PASS + 1))
      else
        echo "  ❌ ${PAGE} → ${STATUS}"
      fi
    done

    if [ $UI_PASS -eq $UI_TOTAL ]; then
      add_score "UI Pages" 10 10 "${UI_PASS}/${UI_TOTAL} OK"
    else
      PARTIAL=$((10 * UI_PASS / UI_TOTAL))
      add_score "UI Pages" $PARTIAL 10 "${UI_PASS}/${UI_TOTAL} OK"
    fi
  fi
  echo ""
fi

# Cleanup dev server (single instance for both Step 3 and Step 4)
cleanup_server $DEV_PID

# ─── Step 5: Verify Agent Review (cross만, 50점) ──────
if [ "$MODE" = "cross" ]; then
  echo "=== Step 5: Verify Agent Review (다른 LLM이 코드 리뷰) ==="

  if [ "$CI" = "true" ]; then
    echo "  ⏭️  Skipping Verify Agent in CI (no LLM CLI)"
    add_score "Verify Agent" 30 50 "skipped (CI)"
  else

  # Detect changes: staged + last commit + working tree (not just HEAD~1)
  CHANGED=$({ git diff --cached --name-only 2>/dev/null; git diff --name-only 2>/dev/null; git diff HEAD~1 --name-only 2>/dev/null; } | sort -u | head -20)

  if [ -n "$CHANGED" ]; then
    # 이전 실행의 verdict.json 삭제 — stale fallback 방지
    rm -f "$HOME/.autodev/verdict.json"

    # Run Verify Agent via Node.js script (pass coding agent for dynamic exclusion)
    CODING_AGENT="${CODING_AGENT:-claude-code}"
    AGENT_OUTPUT=$(npx tsx scripts/verify-agent.ts --exclude-agent "$CODING_AGENT" 2>&1 || echo "")

    # Extract JSON result from output
    AGENT_JSON=$(echo "$AGENT_OUTPUT" | grep "VERIFY_AGENT_RESULT=" | sed 's/.*VERIFY_AGENT_RESULT=//')

    if [ -n "$AGENT_JSON" ]; then
      # Node.js JSON 파싱 (python3 의존성 제거)
      AGENT_SCORE=$(json_get "$AGENT_JSON" "score" "")
      AGENT_VERDICT=$(json_get "$AGENT_JSON" "verdict" "unknown")

      if [ -n "$AGENT_SCORE" ] && [ "$AGENT_SCORE" -le 50 ] 2>/dev/null; then
        add_score "Verify Agent" "$AGENT_SCORE" 50 "$AGENT_VERDICT"
        echo "  Score: ${AGENT_SCORE}/50 (${AGENT_VERDICT})"
      else
        add_score "Verify Agent" 25 50 "파싱 실패, 기본 점수"
        echo "  ⚠ 점수 파싱 실패, 기본 25점"
      fi

      # Show issues if any
      echo "$AGENT_OUTPUT" | grep "Issues:" -A 20 | head -15
    else
      # VERIFY_AGENT_RESULT 미발견 — verdict.json 폴백 (process.exit stdout flush 이슈 대비)
      VERDICT_FILE="$HOME/.autodev/verdict.json"
      CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
      if [ -f "$VERDICT_FILE" ]; then
        # commitHash 검증 — 현재 실행에서 생성된 verdict인지 확인
        VF_COMMIT=$(json_get_file "$VERDICT_FILE" "commitHash" "")
        if [ -n "$VF_COMMIT" ] && [ "$VF_COMMIT" != "unknown" ] && [ "$VF_COMMIT" != "$CURRENT_HEAD" ]; then
          add_score "Verify Agent" 20 50 "LLM unavailable (stale verdict)"
          echo "  ⚠ verdict.json commitHash 불일치 — 기계적 체크 기반 점수"
          echo "  Output: $(echo "$AGENT_OUTPUT" | tail -5)"
        else
          VF_SCORE=$(json_get_nested "$VERDICT_FILE" "Math.min(Math.round(d.score*50/100),50)" "0")
          VF_VERDICT=$(json_get_nested "$VERDICT_FILE" "d.verdict==='pass'?'ok':d.verdict==='fail'?'fail':'warn'" "unknown")

          add_score "Verify Agent" "$VF_SCORE" 50 "$VF_VERDICT"
          echo "  Score: ${VF_SCORE}/50 (${VF_VERDICT}) — verdict.json fallback"
          echo "$AGENT_OUTPUT" | grep "Issues:" -A 20 | head -15
        fi
      else
        add_score "Verify Agent" 20 50 "LLM unavailable"
        echo "  ⚠ Verify Agent LLM 응답 없음 — 기계적 체크 기반 점수 (20/50)"
        echo "  Output: $(echo "$AGENT_OUTPUT" | tail -5)"
      fi
    fi
  else
    add_score "Verify Agent" 50 50 "변경 없음"
    echo "  ✅ 변경된 파일 없음 (skip)"
  fi

  fi  # end CI else
  echo ""
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
elif [ $PERCENT -ge 75 ]; then
  GRADE="B"
  LABEL="Acceptable"
elif [ $PERCENT -ge 60 ]; then
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

# ─── Save overall result for hooks (cross-result.json) ─────
if [ "$MODE" = "cross" ]; then
  RESULT_DIR="$HOME/.autodev"
  mkdir -p "$RESULT_DIR"
  COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
  TREE_HASH=$(git write-tree 2>/dev/null || echo "unknown")
  node -e "
const fs = require('fs');
fs.writeFileSync('$RESULT_DIR/cross-result.json', JSON.stringify({
  timestamp: new Date().toISOString(),
  score: $TOTAL_SCORE,
  maxScore: $MAX_SCORE,
  percent: $PERCENT,
  grade: '$GRADE',
  mode: '$MODE',
  commitHash: '$COMMIT_HASH',
  treeHash: '$TREE_HASH',
}, null, 2));
" 2>/dev/null || true
fi
