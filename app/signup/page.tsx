import {
  AuthShell,
  authButtonClassName,
  authInputClassName,
} from "@/components/auth/auth-shell";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export default function SignupPage(): ReactNode {
  return (
    <AuthShell
      eyebrow="Get started"
      title="Create your workspace"
      footer={
        <p>
          Already have an account?{" "}
          <Link
            className="text-accent-strong font-semibold hover:underline"
            href="/login"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <form className="space-y-5">
        <label className="block text-sm font-medium">
          Your name
          <input
            className={authInputClassName}
            type="text"
            name="name"
            autoComplete="name"
            required
          />
        </label>
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
          Workspace name
          <input
            className={authInputClassName}
            type="text"
            name="workspaceName"
            autoComplete="organization"
            required
          />
        </label>
        <label className="block text-sm font-medium">
          Password
          <input
            className={authInputClassName}
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
        <button className={authButtonClassName} type="submit">
          Create workspace
          <ArrowRight size={16} />
        </button>
      </form>
    </AuthShell>
  );
}
