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
      <form className="flex flex-col gap-5">
        <Alert className="border-signal bg-signal-soft text-signal-ink">
          <AlertTitle>Authentication service unavailable</AlertTitle>
          <AlertDescription className="text-signal-ink">
            The sign-in interface is ready, but no session service is connected.
          </AlertDescription>
        </Alert>
        <FieldGroup>
          <Field data-disabled="true">
            <FieldLabel htmlFor="login-email">Work email</FieldLabel>
            <Input
              id="login-email"
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
            <FieldLabel htmlFor="login-password">Password</FieldLabel>
            <Input
              id="login-password"
              className={authInputClassName}
              disabled
              type="password"
              name="password"
              autoComplete="current-password"
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
          Continue
          <ArrowRight data-icon="inline-end" />
        </Button>
      </form>
    </AuthShell>
  );
}
