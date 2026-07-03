// app/api/signup/verify-otp/route.ts
//
//   POST /api/signup/verify-otp   { code }
//
// Verify the OTP issued by /api/signup/send-otp. On success: stamp
// phone_verified_at and copy the verified phone onto users.phone (which is
// DB-unique — one phone, one account). Attempt cap + expiry are enforced by
// lib/anti-abuse/verifyOtp; each wrong guess increments attempts.

import { NextRequest, NextResponse } from 'next/server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkRateLimitDurable } from '@/lib/rate-limit';
import { verifyOtp } from '@/lib/anti-abuse';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { code?: string };
    const code = (body.code ?? '').replace(/\D/g, '');
    if (code.length < 4) {
      return NextResponse.json({ error: 'קוד לא תקין' }, { status: 400 });
    }

    // Durable rate limit on verification attempts (defense in depth on top of
    // the per-record attempt cap) so the endpoint itself can't be hammered.
    const rl = await checkRateLimitDurable(`otp:verify:${user.id}`, { max: 15, windowMs: 10 * 60 * 1000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'יותר מדי ניסיונות — נסה שוב מאוחר יותר', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      );
    }

    const admin = createAdminClient();
    const { data: rec, error: readErr } = await admin
      .from('signup_verifications')
      .select('phone, otp_hash, otp_expires_at, attempts')
      .eq('user_id', user.id)
      .maybeSingle();
    if (readErr || !rec) {
      return NextResponse.json({ error: 'לא נמצאה בקשת אימות — שלח קוד מחדש' }, { status: 404 });
    }
    const record = rec as { phone: string | null; otp_hash: string | null; otp_expires_at: string | null; attempts: number };

    const outcome = verifyOtp(record, code);
    if (!outcome.ok) {
      // Count the failed attempt (except when already locked out — nothing to add).
      if (outcome.reason !== 'too_many_attempts') {
        await admin
          .from('signup_verifications')
          .update({ attempts: record.attempts + 1, updated_at: new Date().toISOString() })
          .eq('user_id', user.id);
      }
      const messages: Record<string, string> = {
        no_otp: 'לא נמצא קוד פעיל — שלח קוד מחדש',
        expired: 'הקוד פג תוקף — שלח קוד מחדש',
        too_many_attempts: 'יותר מדי ניסיונות שגויים — שלח קוד מחדש',
        mismatch: 'קוד שגוי',
      };
      return NextResponse.json({ error: messages[outcome.reason] ?? 'אימות נכשל', reason: outcome.reason }, { status: 400 });
    }

    // ── success: write phone onto users (unique) + stamp verified ───────────────
    const verifiedAt = new Date().toISOString();
    const { error: userErr } = await admin
      .from('users')
      .update({ phone: record.phone, updated_at: verifiedAt })
      .eq('id', user.id);
    if (userErr) {
      // Unique-violation race: the phone was verified on another account first.
      const code23505 = (userErr as { code?: string }).code === '23505';
      if (code23505 || /duplicate key|unique/i.test(userErr.message)) {
        return NextResponse.json({ error: 'מספר הטלפון כבר משויך לחשבון אחר' }, { status: 409 });
      }
      return NextResponse.json({ error: 'שמירת האימות נכשלה' }, { status: 500 });
    }

    // Clear the OTP (single-use) and stamp verification on the record.
    await admin
      .from('signup_verifications')
      .update({ phone_verified_at: verifiedAt, otp_hash: null, otp_expires_at: null, updated_at: verifiedAt })
      .eq('user_id', user.id);

    return NextResponse.json({ ok: true, phone: record.phone, phoneVerifiedAt: verifiedAt });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
