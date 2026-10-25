export const LAB_MODES = {
  ideas_from_pillars: "Post ideas from pillars",
  ideas_from_performance: "Ideas from what performed",
  project_angles: "Turn a project into angles",
  linkedin_post: "LinkedIn post",
  x_post: "X post",
  x_thread: "X thread",
  repurpose: "Repurpose existing post",
  rewrite_hook: "Rewrite the hook",
  improve_clarity: "Improve clarity",
  alt_ctas: "Alternative CTAs",
  teardown_post: "Landing page teardown → post",
  lesson_post: "Design lesson → educational post",
  content_series: "Content series",
  weekly_plan: "Weekly content plan",
} as const;
export type LabMode = keyof typeof LAB_MODES;
