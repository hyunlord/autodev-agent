---
fragment: schedule-trigger
description: Schedule trigger — cron / interval / once with timezone and overlap policy
keywords: [매일, 매시간, cron, 주간, 월간, hourly, daily, weekly]
---

## Schedule trigger

Run the pipeline on a cron expression, fixed interval, or one-shot timestamp.

```yaml
triggers:
  # cron — 5-field expression
  - type: schedule
    mode: cron               # cron | interval | once
    cron: "0 9 * * 1-5"      # weekdays 9am
    timezone: "Asia/Seoul"   # IANA timezone, default UTC
    overlap: skip            # skip (default) | queue | concurrent
    validFrom: "2026-01-01T00:00:00Z"   # optional schedule start
    validUntil: "2026-12-31T23:59:59Z"  # optional schedule end
    maxRuns: 100                        # optional invocation cap

  # interval — every N seconds
  - type: schedule
    mode: interval
    interval: 3600
    overlap: skip

  # once — single run at an ISO timestamp
  - type: schedule
    mode: once
    at: "2026-12-31T00:00:00+09:00"
    timezone: "Asia/Seoul"
```

### Key fields
- `mode` (required): `cron` | `interval` | `once`
- `cron`: 5-field crontab (`minute hour day month dayOfWeek`), required when `mode: cron`
- `interval`: integer seconds, required when `mode: interval`
- `at`: ISO 8601 timestamp, required when `mode: once`
- `timezone`: IANA name (default `UTC`)
- `overlap`: `skip` (default — drop the new run while the previous is active), `queue` (run after), `concurrent` (start anyway)
- `validFrom` / `validUntil`: optional active window
- `maxRuns`: optional cap on total invocations

### `$trigger` payload
- `$trigger.scheduledAt` — the ISO 8601 instant the schedule was meant to fire (may differ slightly from `firedAt`)

### Anti-pattern
A 1-minute cron + `overlap: queue` + a pipeline that takes longer than 60s grows the queue without bound. Prefer `overlap: skip` or a longer cron interval.
