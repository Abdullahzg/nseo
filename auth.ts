import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAINS ?? "imagine.art";
const isDemo = !process.env.GOOGLE_CLIENT_ID?.trim();

// Demo mode: return a synthetic session without OAuth
const demoAuth = async () => ({
  user: { id: "demo-user", name: "Demo User", email: "demo@local", image: null },
  expires: new Date(Date.now() + 86400000).toISOString(),
});

const realAuth = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const email = user.email ?? "";
      const allowed = ALLOWED_DOMAIN.split(",").map((d) => d.trim());
      const domain = email.split("@")[1];
      if (!allowed.includes(domain)) {
        return `/login?error=domain&email=${encodeURIComponent(email)}`;
      }
      return true;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});

// In demo mode, provide no-op handlers so NextAuth's route handler doesn't reject everything
const demoHandlers = { GET: async () => new Response("demo mode", { status: 200 }), POST: async () => new Response("demo mode", { status: 200 }) };

export const handlers = isDemo ? demoHandlers : realAuth.handlers;
export const signIn = isDemo ? undefined : realAuth.signIn;
export const signOut = isDemo ? undefined : realAuth.signOut;
export const auth = isDemo ? demoAuth : realAuth.auth;
