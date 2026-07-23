import {
  AuthShell,
  authButtonClassName,
  authInputClassName,
} from "@/components/auth/auth-shell";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export default function LoginPage(): ReactNode {
  return (
    <AuthShell
      eyebrow="Sign in"
      title="Welcome back"
      footer={
        <p>
          New to PurpleInk?{" "}
          <Link
            className="text-accent-strong font-semibold hover:underline"
            href="/signup"
          >
            Create a workspace
          </Link>
        </p>
      }
    >
      <form className="space-y-5">
        <label className="block text-sm font-medium">
          Work email
          <input
            className={authInputClassName}
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
          />
        </label>
        <label className="block text-sm font-medium">
          Password
          <input
            className={authInputClassName}
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button className={authButtonClassName} type="submit">
          Continue
          <ArrowRight size={16} />
        </button>
      </form>
    </AuthShell>
  );
}
