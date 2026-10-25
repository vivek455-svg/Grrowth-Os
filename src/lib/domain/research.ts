import type { ResearchObservation } from "@/db/schema";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Anti-hallucination guard for website research: an observation may only stay "verified"
 * if its supporting quote actually appears in the fetched page text. Anything else is
 * downgraded to a hypothesis and labelled.
 */
export function reconcileObservations(
  observations: { text: string; kind: "verified" | "hypothesis"; evidence_quote: string | null }[],
  pageText: string,
  url: string,
): ResearchObservation[] {
  const haystack = norm(pageText);
  return observations.map((o) => {
    const quote = o.evidence_quote ? norm(o.evidence_quote) : "";
    const supported = o.kind === "verified" && quote.length >= 4 && haystack.includes(quote);
    return {
      text: o.kind === "verified" && !supported ? `${o.text} (couldn't match a quote on the page — treat as unverified)` : o.text,
      kind: supported ? "verified" : "hypothesis",
      source_url: supported ? url : null,
    };
  });
}
