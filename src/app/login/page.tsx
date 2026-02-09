"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";

function LoginContent() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const error = searchParams.get("error");

  // If already authenticated, redirect to admin
  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/admin");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-dvh bg-black flex items-center justify-center">
        <p className="text-neutral-400 text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-white">Admin Login</h1>
          <p className="text-sm text-neutral-400">
            Sign in with your Google account to access the admin panel.
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error === "AccessDenied"
              ? "Your email is not authorized for admin access."
              : "Something went wrong. Please try again."}
          </div>
        )}

        {/* Sign in button */}
        <button
          onClick={() => signIn("google", { callbackUrl: "/admin" })}
          className="w-full flex items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-neutral-200 active:scale-[0.98]"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Sign in with Google
        </button>

        {/* Back to home */}
        <p className="text-center">
          <a
            href="/"
            className="text-xs text-neutral-500 hover:text-neutral-300 transition"
          >
            &larr; Back to home
          </a>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-black flex items-center justify-center">
          <p className="text-neutral-400 text-sm">Loading...</p>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
