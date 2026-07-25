"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { Check, Rocket, Zap, Building2 } from "lucide-react";

interface PricingPlan {
  name: string;
  description: string;
  price: string;
  period: string;
  note?: string;
  features: string[];
  cta: string;
  popular?: boolean;
  icon: LucideIcon;
}

const plans: PricingPlan[] = [
  {
    name: "Starter",
    description: "For individuals and side projects",
    price: "$29",
    period: "/mo",
    icon: Rocket,
    features: [
      "50 design generations/month",
      "Basic brand kit",
      "PNG & SVG exports",
      "Email support",
      "1 workspace",
    ],
    cta: "Join waitlist",
  },
  {
    name: "Pro",
    description: "Best for startups and growing teams",
    price: "$99",
    period: "/mo",
    note: "Cancel or pause any time",
    icon: Zap,
    features: [
      "Unlimited design generations",
      "Advanced brand consistency",
      "All export formats + Figma",
      "Priority support & delivery",
      "5 team members",
      "API access",
    ],
    cta: "Join waitlist",
    popular: true,
  },
  {
    name: "Enterprise",
    description: "For large teams and organizations",
    price: "Custom",
    period: "",
    icon: Building2,
    features: [
      "Everything in Pro",
      "Unlimited team members",
      "Custom model training",
      "Dedicated account manager",
      "SSO & advanced security",
      "SLA & on-prem options",
    ],
    cta: "Contact sales",
  },
];

function PricingCard({ plan }: { plan: PricingPlan }) {
  const Icon = plan.icon;

  const cardContent = (
    <div
      className={`bg-background relative flex h-full flex-col rounded-3xl p-3 ${
        plan.popular ? "" : "border-foreground/10 border"
      }`}
    >
      <div className="mb-6 flex items-start justify-between">
        <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-2xl">
          <Icon className="text-foreground h-5 w-5" />
        </div>
        {plan.popular && (
          <span className="border-accent/50 bg-accent/20 text-accent rounded-full border px-4 py-1.5 text-sm font-medium">
            Most popular
          </span>
        )}
      </div>

      <h3 className="text-foreground text-xl font-semibold">{plan.name}</h3>
      <p className="text-muted-foreground mt-1 text-sm">{plan.description}</p>

      <div className="mt-6 flex items-baseline gap-1">
        <span className="text-foreground text-5xl font-semibold tracking-tight">
          {plan.price}
        </span>
        {plan.period && (
          <span className="text-muted-foreground text-lg">{plan.period}</span>
        )}
        {plan.note && (
          <span className="text-muted-foreground ml-auto text-right text-sm">
            {plan.note}
          </span>
        )}
      </div>

      <div className="mt-8 flex-1">
        <div className="bg-muted/50 flex h-full flex-col rounded-xl p-6">
          <ul className="flex-1 space-y-4">
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <Check className="text-accent mt-0.5 h-5 w-5 shrink-0" />
                <span className="text-foreground text-sm">{feature}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className={`mt-6 w-full cursor-pointer rounded-full py-4 text-base font-semibold transition-all ${
              plan.popular
                ? "bg-accent text-accent-foreground hover:opacity-90"
                : "bg-foreground text-background hover:bg-foreground/70"
            }`}
          >
            {plan.cta}
          </button>
        </div>
      </div>
    </div>
  );

  if (plan.popular) {
    return (
      <div className="relative">
        <motion.div
          className="bg-accent-light pointer-events-none absolute top-1/2 left-1/2 h-[70%] w-[70%] rounded-full opacity-50 blur-3xl"
          animate={{
            x: ["-50%", "-30%", "-70%", "-40%", "-60%", "-50%"],
            y: ["-50%", "-70%", "-30%", "-60%", "-40%", "-50%"],
            scale: [1, 1.2, 0.9, 1.1, 0.95, 1],
          }}
          transition={{
            duration: 12,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
            times: [0, 0.2, 0.4, 0.6, 0.8, 1],
          }}
        />
        <motion.div
          className="bg-accent pointer-events-none absolute top-1/2 left-1/2 h-[50%] w-[50%] rounded-full opacity-40 blur-3xl"
          animate={{
            x: ["-50%", "-70%", "-30%", "-60%", "-40%", "-50%"],
            y: ["-50%", "-30%", "-70%", "-40%", "-60%", "-50%"],
            scale: [1, 0.9, 1.15, 0.95, 1.1, 1],
          }}
          transition={{
            duration: 10,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
            times: [0, 0.2, 0.4, 0.6, 0.8, 1],
          }}
        />
        <div className="from-accent to-accent-light absolute -inset-px rounded-[1.52rem] bg-linear-to-br opacity-25" />
        <div className="relative">{cardContent}</div>
      </div>
    );
  }

  return cardContent;
}

export function Pricing(): ReactNode {
  return (
    <section id="pricing" className="px-4 py-20 sm:px-6 md:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16">
          <p className="text-foreground text-4xl font-medium tracking-tight">
            Simple, transparent pricing
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {plans.map((plan) => (
            <PricingCard key={plan.name} plan={plan} />
          ))}
        </div>

        <p className="text-muted-foreground mx-auto mt-12 max-w-2xl text-center text-lg">
          Start free and scale as you grow. No hidden fees, no surprises.
        </p>
      </div>
    </section>
  );
}
