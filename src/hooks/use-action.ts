"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/action";

/** Runs a server action in a transition and reports the outcome with a toast. */
export function useAction() {
  const [pending, startTransition] = useTransition();
  function run<T>(
    fn: () => Promise<ActionResult<T>>,
    opts: { success?: string | ((data: T) => string | null); onSuccess?: (data: T) => void; onError?: (error: string, fieldErrors?: Record<string, string[] | undefined>) => void } = {},
  ) {
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          const msg = typeof opts.success === "function" ? opts.success(res.data) : opts.success;
          if (msg) toast.success(msg);
          opts.onSuccess?.(res.data);
        } else {
          toast.error(res.error);
          opts.onError?.(res.error, res.fieldErrors);
        }
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }
  return { pending, run };
}
