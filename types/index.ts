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
  | 'avatar_v2'
  | 'ads_avatar'
  | 'funnel';

export const CREDIT_COSTS: Record<CreditAction, number> = {
  post:       3,
  analyze:    5,
  variations: 8,
  holiday:    3,
  publish:    2,
  campaign:   15,
  avatar:     10,
  avatar_v2:  20,
  ads_avatar: 8,
  funnel:     12,
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
  id:                   string;
  code:                 string;
  user_id:              string;
  values:               BriefValues;
  avatar:               string | null;
  ads:                  string | null;
  funnel:               string | null;
  status:               BriefStatus;
  submitted_at:         string;
  updated_at:           string;
  avatar_v2?:           AvatarV2 | null;
  avatar_v2_meta?:      AvatarV2Meta | null;
  avatar_generated_at?: string | null;
}

// ── Avatar v2 (richer multi-pass output, stored as JSONB) ─────
export type AwarenessLevel =
  | 'unaware'
  | 'problem_aware'
  | 'solution_aware'
  | 'product_aware'
  | 'most_aware';

export interface AvatarV2 {
  name:                        string;
  age:                         string;
  occupation:                  string;
  location:                    string;
  income_range:                string;
  family_status:               string;
  demographics_summary:        string;
  psychographics_summary:      string;
  pains:                       string[];
  desires:                     string[];
  fears:                       string[];
  status_gains:                string[];
  voice_quotes:                string[];
  daily_routine:               string;
  jobs_to_be_done: {
    functional: string;
    emotional:  string;
    social:     string;
    old_hire:   string;
  };
  awareness_level:             AwarenessLevel;
  awareness_strategy:          string;
  market_sophistication_level: 1 | 2 | 3 | 4 | 5;
  recommended_angle:           string;
  objections:                  string[];
  buying_triggers:             string[];
  channels:                    string[];
  recommended_creative_angles: string[];
}

export interface AvatarV2Scores {
  specificity: number;
  voice:       number;
  consistency: number;
  usefulness:  number;
  originality: number;
}

export interface AvatarV2Meta {
  model:                  string;
  language:               'he' | 'en';
  frameworks:             string[];
  research_snippet_count: number;
  draft_tokens?:          number;
  critique_tokens?:       number;
  refine_tokens?:         number;
  refined:                boolean;
  scores:                 AvatarV2Scores | null;
  critique_summary:       string;
  total_time_ms:          number;
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
