// ════════════════════════════════════════════
// AdMaster Pro — Landing Page Design Spec (v2)
// AI WRITES the design (custom colors, fonts, variants).
// No fixed palettes — every page is unique.
// ════════════════════════════════════════════

export type HeroVariant =
  | 'centered'        // big centered hero, max emotional impact
  | 'split'           // 50/50 text + visual
  | 'magazine'        // editorial — off-center, oversized type
  | 'dramatic'        // full-bleed with overlay text
  | 'minimal'         // sparse, lots of whitespace
  | 'gradient_blob'   // hero with animated gradient blobs
  | 'cinematic';      // full-bleed photo background with overlay (luxury lifestyle)

export type CardStyle =
  | 'flat'
  | 'soft'        // shadow without border
  | 'glass'       // frosted glass effect
  | 'bordered'    // strong border
  | 'gradient'    // gradient border
  | 'lifted';     // 3D lift effect

export type FontPair =
  | 'serif_modern'       // DM Serif Display + Inter
  | 'editorial'          // Playfair Display + Lora
  | 'tech_minimal'       // Space Grotesk + Inter
  | 'humanist'           // Frank Ruhl Libre + Heebo
  | 'bold_sans'          // Rubik + Assistant
  | 'classic_serif'      // Cardo + Heebo
  | 'modern_geometric'   // Outfit + Heebo
  | 'luxury'             // Cormorant + Assistant
  | 'playful';           // Fraunces + Heebo

// ─── DESIGN SPEC ───────────────────────────────
// This is what the AI returns + what the renderer consumes.
export interface DesignSpec {
  /** Hero variant — drives the first-fold layout */
  hero:          HeroVariant;
  /** Card visual style for bullets/testimonials/etc */
  card:          CardStyle;
  /** Typography pair (display + body fonts) */
  fonts:         FontPair;

  /** ─── Custom colors (hex) — AI-selected per brief ─── */
  primary:       string;   // CTAs, accents
  secondary:     string;   // gradients with primary
  accent:        string;   // sparkles, highlights
  bg:            string;   // page background
  bgAlt:         string;   // section alternate / soft variant
  surface:       string;   // cards
  text:          string;   // main text
  textMuted:     string;   // secondary text
  border:        string;   // borders

  /** Visual mood density: 'dense' | 'airy' | 'medium' */
  density:       'dense' | 'airy' | 'medium';
  /** Whether this is overall dark or light theme */
  isDark:        boolean;
  /** Hero background style — affects gradient + decorations */
  heroBg:        'mesh' | 'orbs' | 'grid' | 'noise' | 'solid' | 'duotone';
  /** Border radius scale */
  radius:        'sharp' | 'soft' | 'pillowy';
  /** Optional pre-hero eyebrow label (e.g. "החל מ-1,997 ₪") */
  eyebrow?:      string;
  /** Optional emoji/icon character for hero decoration */
  hero_emoji?:   string;
}

// ─── FONT PAIR DEFINITIONS ─────────────────────
export const FONT_PAIRS: Record<FontPair, { display: string; body: string; googleFontsHref: string }> = {
  serif_modern: {
    display: "'DM Serif Display', Georgia, serif",
    body:    "'Inter', 'Noto Sans Hebrew', system-ui, sans-serif",
    googleFontsHref: 'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:wght@300;400;500;600;700;800&family=Noto+Sans+Hebrew:wght@300;400;500;600;700;800&display=swap',
  },
  editorial: {
    display: "'Playfair Display', 'David Libre', Georgia, serif",
    body:    "'Lora', 'Noto Sans Hebrew', system-ui, sans-serif",
    googleFontsHref: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Lora:wght@400;500;600&family=Noto+Sans+Hebrew:wght@400;500;600&family=David+Libre:wght@400;500;700&display=swap',
  },
  tech_minimal: {
    display: "'Space Grotesk', 'Heebo', system-ui, sans-serif",
    body:    "'Inter', 'Heebo', system-ui, sans-serif",
    googleFontsHref: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=Heebo:wght@300;400;500;700;800&display=swap',
  },
  humanist: {
    display: "'Frank Ruhl Libre', 'Cardo', serif",
    body:    "'Heebo', 'Assistant', system-ui, sans-serif",
    googleFontsHref: 'https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;500;700;900&family=Heebo:wght@300;400;500;600;700&family=Cardo:wght@400;700&display=swap',
  },
  bold_sans: {
    display: "'Rubik', 'Heebo', system-ui, sans-serif",
    body:    "'Assistant', 'Heebo', system-ui, sans-serif",
    googleFontsHref: 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700;800;900&family=Assistant:wght@300;400;500;600;700&family=Heebo:wght@400;500;700&display=swap',
  },
  classic_serif: {
    display: "'Cardo', 'Frank Ruhl Libre', Georgia, serif",
    body:    "'Heebo', 'Assistant', system-ui, sans-serif",
    googleFontsHref: 'https://fonts.googleapis.com/css2?family=Cardo:wght@400;700&family=Heebo:wght@300;400;500;700&family=Frank+Ruhl+Libre:wght@400;700&display=swap',
  },
  modern_geometric: {
    display: "'Outfit', 'Heebo', system-ui, sans-serif",
    body:    "'Heebo', 'Assistant', system-ui, sans-serif",
    googleFontsHref: 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Heebo:wght@300;400;500;700&family=Assistant:wght@400;500;600&display=swap',
  },
  luxury: {
    display: "'Cormorant Garamond', 'Frank Ruhl Libre', serif",
    body:    "'Assistant', 'Heebo', system-ui, sans-serif",
    googleFontsHref: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Assistant:wght@300;400;500;600&family=Frank+Ruhl+Libre:wght@400;500;700&display=swap',
  },
  playful: {
    display: "'Fraunces', 'Frank Ruhl Libre', serif",
    body:    "'Heebo', 'Assistant', system-ui, sans-serif",
    googleFontsHref: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,600;9..144,700;9..144,900&family=Heebo:wght@300;400;500;700&family=Assistant:wght@400;500;600&display=swap',
  },
};

