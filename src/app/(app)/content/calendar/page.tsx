import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { asc, isNull } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { CalendarView } from "@/components/content/calendar-view";
import { NewPostButton } from "@/components/content/new-post-button";
import { loadForUser } from "@/server/page";
import { calendarEntries, unscheduled } from "@/server/queries/content";
import { contentPillars } from "@/db/schema";

export const metadata = { title: "Content Calendar" };

export default async function CalendarPage({ searchParams }: PageProps<"/content/calendar">) {
  const sp = await searchParams;
  const view = sp.view === "week" || sp.view === "list" ? sp.view : "month";
  const anchorStr = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : format(new Date(), "yyyy-MM-dd");
  const anchor = new Date(`${anchorStr}T12:00:00`);
  const from = view === "week" ? startOfWeek(anchor, { weekStartsOn: 1 }) : startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
  const to = view === "week" ? endOfWeek(anchor, { weekStartsOn: 1 }) : addDays(endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }), 0);

  const { entries, drafts, pillars } = await loadForUser(async (tx) => ({
    entries: await calendarEntries(tx, from, to),
    drafts: await unscheduled(tx),
    pillars: await tx.select({ id: contentPillars.id, name: contentPillars.name }).from(contentPillars).where(isNull(contentPillars.archivedAt)).orderBy(asc(contentPillars.sortOrder)),
  }));
  const filtered = entries.filter(
    (e) =>
      (!sp.platform || e.platform === sp.platform) &&
      (!sp.status || e.status === sp.status) &&
      (!sp.pillar || e.pillarId === sp.pillar) &&
      (view !== "list" || (new Date(e.date) >= startOfMonth(anchor) && new Date(e.date) <= endOfMonth(anchor))),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Content Calendar"
        description="Plan, reschedule and track posts across X and LinkedIn."
        actions={<NewPostButton />}
      />
      <CalendarView entries={filtered} unscheduled={drafts} view={view} anchor={anchorStr} pillars={pillars} />
    </div>
  );
}
