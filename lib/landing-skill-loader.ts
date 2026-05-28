// ════════════════════════════════════════════
// Load the ui-ux-pro-max + frontend-design skill data into a single
// system-prompt block. Cached per process.
// ════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let cached: string | null = null;

function read(filename: string): string {
  try {
    return readFileSync(join(process.cwd(), 'lib', 'landing-skill-data', filename), 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Build the system-prompt block of design intelligence.
 * Loaded once per process; ~70K tokens — used with Anthropic prompt caching
 * so the cost is only paid on the first request.
 */
export function getSkillContext(): string {
  if (cached) return cached;

  const landing        = read('landing.csv');
  const colors         = read('colors.csv');
  const typography     = read('typography.csv');
  const styles         = read('styles.csv');
  const uxGuidelines   = read('ux-guidelines.csv');
  const frontendDesign = read('frontend-design.md');

  cached = `# Design Intelligence

You have access to TWO complementary design skills:

1. **frontend-design** — creative direction (avoid generic AI aesthetics, be bold)
2. **ui-ux-pro-max** — curated database (patterns, palettes, typography, styles, UX rules)

Use BOTH. The frontend-design principles steer creative direction. The ui-ux-pro-max database gives concrete grounded choices.

## ━━ frontend-design skill ━━━━━━━━━━━━━━━━━━━━
${frontendDesign}

## ━━ ui-ux-pro-max — LANDING PATTERNS (landing.csv) ━
${landing}

## ━━ ui-ux-pro-max — COLOR PALETTES (colors.csv) ━━
${colors}

## ━━ ui-ux-pro-max — FONT PAIRINGS (typography.csv) ━
${typography}

## ━━ ui-ux-pro-max — DESIGN STYLES (styles.csv) ━━━
${styles}

## ━━ ui-ux-pro-max — UX GUIDELINES (ux-guidelines.csv) ━
${uxGuidelines}

# End of design intelligence.
`;
  return cached;
}
