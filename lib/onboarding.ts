// lib/onboarding.ts
// Pure predicate for the post-signup first-run experience.
// A brand-new user is one who has not yet added any client (no meta_clients
// rows). Such users are routed into the focused "add your first client" flow
// instead of the full feature dashboard (anti-overwhelm / agency-led onboarding).
export function isNewUser(clientCount: number | null | undefined): boolean {
  return (clientCount ?? 0) <= 0;
}
