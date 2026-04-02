#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "🧪 E2E Test — 실제 작업 실행 검증"
echo ""

# ─── Step 1: 서버 시작 ──────────────────────────
echo "=== Step 1: Starting dev server ==="
pnpm dev > /dev/null 2>&1 &
DEV_PID=$!
sleep 8

# Health check
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/status" 2>/dev/null || echo "000")
if [ "$STATUS" != "200" ]; then
  echo "❌ Dev server failed to start"
  kill $DEV_PID 2>/dev/null
  exit 1
fi
echo "✅ Dev server running (PID: $DEV_PID)"
echo ""

# ─── Step 2: 작업 생성 (카운터 만들어줘) ─────────
echo "=== Step 2: Creating test task ==="
TASK_RESPONSE=$(curl -s -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "간단한 카운터를 만들어줘. index.html 하나에 HTML/CSS/JS를 모두 넣어. 증가, 감소, 리셋 버튼이 있어야 해.",
    "planningMode": "claude-cli",
    "agentId": "auto",
    "autoApprove": true,
    "executionMode": "single"
  }')

TASK_ID=$(echo "$TASK_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
WORKSPACE=$(echo "$TASK_RESPONSE" | grep -o '"projectDir":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$TASK_ID" ]; then
  echo "❌ Failed to create task"
  echo "Response: $TASK_RESPONSE"
  kill $DEV_PID 2>/dev/null
  exit 1
fi

echo "✅ Task created: $TASK_ID"
echo "   Workspace: $WORKSPACE"
echo ""

# ─── Step 3: 완료 대기 (최대 5분) ────────────────
echo "=== Step 3: Waiting for task to complete (max 5 min) ==="
MAX_WAIT=300
WAITED=0
POLL_INTERVAL=5

while [ $WAITED -lt $MAX_WAIT ]; do
  TASK_STATUS=$(curl -s "http://localhost:3000/api/tasks/${TASK_ID}" 2>/dev/null)
  STATUS=$(echo "$TASK_STATUS" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ "$STATUS" = "completed" ]; then
    echo "✅ Task completed! (${WAITED}s)"
    break
  elif [ "$STATUS" = "failed" ] || [ "$STATUS" = "escalated" ]; then
    echo "❌ Task failed: $STATUS (${WAITED}s)"
    RESULT=$(echo "$TASK_STATUS" | grep -o '"summary":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "   Summary: $RESULT"
    kill $DEV_PID 2>/dev/null
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    exit 1
  elif [ "$STATUS" = "plan_review" ]; then
    echo "   ⏳ Waiting for plan approval... (auto-approve: true)"
  else
    echo "   ⏳ Status: $STATUS (${WAITED}s)"
  fi

  sleep $POLL_INTERVAL
  WAITED=$((WAITED + POLL_INTERVAL))
done

if [ $WAITED -ge $MAX_WAIT ]; then
  echo "❌ Task timed out after ${MAX_WAIT}s"
  kill $DEV_PID 2>/dev/null
  lsof -ti:3000 | xargs kill -9 2>/dev/null || true
  exit 1
fi
echo ""

# ─── Step 4: 결과 파일 검증 ──────────────────────
echo "=== Step 4: Verifying results ==="
E2E_SCORE=0
E2E_MAX=100

# Check 1: index.html exists (20점)
if [ -n "$WORKSPACE" ] && [ -f "${WORKSPACE}/index.html" ]; then
  echo "  ✅ index.html exists"
  E2E_SCORE=$((E2E_SCORE + 20))
else
  echo "  ❌ index.html not found in workspace"
  if [ -n "$WORKSPACE" ]; then
    echo "  Files in workspace:"
    ls -la "$WORKSPACE" 2>/dev/null || echo "  (workspace not accessible)"
  fi
fi

# Check 2: counter logic (15점)
if [ -n "$WORKSPACE" ] && [ -f "${WORKSPACE}/index.html" ]; then
  if grep -qi "count" "${WORKSPACE}/index.html" 2>/dev/null; then
    echo "  ✅ index.html contains counter logic"
    E2E_SCORE=$((E2E_SCORE + 15))
  else
    echo "  ❌ index.html missing counter logic"
  fi
else
  echo "  ❌ Cannot check content (file missing)"
fi

# Check 3: buttons (15점)
if [ -n "$WORKSPACE" ] && [ -f "${WORKSPACE}/index.html" ]; then
  if grep -qi "button" "${WORKSPACE}/index.html" 2>/dev/null; then
    echo "  ✅ index.html contains buttons"
    E2E_SCORE=$((E2E_SCORE + 15))
  else
    echo "  ❌ index.html missing buttons"
  fi
else
  echo "  ❌ Cannot check buttons (file missing)"
fi

# Check 4: verification checks passed (25점)
TASK_DETAIL=$(curl -s "http://localhost:3000/api/tasks/${TASK_ID}" 2>/dev/null)
VERIFY_PASS=$(echo "$TASK_DETAIL" | grep -o '"status":"pass"' | wc -l)
VERIFY_FAIL=$(echo "$TASK_DETAIL" | grep -o '"status":"fail"' | wc -l)

if [ "$VERIFY_FAIL" -eq 0 ] && [ "$VERIFY_PASS" -gt 0 ]; then
  echo "  ✅ All verification checks passed ($VERIFY_PASS checks)"
  E2E_SCORE=$((E2E_SCORE + 25))
else
  echo "  ❌ Verification: $VERIFY_PASS passed, $VERIFY_FAIL failed"
fi

# Check 5: cost tracked (10점)
COST=$(echo "$TASK_DETAIL" | grep -o '"costUsd":[0-9.]*' | head -1 | cut -d: -f2)
if [ -n "$COST" ] && [ "$COST" != "0" ] && [ "$COST" != "null" ]; then
  echo "  ✅ Cost tracked: \$$COST"
  E2E_SCORE=$((E2E_SCORE + 10))
else
  echo "  ❌ Cost not tracked"
fi

# Check 6: valid HTML (15점)
if [ -n "$WORKSPACE" ] && [ -f "${WORKSPACE}/index.html" ]; then
  if grep -q "<!DOCTYPE html>" "${WORKSPACE}/index.html" 2>/dev/null; then
    FILE_SIZE=$(wc -c < "${WORKSPACE}/index.html")
    if [ "$FILE_SIZE" -gt 100 ]; then
      echo "  ✅ Valid HTML file (${FILE_SIZE} bytes)"
      E2E_SCORE=$((E2E_SCORE + 15))
    else
      echo "  ❌ HTML file too small (${FILE_SIZE} bytes)"
    fi
  else
    echo "  ❌ Missing DOCTYPE declaration"
  fi
else
  echo "  ❌ Cannot validate HTML (file missing)"
fi

echo ""

# ─── Cleanup ─────────────────────────────────────
echo "=== Cleanup ==="
kill $DEV_PID 2>/dev/null
sleep 1
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
echo "✅ Dev server stopped"
echo ""

# ─── Score Summary ───────────────────────────────
E2E_PERCENT=$((E2E_SCORE * 100 / E2E_MAX))

if [ $E2E_PERCENT -ge 90 ]; then
  E2E_GRADE="A"
  E2E_LABEL="Ship it"
elif [ $E2E_PERCENT -ge 70 ]; then
  E2E_GRADE="B"
  E2E_LABEL="Acceptable"
elif [ $E2E_PERCENT -ge 50 ]; then
  E2E_GRADE="C"
  E2E_LABEL="Needs work"
else
  E2E_GRADE="F"
  E2E_LABEL="Reject"
fi

echo "┌────────────────────────┬───────┬──────────────────────┐"
echo "│         항목           │ 점수  │        상태          │"
echo "├────────────────────────┼───────┼──────────────────────┤"
echo "│ File exists            │  /20  │                      │"
echo "│ Counter logic          │  /15  │                      │"
echo "│ Buttons                │  /15  │                      │"
echo "│ Verification passed    │  /25  │                      │"
echo "│ Cost tracked           │  /10  │                      │"
echo "│ Valid HTML             │  /15  │                      │"
echo "├────────────────────────┼───────┼──────────────────────┤"
printf "│ TOTAL                  │%3d/%-3d│ %s (%s) %d%%\n" $E2E_SCORE $E2E_MAX "$E2E_GRADE" "$E2E_LABEL" $E2E_PERCENT
echo "└────────────────────────┴───────┴──────────────────────┘"

if [ "$E2E_GRADE" = "F" ]; then
  exit 1
fi
