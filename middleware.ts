import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieSetting = { name: string; value: string; options?: CookieOptions };

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet: CookieSetting[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { pathname } = request.nextUrl;

  // API routes handle their own auth (return 401 JSON). Skip middleware
  // redirects so non-browser clients don't get HTML 307s.
  if (pathname.startsWith('/api/')) {
    return supabaseResponse;
  }

  const { data: { user } } = await supabase.auth.getUser();

  // Public routes (no auth needed). NOTE: '/' is the dashboard (auth required).
  // The marketing homepage lives at '/welcome'.
  //
  // Auth-flow routes MUST be public: a user confirming their email or resetting
  // their password has NO session yet when they land on /auth/callback (it is the
  // request that establishes the session). If middleware bounced them to /welcome,
  // the `?code=` would be dropped and email-confirmation / password-recovery would
  // silently break. /forgot-password and /reset-password must also be reachable
  // while logged out so the "expired link, request a new one" path can render a
  // message instead of a silent redirect.
  // '/optout' is the end-customer one-click unsubscribe (CP-6b T6) — must be
  // reachable with zero session, like '/approve'.
  const publicRoutes = ['/login', '/register', '/forgot-password', '/reset-password', '/auth', '/brief', '/approve', '/optout', '/lp', '/welcome', '/features', '/pricing', '/how-it-works', '/faq', '/contact', '/blog'];
  const isPublic = publicRoutes.some(r => pathname === r || pathname.startsWith(`${r}/`));

  // Redirect unauthenticated users to the marketing homepage (root '/' is the dashboard)
  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/welcome', request.url));
  }

  // Redirect authenticated users away from auth/marketing pages to the dashboard
  if (user && (pathname === '/login' || pathname === '/register' || pathname === '/welcome')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
