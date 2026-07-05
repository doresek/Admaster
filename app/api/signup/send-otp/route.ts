// app/api/signup/send-otp/route.ts
//
//   POST /api/signup/send-otp   { phone, deviceFingerprint? }
//
// Signup anti-abuse: generate a 6-digit OTP, store it HASHED with a short
// expiry, and send it via SMS (InforU; mock by default). Captures the device
// fingerprint (client-sent, hashed here) and the signup IP (SERVER-SIDE, never
// trusted from the client). Enforces one-phone-one-account and durable
// rate-limiting so a phone/user cannot spam OTPs.
//
// Auth: the caller must already be an authenticated (post-auth-signup) user.

import { NextRequest, NextResponse } from 'next/server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkRateLimitDurable } from '@/lib/rate-limit';
import {
  generateOtp,
  hashOtp,
  otpExpiry,
  hashFingerprint,
  normalizePhone,
  sendSms,
  OTP_TTL_MS,
} from '@/lib/anti-abuse';

export const runtime = 'nodejs';

/** Trusted server-side client IP. Prefer x-real-ip, else first x-forwarded-for hop. */
function clientIp(req: NextRequest): string {
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return 'unknown';
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      phone?: string;
      deviceFingerprint?: string;
    };

    const phone = normalizePhone(body.phone);
    if (!phone) {
      return NextResponse.json({ error: 'מספר טלפון לא תקין' }, { status: 400 });
    }

    // ── one-phone-one-account: refuse a phone already verified on another user ──
    const admin = createAdminClient();
    const { data: taken } = await admin
      .from('users')
      .select('id')
      .eq('phone', phone)
      .neq('id', user.id)
      .maybeSingle();
    if (taken) {
      return NextResponse.json(
        { error: 'מספר הטלפון כבר משויך לחשבון אחר' },
        { status: 409 },
      );
    }

    // ── durable rate limits: per phone AND per user, so neither can spam OTPs ──
    const ip = clientIp(req);
    const perPhone = await checkRateLimitDurable(`otp:phone:${phone}`, { max: 5, windowMs: 60 * 60 * 1000 });
    if (!perPhone.ok) {
      return NextResponse.json(
        { error: 'נשלחו יותר מדי קודים למספר זה — נסה שוב מאוחר יותר', retryAfter: perPhone.retryAfter },
        { status: 429, headers: { 'Retry-After': String(perPhone.retryAfter) } },
      );
    }
    const perUser = await checkRateLimitDurable(`otp:user:${user.id}`, { max: 5, windowMs: 10 * 60 * 1000 });
    if (!perUser.ok) {
      return NextResponse.json(
        { error: 'יותר מדי בקשות — נסה שוב בעוד מספר דקות', retryAfter: perUser.retryAfter },
        { status: 429, headers: { 'Retry-After': String(perUser.retryAfter) } },
      );
    }

    // ── generate + store the OTP (hashed) ──────────────────────────────────────
    const otp = generateOtp();
    const nowIso = new Date().toISOString();
    const { error: upsertErr } = await admin
      .from('signup_verifications')
      .upsert(
        {
          user_id: user.id,
          phone,
          device_fingerprint: hashFingerprint(body.deviceFingerprint ?? null),
          signup_ip: ip,
          otp_hash: hashOtp(otp),
          otp_expires_at: otpExpiry(Date.now(), OTP_TTL_MS),
          attempts: 0,
          updated_at: nowIso,
        },
        { onConflict: 'user_id' },
      );
    if (upsertErr) {
      return NextResponse.json({ error: 'לא ניתן ליצור קוד אימות כרגע' }, { status: 500 });
    }

    // ── send the SMS (mock by default; never log the OTP in production) ─────────
    const send = await sendSms({ toPhone: phone, body: `קוד האימות שלך ל-AdMaster: ${otp}` });
    if (!send.ok) {
      return NextResponse.json({ error: 'שליחת הקוד נכשלה', detail: send.error }, { status: 502 });
    }

    const isProd = process.env.NODE_ENV === 'production';
    // In mock/dev ONLY, echo the code so the flow is testable without live SMS.
    const devCode = !isProd && send.mode === 'mock' ? otp : undefined;

    return NextResponse.json({ ok: true, phone, mode: send.mode, ...(devCode ? { devCode } : {}) });
  } catch (err: unknown) {
    console.error('[send-otp]', err);
    return NextResponse.json({ error: 'שגיאה פנימית' }, { status: 500 });
  }
}
