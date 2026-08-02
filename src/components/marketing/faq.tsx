"use client";

import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Plus } from "lucide-react";
import {
  SPRING_SPATIAL_DEFAULT,
  TRANSITION_BASE,
} from "@/lib/motion/tokens";

interface FAQItem {
  question: string;
  answer: string;
}

const faqs: FAQItem[] = [
  {
    question: "What does PurpleInk create?",
    answer:
      "PurpleInk turns approved recordings or verified browser-based demo flows into structured, brand-ready product launch videos.",
  },
  {
    question: "How does PurpleInk keep product videos accurate?",
    answer:
      "Key product scenes come from approved recordings or repeatable demo flows, so reviewers can trace what each scene proves before publishing.",
  },
  {
    question: "Can I revise a video after the first draft?",
    answer:
      "Yes. Storyboard-level review separates product facts, copy, footage, and visual treatment so the affected scenes can be revised without rebuilding the entire release.",
  },
  {
    question: "Which launch formats does PurpleInk support?",
    answer:
      "A single approved story produces a channel-ready 16:9 landscape launch video while reusing the same verified product evidence and brand rules.",
  },
  {
    question: "Does PurpleInk need access to production data?",
    answer:
      "No unauthorized production access is required. PurpleInk is designed to work with approved recordings or controlled staging and demo environments.",
  },
];

function FAQItemComponent({
  item,
  index,
  isOpen,
  onToggle,
}: {
  item: FAQItem;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const buttonId = `faq-${index}-button`;
  const answerId = `faq-${index}-answer`;
  return (
    <motion.div
      layout
      className="bg-muted/50 rounded-2xl"
      transition={SPRING_SPATIAL_DEFAULT}
    >
      <button
        id={buttonId}
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={answerId}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-6 py-5 text-left"
      >
        <span className="text-foreground text-base font-medium">
          {item.question}
        </span>
        <motion.div
          animate={{ rotate: isOpen ? 45 : 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="shrink-0"
        >
          <Plus className="text-foreground h-5 w-5" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={answerId}
            role="region"
            aria-labelledby={buttonId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              default: SPRING_SPATIAL_DEFAULT,
              opacity: TRANSITION_BASE,
            }}
            className="overflow-hidden"
          >
            <p className="text-muted-foreground px-6 pb-5">{item.answer}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function FAQ(): ReactNode {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const handleToggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="border-foreground/10 border-t px-4 py-20 sm:px-6 md:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-6">
            <h2 className="text-foreground text-4xl font-medium tracking-tight">
              Answers to your questions
            </h2>
          </div>

          <div className="lg:col-span-6">
            <div className="flex flex-col gap-3">
              {faqs.map((faq, index) => (
                <FAQItemComponent
                  key={faq.question}
                  item={faq}
                  index={index}
                  isOpen={openIndex === index}
                  onToggle={() => handleToggle(index)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
