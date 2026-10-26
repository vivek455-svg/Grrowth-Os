"use client";

import Link from "next/link";
import { LogoMark } from "@/components/app/logo-mark";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  BookOpen,
  Briefcase,
  CalendarDays,
  Compass,
  FileBarChart,
  Inbox,
  LayoutDashboard,
  Megaphone,
  Plug,
  Settings,
  Sparkles,
  Users,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";

type NavItem = { title: string; href: string; icon: LucideIcon; badge?: "followups" };

const NAV: { label?: string; items: NavItem[] }[] = [
  { items: [{ title: "Overview", href: "/", icon: LayoutDashboard }] },
  {
    label: "Content",
    items: [
      { title: "Content Calendar", href: "/content/calendar", icon: CalendarDays },
      { title: "Content Library", href: "/content/library", icon: BookOpen },
      { title: "Analytics", href: "/content/analytics", icon: BarChart3 },
      { title: "AI Content Lab", href: "/content/lab", icon: WandSparkles },
    ],
  },
  {
    label: "Outreach",
    items: [
      { title: "Prospects", href: "/prospects", icon: Users },
      { title: "Prospect Discovery", href: "/discovery", icon: Compass },
      { title: "Outreach Inbox", href: "/inbox", icon: Inbox },
      { title: "Campaigns", href: "/campaigns", icon: Megaphone },
      { title: "Follow-ups", href: "/follow-ups", icon: Bell, badge: "followups" },
      { title: "Opportunities", href: "/opportunities", icon: Briefcase },
    ],
  },
  {
    label: "Workspace",
    items: [
      { title: "AI Growth Assistant", href: "/assistant", icon: Sparkles },
      { title: "Reports", href: "/reports", icon: FileBarChart },
      { title: "Integrations", href: "/integrations", icon: Plug },
      { title: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({ followUpsDue, isDemo, businessName }: { followUpsDue: number; isDemo: boolean; businessName: string | null }) {
  const pathname = usePathname();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <LogoMark />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">Growth OS</span>
                  <span className="truncate text-xs text-muted-foreground">{businessName ?? "Your workspace"}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((group, i) => (
          <SidebarGroup key={group.label ?? i} className="py-1">
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(pathname, item.href)}
                      tooltip={item.title}
                      className="transition-colors data-[active=true]:[&>svg]:text-primary"
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.badge === "followups" && followUpsDue > 0 && (
                      <SidebarMenuBadge className="num rounded-full bg-brand/12 text-brand peer-hover/menu-button:text-brand peer-data-active/menu-button:text-brand" aria-label={`${followUpsDue} due`}>
                        {followUpsDue}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      {isDemo && (
        <SidebarFooter className="group-data-[collapsible=icon]:hidden">
          <div className="rounded-md border border-dashed bg-background p-3 text-xs text-muted-foreground">
            <Badge variant="outline" className="mb-1.5">
              Demo workspace
            </Badge>
            <p>Sample data for exploring the app. Nothing here is real or connected to production.</p>
          </div>
        </SidebarFooter>
      )}
      <SidebarRail />
    </Sidebar>
  );
}
