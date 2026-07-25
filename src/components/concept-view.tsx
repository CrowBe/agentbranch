"use client";

import { useState, type FormEvent } from "react";
import type { ConceptClaim, ConceptCitation } from "@/modules/concept-library";
import type { ConceptView as ConceptViewModel } from "@/modules/concept";
import { Button } from "./ui/button";

export function ConceptView({
  concept,
  busy = false,
  onAsk,
}: {
  concept: ConceptViewModel;
  busy?: boolean;
  onAsk?: (question: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (!value || busy) return;
    onAsk?.(value);
  };

  return (
    <article className="flex flex-col gap-5" aria-labelledby={`concept-${concept.id}`}>
      <header className="flex flex-col gap-1">
        <p className="text-label text-on-surface-variant">Concept</p>
        <h1 id={`concept-${concept.id}`} className="text-headline-md">
          {concept.title}
        </h1>
      </header>

      <Claim label="The idea" claim={concept.idea} />
      <Claim label="The distinction" claim={concept.distinction} />

      {concept.options.length > 0 ? (
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Options">
          {concept.options.map((option) => (
            <div
              key={option.term}
              className="rounded-[var(--radius-sm)] border border-outline-variant bg-surface-high p-4"
            >
              <h2 className="text-body-md">{option.term}</h2>
              <p className="text-doc-rendered mt-1">{option.useWhen.text}</p>
              <Citations citations={option.useWhen.citations} />
            </div>
          ))}
        </section>
      ) : null}

      {onAsk ? (
        <form className="flex flex-col gap-2 border-t border-outline-variant pt-4" onSubmit={submit}>
          <label htmlFor={`concept-question-${concept.id}`} className="text-label text-on-surface-variant">
            Ask about this
          </label>
          <textarea
            id={`concept-question-${concept.id}`}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={2}
            placeholder="What would you like to understand?"
            className="resize-none rounded-[var(--radius-sm)] border border-outline-variant bg-surface px-3 py-2 text-doc-rendered outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
          <div>
            <Button type="submit" variant="secondary" disabled={busy || question.trim().length === 0}>
              {busy ? "Answering…" : "Ask about this"}
            </Button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

function Claim({ label, claim }: { label: string; claim: ConceptClaim }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-label text-on-surface-variant">{label}</h2>
      <p className="text-doc-rendered">{claim.text}</p>
      <Citations citations={claim.citations} />
    </section>
  );
}

function Citations({ citations }: { citations: readonly ConceptCitation[] }) {
  return (
    <p className="text-label text-on-surface-variant">
      {citations.map((citation) => `${citation.source} · ${citation.section}`).join(" · ")}
    </p>
  );
}
