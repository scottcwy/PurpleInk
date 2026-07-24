import {
  AuthShell,
  authButtonClassName,
  authInputClassName,
} from "@/components/auth/auth-shell";
import { ArrowRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
      <form className="flex flex-col gap-5">
        <Alert className="border-signal bg-signal-soft text-signal-ink">
          <AlertTitle>Workspace registration unavailable</AlertTitle>
          <AlertDescription className="text-signal-ink">
            The registration interface is ready, but no account service is
            connected.
          </AlertDescription>
        </Alert>
        <FieldGroup>
          <Field data-disabled="true">
            <FieldLabel htmlFor="signup-name">Your name</FieldLabel>
            <Input
              id="signup-name"
              className={authInputClassName}
              disabled
              type="text"
              name="name"
              autoComplete="name"
              required
            />
          </Field>
          <Field data-disabled="true">
            <FieldLabel htmlFor="signup-email">Work email</FieldLabel>
            <Input
              id="signup-email"
              className={authInputClassName}
              disabled
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
            />
          </Field>
          <Field data-disabled="true">
            <FieldLabel htmlFor="signup-workspace">Workspace name</FieldLabel>
            <Input
              id="signup-workspace"
              className={authInputClassName}
              disabled
              type="text"
              name="workspaceName"
              autoComplete="organization"
              required
            />
          </Field>
          <Field data-disabled="true">
            <FieldLabel htmlFor="signup-password">Password</FieldLabel>
            <Input
              id="signup-password"
              className={authInputClassName}
              disabled
              type="password"
              name="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </Field>
        </FieldGroup>
        <Button
          className={authButtonClassName}
          type="submit"
          disabled
          size="lg"
        >
          Create workspace
          <ArrowRight data-icon="inline-end" />
        </Button>
      </form>
    </AuthShell>
  );
}
