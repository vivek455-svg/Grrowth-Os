import { z } from "zod";

export const discoveryConfigSchema = z.object({
  companyType: z.string().max(200),
  industry: z.string().max(200),
  geography: z.string().max(200),
  companySize: z.string().max(100),
  decisionMakerRole: z.string().max(200),
  serviceRelevance: z.string().max(500),
  requiredEvidence: z.string().max(500),
  source: z.enum(["search_api", "csv", "manual"]),
  maxResults: z.number().int().min(1).max(50),
  searchQueries: z.array(z.string().max(200)).min(1).max(3),
});
export type DiscoveryConfig = z.infer<typeof discoveryConfigSchema>;
