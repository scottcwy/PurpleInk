"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { MessageCircle, Network, Share2 } from "lucide-react";

const footerLinks = {
  Product: [
    { label: "Features", href: "#" },
    { label: "Changelog", href: "#" },
    { label: "Roadmap", href: "#" },
  ],
  Company: [
    { label: "About", href: "#" },
    { label: "Blog", href: "#" },
    { label: "Careers", href: "#" },
    { label: "Press", href: "#" },
  ],
  Resources: [
    { label: "Documentation", href: "#" },
    { label: "Help Center", href: "#" },
    { label: "Community", href: "#" },
  ],
};

const socialLinks = [
  { icon: MessageCircle, href: "#", label: "Facebook" },
  { icon: Share2, href: "#", label: "Twitter" },
  { icon: Network, href: "#", label: "LinkedIn" },
];

export function Footer(): ReactNode {
  return (
    <footer className="bg-background text-foreground relative overflow-hidden px-4 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 opacity-60"
        style={{
          background:
            "linear-gradient(to top, rgba(51,61,167,0.8) 0%, rgba(81,96,195,0.5) 20%, rgba(115,136,223,0.3) 40%, rgba(140,158,230,0.15) 60%, rgba(165,180,240,0.05) 80%, transparent 100%)",
          maskImage:
            "linear-gradient(to top, black 0%, black 20%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to top, black 0%, black 20%, transparent 100%)",
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-7xl py-16">
        <div className="flex flex-col gap-12 lg:flex-row lg:justify-between">
          <div className="grid flex-1 gap-8 sm:grid-cols-3">
            {Object.entries(footerLinks).map(([category, links]) => (
              <div key={category}>
                <h3 className="text-muted-foreground text-sm">{category}</h3>
                <ul className="mt-4 space-y-3">
                  {links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-foreground hover:text-foreground/70 text-lg transition-colors"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="lg:text-right">
            <h3 className="text-muted-foreground text-sm">Social</h3>
            <div className="mt-4 flex gap-3 lg:justify-end">
              {socialLinks.map((social) => (
                <Link
                  key={social.label}
                  href={social.href}
                  className="bg-foreground/10 text-foreground hover:bg-foreground/20 flex h-11 w-11 items-center justify-center rounded-full transition-colors"
                  aria-label={social.label}
                >
                  <social.icon
                    className="fill-foreground/40 text-foreground/40 h-5 w-5"
                    strokeWidth={1}
                  />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="relative mx-auto max-w-7xl py-8">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-muted-foreground text-sm">
            © {new Date().getFullYear()} PurpleInk. All rights reserved.
          </p>
          <div className="flex gap-6">
            <Link
              href="#"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Terms
            </Link>
            <Link
              href="#"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="#"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Cookies
            </Link>
          </div>
        </div>
      </div>

      <div className="relative mx-auto h-44 max-w-338 pb-12 select-none">
        <Image
          src="/svg/logo-text.svg"
          alt=""
          width={2500}
          height={400}
          className="w-full opacity-5 invert dark:invert-0"
          aria-hidden="true"
        />
      </div>
    </footer>
  );
}
