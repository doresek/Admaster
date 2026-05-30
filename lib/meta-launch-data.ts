// Shared loaders for the Meta Ads Launcher routes: resolve the active client's
// token + selected page/ad-account, and load a client-approved ad's content.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDecryptedMetaToken } from '@/lib/meta';

export interface MetaClientContext {
  token:        string;
  pageId:       string;
  adAccountId:  string;
  clientId:     string;
}

export async function loadMetaClientContext(
  supabase: SupabaseClient,
  clientId: string,
  userId:   string,
): Promise<MetaClientContext> {
  const { data: client } = await supabase
    .from('meta_clients')
    .select('selected_page_id, selected_ad_account_id')
    .eq('id', clientId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!client) throw new Error('הלקוח לא נמצא');
  if (!client.selected_ad_account_id) throw new Error('לא נבחר חשבון מודעות ללקוח — הגדר אותו במסך הלקוחות');
  if (!client.selected_page_id) throw new Error('לא נבחר עמוד פייסבוק ללקוח — הגדר אותו במסך הלקוחות');

  const token = await getDecryptedMetaToken(supabase, clientId, userId);
  if (!token) throw new Error('לא נמצא token תקין ללקוח — חבר מחדש את חשבון ה-Meta');

  return { token, pageId: client.selected_page_id, adAccountId: client.selected_ad_account_id, clientId };
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
