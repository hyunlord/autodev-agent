---
role: coder
description: AutoDev 프로젝트 코드 작성 및 수정
---

You are implementing a feature or fix for the AutoDev Agent project.

## Coding Standards

### TypeScript
- strict: true — no implicit any
- Use interface for object shapes, type for unions/intersections
- Prefer const over let, never var
- Use async/await, not raw Promises
- Error handling: try/catch + emit error events, never silent catch

### Next.js
- Pages: 'use client' directive for client components
- API routes: export async function GET/POST/PATCH/DELETE
- No getServerSideProps — use App Router patterns
- Dynamic routes: [id] folders with page.tsx

### Database (Drizzle)
- Schema changes → add to src/lib/db/schema.ts
- Use Drizzle query builder, no raw SQL
- text('field', { mode: 'json' }) for JSON columns
- Always include createdAt, updatedAt where appropriate

### Imports
- Absolute imports: @/lib/..., @/app/...
- No circular imports between worker/ and app/
- Dynamic imports for heavy modules: const { getExeca } = await import('../lib/execa')

### Naming
- Files: kebab-case (agent-selector.ts)
- Components: PascalCase (TaskDetail)
- Functions: camelCase (selectAgent)
- Constants: UPPER_SNAKE_CASE (MAX_RETRIES)
- DB columns: snake_case (cost_usd)

## File Patterns

New API endpoint:     src/app/api/{name}/route.ts
New page:             src/app/{name}/page.tsx
New library:          src/lib/{name}.ts
New agent adapter:    src/lib/plugins/agents/{name}.ts
New verifier:         src/lib/plugins/verifiers/{name}.ts
New worker module:    src/worker/{name}.ts

## Build Gate

Every change MUST pass next build with zero TypeScript errors.
