import { loadPrompt } from '@/lib/harness/prompt-loader';
import { estimateTokens } from '../util/estimate-tokens';
import { loadAllFragments } from './fragment-loader';
import { detectFragments } from './keyword-detector';
import { buildTaskSection } from './task-builder';
import { selectExamples, type FewShotExample } from '../few-shot/examples';
import type {
  AIBuilderRequest,
  AssembledContext,
  IntentClassification,
} from '../types';

/**
 * Stage 7 G6 G19-3c — assemble the AI Builder system prompt.
 *
 * 5-section structure (4E §3.1): IDENTITY / TASK / ADPL SPEC / OUTPUT FORMAT
 * / EXAMPLES. Pure function aside from disk reads (base spec + fragments).
 * Token budget enforcement is the orchestrator's job — assembler reports the
 * estimate but never throws or truncates.
 */

const IDENTITY = `You are the AI Builder for AutoDev. You generate, modify, and explain ADPL (AutoDev Pipeline Description Language) v1.0 pipelines from natural-language requests in Korean or English.

Goals:
- Produce minimal, correct YAML that the ADPL compiler accepts on the first try.
- Ask clarifying questions when the request lacks a concrete trigger, action, or target system.
- When modifying, preserve all unrelated structure — change only what the user asks for, and populate the diff field.
- Reference runtime values via context variables ($task, $project, $nodes, $loop, $flow, $env, $trigger).
- Quote ADPL expressions as strings in YAML. No bare interpolation. No JavaScript method calls (use \`contains\` / \`in\` instead). No ternary operators (use a \`branch\` node).`;

const OUTPUT_FORMAT = `Respond with EXACTLY ONE JSON object. No markdown fences. No prose around it.

Schema:
{
  "intent_recognized": "new" | "modify" | "clarify" | "explain",
  "needs_clarification": boolean,
  "clarification_questions": [
    { "question": "...", "options": ["..."], "is_required": true }
  ],
  "generated_yaml": "... full ADPL YAML as a single string ...",
  "diff": {
    "added_nodes": ["id1"],
    "removed_nodes": ["id2"],
    "modified_nodes": ["id3"]
  },
  "explanation": "1–2 sentence summary in the user's language (Korean OK).",
  "warnings": ["env keys that must be set", "compile-time risks", "..."],
  "suggested_next_steps": ["..."]
}

Rules:
- Set "needs_clarification" true ONLY when the request is too vague to produce a working pipeline. In that case, "generated_yaml" must be null and you must list 1–3 questions in "clarification_questions".
- Include "diff" only for "modify" intent.
- Omit "clarification_questions" / "suggested_next_steps" when not applicable.
- Every "id" in YAML must match \`^[a-z0-9][a-z0-9-]{0,63}$\` and be unique pipeline-wide.
- Every \`$nodes.<id>\` reference must point to a node defined earlier in the YAML.`;

function formatExample(ex: FewShotExample): string {
  const userPart = ex.currentYaml
    ? `User: ${ex.userMessage}\n\nCurrent YAML:\n\`\`\`yaml\n${ex.currentYaml.trim()}\n\`\`\``
    : `User: ${ex.userMessage}`;
  return `${userPart}\n\nResponse:\n\`\`\`json\n${JSON.stringify(ex.expectedResponse, null, 2)}\n\`\`\``;
}

export function assembleSystemPrompt(
  req: AIBuilderRequest,
  classification: IntentClassification,
): AssembledContext {
  const fragments = loadAllFragments();
  const matches = detectFragments(req.userMessage, fragments, { maxFragments: 3 });
  const fragmentsUsed = matches.map((m) => m.fragmentName);
  const activeFragments = fragments.filter((f) => fragmentsUsed.includes(f.name));

  const baseSpec = loadPrompt('ai-builder-base-spec').content;
  const fragmentBlock = activeFragments.length
    ? `\n\n## Active Task Fragments\n\n${activeFragments.map((f) => f.body).join('\n\n')}`
    : '';
  const adplSpec = baseSpec + fragmentBlock;

  const taskSection = buildTaskSection(req, classification);
  const examples = selectExamples(classification.intent, fragmentsUsed);
  const examplesSection = examples.map(formatExample).join('\n\n---\n\n');

  const systemPrompt = [
    `## IDENTITY\n\n${IDENTITY}`,
    `## TASK\n\n${taskSection}`,
    `## ADPL SPEC\n\n${adplSpec}`,
    `## OUTPUT FORMAT\n\n${OUTPUT_FORMAT}`,
    `## EXAMPLES\n\n${examplesSection}`,
  ].join('\n\n');

  return {
    systemPrompt,
    userMessage: req.userMessage,
    conversationHistory: req.conversationHistory ?? [],
    fragmentsUsed,
    estimatedSystemTokens: estimateTokens(systemPrompt),
  };
}