// ─── DEFAULTS / FALLBACK ───────────────────────
export const DEFAULT_DESIGN: DesignSpec = {
  hero:      'centered',
  card:      'soft',
  fonts:     'serif_modern',
  primary:   '#0A7AFF',
  secondary: '#6D28D9',
  accent:    '#D4AF55',
  bg:        '#070918',
  bgAlt:     '#0E1230',
  surface:   '#11163A',
  text:      '#E5EDFF',
  textMuted: '#94A3D9',
  border:    '#22305F',
  density:   'medium',
  isDark:    true,
  heroBg:    'mesh',
  radius:    'soft',
};

// ─── Radius scale ──────────────────────────────
export function radiusFor(spec: DesignSpec): { card: string; button: string; pill: string } {
  if (spec.radius === 'sharp')   return { card: '0',     button: '0.25rem', pill: '0.5rem' };
  if (spec.radius === 'pillowy') return { card: '1.5rem',button: '9999px',  pill: '9999px' };
  return { card: '1rem', button: '0.75rem', pill: '9999px' };
}

// ─── Density scale ─────────────────────────────
export function densityFor(spec: DesignSpec): { section: string; cardPad: string; gap: string } {
  if (spec.density === 'dense') return { section: 'py-12 sm:py-16', cardPad: 'p-4',  gap: 'gap-3' };
  if (spec.density === 'airy')  return { section: 'py-24 sm:py-32', cardPad: 'p-8',  gap: 'gap-6' };
  return                             { section: 'py-16 sm:py-24', cardPad: 'p-6',  gap: 'gap-4' };
}

// ─── Coerce / validate AI output ───────────────
export function coerceDesignSpec(raw: any): DesignSpec {
  if (!raw || typeof raw !== 'object') return DEFAULT_DESIGN;
  const valid = <T extends string>(v: any, list: T[], dflt: T): T =>
    (typeof v === 'string' && list.includes(v as T)) ? v as T : dflt;
  const hex = (v: any, dflt: string): string =>
    (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim())) ? v.trim() : dflt;

  return {
    hero:      valid<HeroVariant>(raw.hero,    ['centered','split','magazine','dramatic','minimal','gradient_blob','cinematic'], 'centered'),
    card:      valid<CardStyle>  (raw.card,    ['flat','soft','glass','bordered','gradient','lifted'],              'soft'),
    fonts:     valid<FontPair>   (raw.fonts,   Object.keys(FONT_PAIRS) as FontPair[],                                'serif_modern'),
    primary:   hex(raw.primary,   DEFAULT_DESIGN.primary),
    secondary: hex(raw.secondary, DEFAULT_DESIGN.secondary),
    accent:    hex(raw.accent,    DEFAULT_DESIGN.accent),
    bg:        hex(raw.bg,        DEFAULT_DESIGN.bg),
    bgAlt:     hex(raw.bgAlt,     DEFAULT_DESIGN.bgAlt),
    surface:   hex(raw.surface,   DEFAULT_DESIGN.surface),
    text:      hex(raw.text,      DEFAULT_DESIGN.text),
    textMuted: hex(raw.textMuted, DEFAULT_DESIGN.textMuted),
    border:    hex(raw.border,    DEFAULT_DESIGN.border),
    density:   valid<'dense'|'airy'|'medium'>(raw.density, ['dense','airy','medium'], 'medium'),
    isDark:    typeof raw.isDark === 'boolean' ? raw.isDark : true,
    heroBg:    valid<'mesh'|'orbs'|'grid'|'noise'|'solid'|'duotone'>(raw.heroBg, ['mesh','orbs','grid','noise','solid','duotone'], 'mesh'),
    radius:    valid<'sharp'|'soft'|'pillowy'>(raw.radius, ['sharp','soft','pillowy'], 'soft'),
    eyebrow:   typeof raw.eyebrow === 'string' ? raw.eyebrow.slice(0, 80) : undefined,
    hero_emoji: typeof raw.hero_emoji === 'string' ? raw.hero_emoji.slice(0, 8) : undefined,
  };
}
