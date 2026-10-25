import "server-only";
import { withUser, type Tx } from "@/db/client";
import { requireUser } from "./auth";

/** For Server Components: resolves the user and runs queries inside an RLS-scoped transaction. */
export async function loadForUser<T>(fn: (tx: Tx, user: { id: string; isDemo: boolean }) => Promise<T>): Promise<T> {
  const user = await requireUser();
  return withUser(user.id, (tx) => fn(tx, user));
}
