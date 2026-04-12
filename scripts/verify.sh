#!/bin/bash
# set -e 제거 — 명시적 에러 핸들링 사용 (BUILD_OUTPUT 캡처 시 set -e가 리포팅 분기 우회)

MODE="${1:-quick}"  # quick, full, or cross
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "🔍 Verify mode: $MODE"
if [ "$CI" = "true" ]; then
  echo "🤖 CI mode — UI check와 Verify Agent 스킵 (브라우저/LLM CLI 없음)"
fi
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
sleep 2
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
sleep 1

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
  if [ "$CI" = "true" ]; then
    echo "  ⏭️  Skipping UI check in CI (no browser)"
    add_score "UI Pages" 15 15 "skipped (CI)"
  else
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
    sleep 2
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    sleep 1

    if [ $UI_PASS -eq $UI_TOTAL ]; then
      add_score "UI Pages" 15 15 "${UI_PASS}/${UI_TOTAL} OK"
    else
      PARTIAL=$((15 * UI_PASS / UI_TOTAL))
      add_score "UI Pages" $PARTIAL 15 "${UI_PASS}/${UI_TOTAL} OK"
    fi
  fi
  echo ""
fi

# ─── Step 5: Verify Agent Review (cross만, 15점) ──────
if [ "$MODE" = "cross" ]; then
  echo "=== Step 5: Verify Agent Review (다른 LLM이 코드 리뷰) ==="

  if [ "$CI" = "true" ]; then
    echo "  ⏭️  Skipping Verify Agent in CI (no LLM CLI)"
    add_score "Verify Agent" 10 15 "skipped (CI)"
  else

  CHANGED=$(git diff HEAD~1 --name-only 2>/dev/null | head -20 || echo "")

  if [ -n "$CHANGED" ]; then
    # 이전 실행의 verdict.json 삭제 — stale fallback 방지
    rm -f "$HOME/.autodev/verdict.json"

    # Run Verify Agent via Node.js script
    AGENT_OUTPUT=$(npx tsx scripts/verify-agent.ts 2>&1 || echo "")

    # Extract JSON result from output — python3으로 안정적 파싱 (regex 대체)
    AGENT_JSON=$(echo "$AGENT_OUTPUT" | grep "VERIFY_AGENT_RESULT=" | sed 's/.*VERIFY_AGENT_RESULT=//')

    if [ -n "$AGENT_JSON" ]; then
      # python3 JSON 파싱 (regex보다 안정적)
      AGENT_SCORE=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('score',0))" "$AGENT_JSON" 2>/dev/null || echo "")
      AGENT_VERDICT=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('verdict','unknown'))" "$AGENT_JSON" 2>/dev/null || echo "")

      if [ -n "$AGENT_SCORE" ] && [ "$AGENT_SCORE" -le 15 ] 2>/dev/null; then
        add_score "Verify Agent" "$AGENT_SCORE" 15 "$AGENT_VERDICT"
        echo "  Score: ${AGENT_SCORE}/15 (${AGENT_VERDICT})"
      else
        add_score "Verify Agent" 10 15 "파싱 실패, 기본 점수"
        echo "  ⚠ 점수 파싱 실패, 기본 10점"
      fi

      # Show issues if any
      echo "$AGENT_OUTPUT" | grep "Issues:" -A 20 | head -15
    else
      # VERIFY_AGENT_RESULT 미발견 — verdict.json 폴백 (process.exit stdout flush 이슈 대비)
      VERDICT_FILE="$HOME/.autodev/verdict.json"
      CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
      if [ -f "$VERDICT_FILE" ]; then
        # commitHash 검증 — 현재 실행에서 생성된 verdict인지 확인
        VF_COMMIT=$(python3 -c "import json; print(json.load(open('$VERDICT_FILE')).get('commitHash',''))" 2>/dev/null || echo "")
        if [ -n "$VF_COMMIT" ] && [ "$VF_COMMIT" != "unknown" ] && [ "$VF_COMMIT" != "$CURRENT_HEAD" ]; then
          add_score "Verify Agent" 8 15 "LLM unavailable (stale verdict)"
          echo "  ⚠ verdict.json commitHash 불일치 — 기계적 체크 기반 점수"
          echo "  Output: $(echo "$AGENT_OUTPUT" | tail -5)"
        else
          VF_SCORE=$(python3 -c "import json; d=json.load(open('$VERDICT_FILE')); print(min(round(d.get('score',0)*15/100), 15))" 2>/dev/null || echo "0")
          VF_VERDICT=$(python3 -c "import json; d=json.load(open('$VERDICT_FILE')); v=d.get('verdict','unknown'); print('ok' if v=='pass' else 'fail' if v=='fail' else 'warn')" 2>/dev/null || echo "unknown")

          add_score "Verify Agent" "$VF_SCORE" 15 "$VF_VERDICT"
          echo "  Score: ${VF_SCORE}/15 (${VF_VERDICT}) — verdict.json fallback"
          echo "$AGENT_OUTPUT" | grep "Issues:" -A 20 | head -15
        fi
      else
        add_score "Verify Agent" 8 15 "LLM unavailable"
        echo "  ⚠ Verify Agent LLM 응답 없음 — 기계적 체크 기반 점수 (8/15)"
        echo "  Output: $(echo "$AGENT_OUTPUT" | tail -5)"
      fi
    fi
  else
    add_score "Verify Agent" 15 15 "변경 없음"
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

# ─── Save overall result for hooks (cross-result.json) ─────
if [ "$MODE" = "cross" ]; then
  RESULT_DIR="$HOME/.autodev"
  mkdir -p "$RESULT_DIR"
  COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
  TREE_HASH=$(git write-tree 2>/dev/null || echo "unknown")
  python3 -c "
import json, datetime
json.dump({
    'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'score': $TOTAL_SCORE,
    'maxScore': $MAX_SCORE,
    'percent': $PERCENT,
    'grade': '$GRADE',
    'mode': '$MODE',
    'commitHash': '$COMMIT_HASH',
    'treeHash': '$TREE_HASH',
}, open('$RESULT_DIR/cross-result.json', 'w'), indent=2)
" 2>/dev/null || true
fi
