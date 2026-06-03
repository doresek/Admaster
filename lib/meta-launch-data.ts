// Shared loaders for the Meta Ads Launcher routes: resolve the active client's
// token + selected page/ad-account, and load a client-approved ad's content.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDecryptedMetaToken } from '@/lib/meta';

export interface MetaChannel { id: string; name: string }

export interface MetaClientContext {
  token:        string;
  pageId:       string;
  adAccountId:  string;
  clientId:     string;
  pages:        MetaChannel[];
  adAccounts:   MetaChannel[];
}

/**
 * Resolve the token + the page/ad-account to use for an action.
 * Effective page/account = explicit override (validated to belong to the client)
 * → else the client's saved selection → else, if the client has exactly one, that one.
 * If still none, throw a clear error so the caller surfaces it (never guess).
 */
export async function loadMetaClientContext(
  supabase: SupabaseClient,
  clientId: string,
  userId:   string,
  opts: { pageId?: string | null; adAccountId?: string | null } = {},
): Promise<MetaClientContext> {
  const { data: client } = await supabase
    .from('meta_clients')
    .select('selected_page_id, selected_ad_account_id, pages, ad_accounts')
    .eq('id', clientId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!client) throw new Error('הלקוח לא נמצא');

  const pages: MetaChannel[] = (client.pages ?? []).map((p: any) => ({ id: p.id, name: p.name }));
  const adAccounts: MetaChannel[] = (client.ad_accounts ?? []).map((a: any) => ({ id: a.id, name: a.name }));

  const pageId = resolveChannel(opts.pageId, client.selected_page_id, pages,
    'עמוד פייסבוק', 'בחר עמוד פייסבוק להשקה (ל-token יש כמה עמודים)');
  const adAccountId = resolveChannel(opts.adAccountId, client.selected_ad_account_id, adAccounts,
    'חשבון מודעות', 'בחר חשבון מודעות להשקה (ל-token יש כמה חשבונות)');

  const token = await getDecryptedMetaToken(supabase, clientId, userId);
  if (!token) throw new Error('לא נמצא token תקין ללקוח — חבר מחדש את חשבון ה-Meta');

  return { token, pageId, adAccountId, clientId, pages, adAccounts };
}

function resolveChannel(
  override: string | null | undefined,
  selected: string | null,
  list: MetaChannel[],
  what: string,
  chooseMsg: string,
): string {
  if (override) {
    if (!list.some(c => c.id === override)) throw new Error(`ה${what} שנבחר אינו שייך ללקוח הזה`);
    return override;
  }
  if (selected) return selected;
  if (list.length === 1) return list[0].id;
  throw new Error(chooseMsg);
}

export interface ApprovedAd {
  text:     string;
  imageUrl: string | null;
  title:    string | null;
}

export async function loadApprovedAd(
  supabase: SupabaseClient,
  approvalId: string,
  userId:     string,
): Promise<ApprovedAd> {
  const { data } = await supabase
    .from('approvals')
    .select('title, content, status')
    .eq('id', approvalId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) throw new Error('המודעה לא נמצאה');
  if (data.status !== 'approved') throw new Error('ניתן להשיק רק מודעות שאושרו על ידי הלקוח');
  const content = (data.content ?? {}) as { text?: string; image_url?: string };
  return {
    text:     content.text || '',
    imageUrl: content.image_url || null,
    title:    data.title || null,
  };
}
