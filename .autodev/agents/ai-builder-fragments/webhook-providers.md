---
fragment: webhook-providers
description: Outbound webhook providers (Slack/Discord/Teams) and inbound webhook trigger
keywords: [slack, discord, teams, 노티, notify, alert, webhook]
---

## Webhook providers

Two distinct concerns:
- `webhook_out` (node) — push a message to Slack/Discord/Teams or any HTTP endpoint
- `webhook_in` (trigger) — receive an inbound HTTP request and run the pipeline

### `webhook_out` (outbound notification)

```yaml
- id: notify
  type: webhook_out
  provider: slack            # slack | discord | teams | generic
  url: "${$env.SLACK_WEBHOOK_URL}"
  body:
    text: "Task ${$task.id} done ✅"
  silentFail: true           # default — webhook errors do not abort the pipeline
  failOnError: false         # set true to abort the pipeline on webhook failure
  rateLimitPerMinute: 60     # provider default if omitted
  when: { field: $nodes.verify.output.data.passed, eq: true }
```

#### Provider body schemas
- **slack** — `{ text, username?, icon_emoji?, attachments? }`
- **discord** — `{ content, username?, embeds? }`
- **teams** — `{ "@type": "MessageCard", "@context", summary, themeColor, sections }`
- **generic** — any JSON, sent as-is

### `webhook_in` (inbound trigger)

```yaml
settings:
  allowedEnvKeys: [CI_WEBHOOK_SECRET]

triggers:
  - type: webhook_in
    path: ci-complete            # endpoint suffix; full URL: /api/hooks/{project}/ci-complete
    method: POST                 # POST (default) | GET
    auth: hmac                   # none | header | hmac | basic
    secret: "${$env.CI_WEBHOOK_SECRET}"
    responseMode: immediate      # immediate (HTTP 202, run in background) | sync (wait, max 30s)
    rateLimitPerMinute: 60
```

#### Auth modes
- `none` — public; never use for sensitive triggers
- `header` — checks `X-Webhook-Secret` header equals `secret`
- `hmac` — verifies `X-Hub-Signature-256` (GitHub-style HMAC-SHA256)
- `basic` — HTTP Basic Authentication

### Anti-patterns
- `auth: none` on a deploy / payment / sensitive trigger — security hole.
- `webhook_out` inside a `loop` over 100+ items — provider rate limit hit. Send one summary after the loop.
