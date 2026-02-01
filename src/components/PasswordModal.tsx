"use client";

import { useState, FormEvent } from "react";
import { Modal, ModalTitle, ModalFooter, ModalButton } from "./Modal";

type PasswordModalProps = {
  open: boolean;
  onSuccess: () => void;
};

const AUTH_STORAGE_KEY = "remote-viewer-auth";

export function PasswordModal({ open, onSuccess }: PasswordModalProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      console.log("[auth] attempting login...");
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      console.log("[auth] login response status:", res.status);
      const data = await res.json();
      console.log("[auth] login response data:", data);

      if (data.success) {
        // Store auth state in sessionStorage so it persists during the session
        sessionStorage.setItem(AUTH_STORAGE_KEY, "true");
        console.log("[auth] login successful");
        onSuccess();
      } else {
        setError(data.error || "Invalid password");
        setPassword("");
      }
    } catch (error) {
      console.error("[auth] login error:", error);
      setError("Unable to verify password. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} closeOnBackdrop={false}>
      <ModalTitle>Remote Viewer</ModalTitle>
      <p className="mt-3 text-sm text-neutral-300">
        Enter the password to continue.
      </p>
      <form onSubmit={handleSubmit} className="mt-4">
        <label htmlFor="password-input" className="sr-only">Password</label>
        <input
          id="password-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-neutral-100 placeholder-neutral-500 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
        />
        {error && (
          <p className="mt-2 text-sm text-red-400">{error}</p>
        )}
        <ModalFooter>
          <ModalButton type="submit" variant="primary" disabled={loading || !password}>
            {loading ? "Verifying..." : "Enter"}
          </ModalButton>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** Check if user is already authenticated this session */
export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(AUTH_STORAGE_KEY) === "true";
}
