import type {
  CampaignStatus,
  Channel,
  ContentFormat,
  ContentGoal,
  ContentStatus,
  CtaType,
  EventType,
  HookStyle,
  MessageStatus,
  Platform,
  Priority,
  SourceChannel,
} from "@/db/schema";

export const PLATFORM_LABEL: Record<Platform, string> = { x: "X", linkedin: "LinkedIn" };
export const CHANNEL_LABEL: Record<Channel, string> = { email: "Email", linkedin: "LinkedIn", x: "X" };

export const FORMAT_LABEL: Record<ContentFormat, string> = {
  text: "Text",
  image: "Image",
  carousel: "Carousel",
  video: "Video",
  link: "Link",
  thread: "Thread",
};

export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  idea: "Idea",
  draft: "Draft",
  ready: "Ready",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

export const GOAL_LABEL: Record<ContentGoal, string> = {
  reach: "Reach",
  authority: "Authority",
  engagement: "Engagement",
  portfolio_traffic: "Portfolio traffic",
  leads: "Leads",
  sales: "Sales",
};

export const CTA_TYPE_LABEL: Record<CtaType, string> = {
  none: "No CTA",
  follow: "Follow",
  comment: "Comment",
  dm: "DM me",
  link: "Link click",
  booking: "Book a call",
  other: "Other",
};

export const HOOK_LABEL: Record<HookStyle, string> = {
  question: "Question",
  contrarian: "Contrarian",
  how_to: "How-to",
  story: "Story",
  list: "List",
  observation: "Observation",
  data: "Data point",
  other: "Other",
};

export const PRIORITY_LABEL: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High" };

export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  bounced: "Bounced",
  cancelled: "Cancelled",
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
};

export const SOURCE_CHANNEL_LABEL: Record<SourceChannel, string> = {
  content: "Content",
  outreach: "Outreach",
  referral: "Referral",
  inbound: "Inbound",
  other: "Other",
};

export const EVENT_LABEL: Record<EventType, string> = {
  email_sent: "Email sent",
  email_received: "Email received",
  linkedin_sent: "LinkedIn message sent",
  linkedin_received: "LinkedIn reply received",
  x_dm_sent: "X DM sent",
  x_reply_received: "X reply received",
  x_public_reply: "X public reply",
  connection_request_sent: "Connection request sent",
  profile_researched: "Profile researched",
  website_audited: "Website audited",
  follow_up_scheduled: "Follow-up scheduled",
  call_booked: "Call booked",
  note: "Note",
  status_changed: "Status changed",
  opportunity_created: "Opportunity created",
};

/** Event types the user can log manually, grouped by channel. */
export const LOGGABLE_EVENTS: { type: EventType; channel: Channel | null; direction: "outbound" | "inbound" | "internal" }[] = [
  { type: "email_sent", channel: "email", direction: "outbound" },
  { type: "email_received", channel: "email", direction: "inbound" },
  { type: "linkedin_sent", channel: "linkedin", direction: "outbound" },
  { type: "connection_request_sent", channel: "linkedin", direction: "outbound" },
  { type: "linkedin_received", channel: "linkedin", direction: "inbound" },
  { type: "x_dm_sent", channel: "x", direction: "outbound" },
  { type: "x_public_reply", channel: "x", direction: "outbound" },
  { type: "x_reply_received", channel: "x", direction: "inbound" },
  { type: "call_booked", channel: null, direction: "internal" },
  { type: "note", channel: null, direction: "internal" },
];

export const SENT_EVENT_FOR_CHANNEL: Record<Channel, EventType> = {
  email: "email_sent",
  linkedin: "linkedin_sent",
  x: "x_dm_sent",
};
