// Owner sign-in: Google OAuth via NextAuth v5. Only addresses on OWNER_EMAILS (or ALLOWED_DOMAINS)
// become owners; everyone else is a guest and can only run demo campaigns.
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { ownerAllowed } from "@/lib/auth/service";

const configured = !!process.env.GOOGLE_CLIENT_ID?.trim();

const real = NextAuth({
  providers: [Google({ clientId: process.env.GOOGLE_CLIENT_ID ?? "", clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "" })],
  callbacks: {
    async signIn({ user }) { return ownerAllowed(user.email) ? true : "/login?error=not_owner"; },
    async session({ session, token }) { if (session.user) (session.user as any).id = token.sub; return session; },
  },
  pages: { signIn: "/login", error: "/login" },
});

const noop = { GET: async () => new Response("auth not configured", { status: 404 }), POST: async () => new Response("auth not configured", { status: 404 }) };
export const handlers = configured ? real.handlers : noop;
export const signIn = configured ? real.signIn : undefined;
export const signOut = configured ? real.signOut : undefined;
export const auth = configured ? real.auth : (async () => null) as unknown as typeof real.auth;
