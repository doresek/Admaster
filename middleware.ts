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
  const publicRoutes = ['/login', '/register', '/brief', '/approve', '/lp', '/welcome', '/features', '/pricing', '/how-it-works', '/faq', '/contact', '/blog'];
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
