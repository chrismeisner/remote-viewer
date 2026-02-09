import NextAuth, { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

/** Comma-separated list of emails allowed to access /admin */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  callbacks: {
    /** Only allow sign-in if the email is on the allow-list */
    async signIn({ user }) {
      if (ADMIN_EMAILS.length === 0) return true; // no list = allow all
      return ADMIN_EMAILS.includes(user.email?.toLowerCase() ?? "");
    },

    /** Attach the email + admin flag to the JWT */
    async jwt({ token, user }) {
      if (user) {
        token.email = user.email;
        token.isAdmin = ADMIN_EMAILS.includes(
          user.email?.toLowerCase() ?? ""
        );
      }
      return token;
    },

    /** Expose email + admin flag on the client-side session */
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email as string;
        (session.user as Record<string, unknown>).isAdmin = token.isAdmin;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
