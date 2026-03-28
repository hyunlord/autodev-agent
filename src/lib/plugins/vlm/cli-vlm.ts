import { resolveCli } from '../../cli-resolver';

export interface CLIVLMResult {
  pass: boolean;
  confidence: number;
  reasoning: string;
}

export async function verifyScreenshotViaCli(
  screenshotPath: string,
  prompt: string,
  agentCli: string = 'claude',
): Promise<CLIVLMResult> {
  // Resize screenshot to reduce token cost
  const sharp = (await import('sharp')).default;
  await sharp(screenshotPath)
    .resize(1280, 720, { fit: 'inside' })
    .png()
    .toFile(screenshotPath + '.resized.png');

  // Build the verification prompt — ask CLI to read the image file
  const vlmPrompt = `Read the image file at ${screenshotPath}.resized.png and analyze it visually.

Verification criteria: "${prompt}"

Determine if the criteria is met based on what you see in the screenshot.

Respond with ONLY a JSON object (no markdown, no explanation):
{"pass": true/false, "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

  const cliPath = await resolveCli(agentCli);
  if (!cliPath) {
    return {
      pass: false,
      confidence: 0,
      reasoning: `CLI '${agentCli}' not found on this system`,
    };
  }

  try {
    const { execa } = await import('execa');
    const result = await execa(cliPath, [
      '-p', vlmPrompt,
      '--output-format', 'text',
      '--max-turns', '2',
      '--dangerously-skip-permissions',
    ], {
      timeout: 60_000,
      reject: false,
      env: { ...process.env },
    });

    const cleaned = result.stdout.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      return {
        pass: Boolean(parsed.pass),
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        reasoning: String(parsed.reasoning ?? 'No reasoning provided'),
      };
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          pass: Boolean(parsed.pass),
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
          reasoning: String(parsed.reasoning ?? ''),
        };
      }
      return {
        pass: false,
        confidence: 0,
        reasoning: `VLM returned non-JSON: ${cleaned.slice(0, 300)}`,
      };
    }
  } catch (e) {
    return {
      pass: false,
      confidence: 0,
      reasoning: `VLM CLI call failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
