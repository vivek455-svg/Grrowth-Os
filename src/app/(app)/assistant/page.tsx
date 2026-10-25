import { PageHeader } from "@/components/app/page-header";
import { AssistantChat } from "@/components/assistant/assistant-chat";
import { requireUser } from "@/server/auth";
import { aiStatus } from "@/server/ai";
import { QUICK_QUESTIONS } from "@/server/assistant/tools";

export const metadata = { title: "AI Growth Assistant" };

export default async function AssistantPage() {
  await requireUser();
  return (
    <div className="space-y-5">
      <PageHeader title="AI Growth Assistant" description="Questions about your real data — content, prospects, campaigns and pipeline." />
      <AssistantChat aiEnabled={aiStatus().connected} quick={QUICK_QUESTIONS.map((q) => q.label)} />
    </div>
  );
}
