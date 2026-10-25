"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { scheduleFollowUp } from "@/server/actions/prospects";
import { useAction } from "@/hooks/use-action";

const QUICK = [3, 5, 7, 14];

export function FollowUpDialog({ prospectId, open, onOpenChange, suggestedDays }: { prospectId: string; open: boolean; onOpenChange: (o: boolean) => void; suggestedDays?: number }) {
  const router = useRouter();
  const { pending, run } = useAction();
  const at = (d: number) => {
    const x = addDays(new Date(), d);
    x.setHours(9, 0, 0, 0);
    return format(x, "yyyy-MM-dd'T'HH:mm");
  };
  const [when, setWhen] = useState(at(suggestedDays ?? 5));
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Schedule follow-up</DialogTitle>
          <DialogDescription>A reminder only — nothing is sent automatically. It's cancelled if they reply first.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((d) => (
              <Button key={d} type="button" size="xs" variant={when === at(d) ? "secondary" : "outline"} onClick={() => setWhen(at(d))}>
                In {d} days{d === suggestedDays ? " (suggested)" : ""}
              </Button>
            ))}
          </div>
          <Field>
            <FieldLabel htmlFor="fu-when">Due</FieldLabel>
            <Input id="fu-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="fu-reason">Reason</FieldLabel>
            <Input id="fu-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Share the two homepage ideas" />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={pending || !when}
            onClick={() =>
              run(() => scheduleFollowUp({ prospectId, dueAt: new Date(when), reason, suggested: false }), {
                success: "Follow-up scheduled",
                onSuccess: () => {
                  onOpenChange(false);
                  router.refresh();
                },
              })
            }
          >
            {pending && <Spinner />} Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
