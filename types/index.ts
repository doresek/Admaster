// ════════════════════════════════════════════
// AdMaster Pro — Global Types
// ════════════════════════════════════════════

export type Plan = 'free' | 'starter' | 'pro' | 'agency';

export type CreditAction =
  | 'post'
  | 'analyze'
  | 'variations'
  | 'holiday'
  | 'publish'
  | 'campaign'
  | 'avatar'
  | 'ads_avatar'
  | 'funnel'
  // ── auto-ads.io parity ───────────────────────
  | 'lab'        // The Lab — free remix
  | 'email'      // Email copywriting
  | 'sms'        // SMS copywriting
  | 'series'     // Multi-channel message series (up to 180 days)
  | 'refine'     // Auto-refinement loop based on feedback
  | 'approval'   // Send for client approval (no extra cost; bundled with publish)
  | 'img_edit'   // Image refinement via text prompt
  // ── Phase C ──────────────────────────────────
  | 'analyze_brief'   // analyze a brief and suggest improvements
  | 'analyze_weak'    // analyze a weak/failing ad
  | 'offer_stack'     // Hormozi-style offer stack builder
  | 'img_adapt'       // adapt existing image to different aspect ratio
  | 'master_post'     // marketer-driven post generation (Master Studio)
  | 'lp_variants'     // generate 3 alternative landing-page designs
  | 'recommend'       // AI agent recommendations
  // ── Performance Score (Phase 1) ──────────────
  | 'score'        // predictive performance score on a single copy
  | 'score_boost'; // rewrite + re-score iteration

export const CREDIT_COSTS: Record<CreditAction, number> = {
  post:       3,
  analyze:    5,
  variations: 8,
  holiday:    3,
  publish:    2,
  campaign:   15,
  avatar:     10,
  ads_avatar: 8,
  funnel:     12,
  // ── auto-ads.io parity ───────────────────────
  lab:        0,
  email:      3,
  sms:        2,
  series:    20,
  refine:     4,
  approval:   0,
  img_edit:   3,
  // ── Phase C ──────────────────────────────────
  analyze_brief: 2,
  analyze_weak:  3,
  offer_stack:   6,
  img_adapt:     1,
  master_post:   4,
  lp_variants:   3,
  recommend:     0,
  // ── Performance Score (Phase 1) ──────────────
  score:         1,
  score_boost:   1,
};

export const PLAN_CONFIG = {
  free:    { name: 'חינמי',   credits: 150,  price: 0,   color: '#4A5568' },
  starter: { name: 'Starter', credits: 400,  price: 79,  color: '#2563EB' },
  pro:     { name: 'Pro',     credits: 1200, price: 199, color: '#7C3AED' },
  agency:  { name: 'Agency',  credits: 5000, price: 499, color: '#C49A2A' },
} satisfies Record<Plan, { name: string; credits: number; price: number; color: string }>;

// ── DB Types (mirror Supabase tables) ────────
export interface User {
  id:         string;
  name:       string;
  email:      string;
  credits:    number;
  plan:       Plan;
  brand:      BrandDNA;
  created_at: string;
  updated_at: string;
}

export interface BrandDNA {
  name?:     string;
  tagline?:  string;
  location?: string;
  phone?:    string;
  website?:  string;
  tone?:     string;
  audience?: string;
  usp?:      string;
  pains?:    string;
  products?: string;
}

export interface CreditHistory {
  id:         string;
  user_id:    string;
  action:     CreditAction;
  cost:       number;
  meta:       Record<string, unknown>;
  created_at: string;
}

export interface BriefCode {
  id:          string;
  code:        string;
  user_id:     string;
  agency_name: string | null;
  created_at:  string;
}

export interface BriefValues {
  biz_name?:        string;
  biz_what?:        string;
  biz_result?:      string;
  biz_time?:        string;
  biz_price?:       string;
  biz_usp?:         string;
  cust_who?:        string;
  cust_income?:     string;
  pain_main?:       string;
  pain_internal?:   string;
  desire_dream?:    string;
  obj_main?:        string;
  obj_tried?:       string;
  obj_fear?:        string;
  mkt_awareness?:   string;
  offer_anchor?:    string;
  offer_price?:     string;
  offer_bonuses?:   string;
  offer_guarantee?: string;
  offer_urgency?:   string;
  offer_cta?:       string;
}

export type BriefStatus = 'new' | 'has_avatar' | 'complete';

export interface Brief {
  id:           string;
  code:         string;
  user_id:      string;
  values:       BriefValues;
  avatar:       string | null;
  ads:          string | null;
  funnel:       string | null;
  status:       BriefStatus;
  submitted_at: string;
  updated_at:   string;
}

export interface MetaPage {
  id:           string;
  name:         string;
  fan_count?:   number;
  category?:    string;
  access_token?: string;
}

export interface MetaAdAccount {
  id:           string;
  name:         string;
  currency:     string;
  amount_spent?: string;
  account_status?: number;
}

export interface MetaClient {
  id:                      string;
  user_id:                 string;
  name:                    string;
  industry:                string | null;
  emoji:                   string;
  token:                   string;
  meta_user_id:            string | null;
  meta_user_name:          string | null;
  pages:                   MetaPage[];
  ad_accounts:             MetaAdAccount[];
  selected_page_id:        string | null;
  selected_ad_account_id:  string | null;
  status:                  'connected' | 'error';
  posts_published:         number;
  campaigns_created:       number;
  connected_at:            string;
  updated_at:              string;
}

export interface GeneratedContent {
  id:         string;
  user_id:    string;
  type:       string;
  platform:   string | null;
  input:      Record<string, unknown>;
  output:     Record<string, unknown>;
  created_at: string;
}

// ── API response types ────────────────────────
export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
}

export interface DeductCreditsResult {
  success: boolean;
  credits?: number;
  error?: string;
}

// ── Meta Campaign types ───────────────────────
export type MetaCampaignObjective =
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_SALES'
  | 'OUTCOME_ENGAGEMENT';

export interface CampaignConfig {
  name:        string;
  objective:   MetaCampaignObjective;
  budget:      number;
  budgetType:  'DAILY' | 'LIFETIME';
  ageMin:      number;
  ageMax:      number;
  headline:    string;
  adText:      string;
  cta:         string;
}
