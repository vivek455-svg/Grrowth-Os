import { describe, expect, it } from "vitest";
import {
  cooldownBlock,
  findDuplicates,
  followUpBlock,
  nextStatusAfterEvent,
  normalizeXHandle,
  suppressionReason,
} from "@/lib/domain/outreach-rules";

const target = {
  id: "p1",
  status: "ready",
  email: "Ada@Acme.io",
  linkedinUrl: "https://www.linkedin.com/in/ada-l/",
  xUrl: "https://x.com/ada_builds",
  companyWebsite: "https://acme.io",
  websiteUrl: null,
};
const none = { email: null, domain: null, linkedinUrl: null, xHandle: null, prospectId: null };

describe("status transitions", () => {
  it("moves forward on outreach and replies, never backward", () => {
    expect(nextStatusAfterEvent("ready", "email_sent", null)).toBe("contacted");
    expect(nextStatusAfterEvent("contacted", "email_received", null)).toBe("replied");
    expect(nextStatusAfterEvent("contacted", "linkedin_received", "positive")).toBe("interested");
    expect(nextStatusAfterEvent("call_booked", "email_sent", null)).toBe("call_booked");
    expect(nextStatusAfterEvent("won", "email_received", "positive")).toBe("won");
  });
  it("opt-out always wins and custom statuses are left alone", () => {
    expect(nextStatusAfterEvent("interested", "email_received", "opt_out")).toBe("do_not_contact");
    expect(nextStatusAfterEvent("partner_intro", "email_sent", null)).toBe("partner_intro");
  });
});

describe("suppression", () => {
  it("matches on status, email, domain, LinkedIn and X handle", () => {
    expect(suppressionReason({ ...target, status: "do_not_contact" }, [])).toMatch(/do not contact/);
    expect(suppressionReason(target, [{ ...none, email: "ada@acme.io" }])).toMatch(/Email/);
    expect(suppressionReason(target, [{ ...none, domain: "acme.io" }])).toMatch(/Domain/);
    expect(suppressionReason(target, [{ ...none, linkedinUrl: "linkedin.com/in/ada-l" }])).toMatch(/LinkedIn/);
    expect(suppressionReason(target, [{ ...none, xHandle: "@ada_builds" }])).toMatch(/X handle/);
    expect(suppressionReason(target, [{ ...none, email: "other@acme.com" }])).toBeNull();
  });
  it("normalizes X handles", () => {
    expect(normalizeXHandle("https://twitter.com/Ada_Builds/")).toBe("ada_builds");
    expect(normalizeXHandle("@ada")).toBe("ada");
  });
});

describe("cooldown and follow-up guards", () => {
  const now = new Date("2026-10-25T00:00:00Z");
  it("blocks re-contact inside the cooldown window", () => {
    expect(cooldownBlock(new Date("2026-10-20T00:00:00Z"), 30, now)).toMatch(/5 days ago/);
    expect(cooldownBlock(new Date("2026-09-01T00:00:00Z"), 30, now)).toBeNull();
    expect(cooldownBlock(null, 30, now)).toBeNull();
  });
  it("never follows up after a reply", () => {
    expect(
      followUpBlock({ lastOutboundAt: new Date("2026-10-01"), lastInboundAt: new Date("2026-10-03"), suppression: null }),
    ).toMatch(/replied/);
    expect(
      followUpBlock({ lastOutboundAt: new Date("2026-10-05"), lastInboundAt: new Date("2026-10-03"), suppression: null }),
    ).toBeNull();
  });
});

describe("duplicate detection", () => {
  const existing = [
    { id: "a", fullName: "Ada Lovelace", company: "Acme", email: "ada@acme.io", linkedinUrl: null, companyWebsite: "https://acme.io", websiteUrl: null },
    { id: "b", fullName: "Grace Hopper", company: "Navy", email: null, linkedinUrl: "https://linkedin.com/in/grace", companyWebsite: null, websiteUrl: null },
  ];
  it("detects by email, LinkedIn, or same name + domain", () => {
    expect(findDuplicates({ fullName: "A. L.", email: "ADA@acme.io" }, existing)[0]?.reason).toBe("email");
    expect(findDuplicates({ fullName: "G", linkedinUrl: "https://www.linkedin.com/in/grace/" }, existing)[0]?.reason).toBe("linkedin");
    expect(findDuplicates({ fullName: "ada  lovelace", companyWebsite: "www.acme.io/about" }, existing)[0]?.reason).toBe("name_domain");
    expect(findDuplicates({ fullName: "New Person", companyWebsite: "acme.io" }, existing)).toHaveLength(0);
  });
});
