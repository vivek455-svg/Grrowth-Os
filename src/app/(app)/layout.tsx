import { redirect } from "next/navigation";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app/app-sidebar";
import { AppHeader } from "@/components/app/app-header";
import { ShellProvider } from "@/components/app/shell-context";
import { loadForUser } from "@/server/page";
import { getShellData } from "@/server/queries/shell";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { shell, user } = await loadForUser(async (tx, user) => ({ shell: await getShellData(tx, user.id), user }));
  if (!shell.profile?.onboardingCompletedAt) redirect("/onboarding");

  return (
    <ShellProvider
      options={{ pillars: shell.pillars, statuses: shell.statuses, campaigns: shell.campaigns, isDemo: user.isDemo }}
    >
      <SidebarProvider>
        <AppSidebar followUpsDue={shell.followUpsDue} isDemo={user.isDemo} businessName={shell.profile.businessName} />
        <SidebarInset className="min-w-0">
          <AppHeader
            notifications={shell.notifications}
            name={shell.profile.fullName}
            email={shell.profile.email}
            isDemo={user.isDemo}
          />
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </ShellProvider>
  );
}
