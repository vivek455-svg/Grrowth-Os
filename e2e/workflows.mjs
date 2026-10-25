/**
 * End-to-end workflow check against a running app in DEMO_MODE (default http://localhost:3000).
 *   node e2e/workflows.mjs
 * Mutates the demo workspace; reset with `npm run db:reset-local`.
 */
import { createRequire } from "node:module";

// Uses the project dependency if installed, otherwise a globally available Playwright.
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const stamp = Date.now().toString(36);
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message.split("\n").slice(0, 3).join(" | ")]);
    await page.screenshot({ path: `e2e-failure-${results.length}.png`, fullPage: true }).catch(() => {});
  }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const toast = (text) => page.locator("[data-sonner-toast]").filter({ hasText: text }).first().waitFor();

await step("quick-create a post from the header", async () => {
  await page.goto(`${BASE}/content/calendar`);
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("menuitem", { name: "New post" }).click();
  await page.getByLabel("Internal label").fill(`E2E post ${stamp}`);
  await page.getByLabel("Draft").fill(`Most landing pages bury the outcome. ${stamp}`);
  await page.getByRole("button", { name: "Create post" }).click();
  await toast("Post created");
});

await step("open the post, mark it published and record metrics", async () => {
  await page.goto(`${BASE}/content/library?q=${stamp}`);
  await page.getByRole("link", { name: `E2E post ${stamp}` }).first().click();
  await page.getByRole("button", { name: "I published it" }).click();
  await page.getByLabel("Post URL").fill(`https://www.linkedin.com/feed/update/urn:li:activity:${Date.now()}`);
  await page.getByRole("button", { name: "Mark as published" }).click();
  await toast("Publication recorded");
  await page.getByRole("button", { name: "Record metrics" }).first().click();
  await page.getByLabel("Impressions").fill("1500");
  await page.getByLabel("Likes / reactions").fill("45");
  await page.getByRole("button", { name: "Save snapshot" }).click();
  await toast("Metrics recorded");
  await page.getByText("3.0%").first().waitFor(); // 45 / 1500
});

await step("add a prospect and catch a duplicate", async () => {
  await page.goto(`${BASE}/prospects`);
  await page.getByRole("button", { name: "Add prospect" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Full name").fill(`Erin Test ${stamp}`);
  await dlg.getByLabel("Company", { exact: true }).fill("E2E Labs");
  await dlg.getByLabel("Work email").fill(`erin.${stamp}@e2e-labs.example`);
  await dlg.getByLabel("LinkedIn profile URL").fill(`https://www.linkedin.com/in/erin-${stamp}`);
  await dlg.getByRole("button", { name: "Add prospect" }).click();
  await page.waitForURL(/\/prospects\/[0-9a-f-]{36}$/);
  await page.getByRole("heading", { name: `Erin Test ${stamp}` }).waitFor();
  // Same email again → duplicate warning instead of a second record.
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("menuitem", { name: "Add prospect" }).click();
  const d2 = page.getByRole("dialog");
  await d2.getByLabel("Full name").fill("Someone Else");
  await d2.getByLabel("Work email").fill(`erin.${stamp}@e2e-labs.example`);
  await d2.getByRole("button", { name: "Add prospect" }).click();
  await d2.getByText("Possible duplicate").waitFor();
  await page.keyboard.press("Escape");
});

await step("draft, approve and record a manual send with a follow-up", async () => {
  await page.getByRole("link", { name: "Draft outreach" }).click();
  await page.waitForURL(/outreach\/compose/);
  await page.getByLabel("Subject").fill("E2E Labs homepage");
  await page.getByLabel("Message body").fill(`Hi Erin, noticed the homepage leads with features. Happy to share two ideas. ${stamp}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await toast("Draft saved");
  await page.getByRole("button", { name: "Approve" }).click();
  await toast("Approved");
  await page.getByRole("button", { name: "I sent it" }).click();
  await page.getByRole("button", { name: "Record as sent" }).click();
  await toast("Recorded as sent");
  await page.getByText("logged").first().waitFor();
});

await step("duplicate-contact protection blocks a second first message", async () => {
  await page.getByLabel("Message body").fill("Hi again");
  await page.getByLabel("Subject").fill("Again");
  await page.getByRole("button", { name: "Save draft" }).click();
  await toast("Draft saved");
  await page.getByRole("button", { name: "Approve" }).click();
  await toast("Duplicate-contact protection");
  await page.getByRole("button", { name: "Discard" }).first().click();
});

await step("log a positive reply: status moves to Interested and the follow-up is cancelled", async () => {
  await page.getByRole("link", { name: `Erin Test ${stamp}` }).click();
  await page.getByText("Follow-ups").first().waitFor();
  await page.getByRole("button", { name: "Log interaction" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Email received" }).click();
  await dlg.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: /^Positive/ }).click();
  await dlg.getByLabel("Message content").fill("Sounds useful — send them over.");
  await dlg.getByRole("button", { name: "Log interaction" }).click();
  await toast("Interaction logged");
  await page.reload();
  await page.getByRole("combobox", { name: "Lead status" }).filter({ hasText: "Interested" }).waitFor();
  await page.getByText("None scheduled.").waitFor();
});

await step("create an opportunity from the prospect", async () => {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Create opportunity" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill(`E2E Labs — Homepage ${stamp}`);
  await dlg.getByLabel("Estimated value").fill("6500");
  await dlg.getByRole("button", { name: "Create" }).click();
  await toast("Opportunity created");
  await page.goto(`${BASE}/opportunities`);
  await page.getByText(`E2E Labs — Homepage ${stamp}`).waitFor();
});

await step("CSV import shows a validated preview before saving", async () => {
  await page.goto(`${BASE}/prospects/import`);
  const csv = `Name,Company,Email,Website\nNew Person ${stamp},Acme,new.${stamp}@acme.example,acme.example\nErin Test,E2E Labs,erin.${stamp}@e2e-labs.example,\n,NoName,x@y.example,\n`;
  await page.locator('input[type="file"]').setInputFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Validate & preview" }).click();
  await page.getByText("1 ready · 1 duplicates · 1 with errors").waitFor();
  await page.getByRole("button", { name: "Import 1 prospects" }).click();
  await page.getByText("Import finished").waitFor();
});

await step("global search finds the new prospect", async () => {
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Search prospects, posts, campaigns…").fill(`Erin Test ${stamp}`);
  await page.getByRole("option", { name: new RegExp(`Erin Test ${stamp}`) }).waitFor();
  await page.keyboard.press("Escape");
});

await browser.close();
for (const r of results) console.log(r.join(" — "));
if (errors.length) console.log("page errors:\n  " + errors.join("\n  "));
process.exit(results.some((r) => r[0] === "FAIL") || errors.length ? 1 : 0);
