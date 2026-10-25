"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { recordFollowers } from "@/server/actions/content";
import { useAction } from "@/hooks/use-action";
import { toLocalInput } from "@/lib/format";

export function RecordFollowersButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<"linkedin" | "x">("linkedin");
  const [followers, setFollowers] = useState("");
  const [at, setAt] = useState(toLocalInput(new Date()));
  const { pending, run } = useAction();
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <Plus /> Record
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record follower count</DialogTitle>
            <DialogDescription>Growth is calculated between recorded counts. Record weekly for a useful trend.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <ToggleGroup type="single" variant="outline" value={platform} onValueChange={(v) => v && setPlatform(v as "linkedin" | "x")} className="w-full">
              <ToggleGroupItem value="linkedin" className="flex-1">LinkedIn</ToggleGroupItem>
              <ToggleGroupItem value="x" className="flex-1">X</ToggleGroupItem>
            </ToggleGroup>
            <Field>
              <FieldLabel htmlFor="rf-count">Followers</FieldLabel>
              <Input id="rf-count" type="number" min={0} value={followers} onChange={(e) => setFollowers(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="rf-at">As of</FieldLabel>
              <Input id="rf-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={pending || followers === ""}
              onClick={() =>
                run(() => recordFollowers({ platform, followers: Number(followers), capturedAt: new Date(at) }), {
                  success: "Follower count recorded",
                  onSuccess: () => {
                    setOpen(false);
                    setFollowers("");
                    router.refresh();
                  },
                })
              }
            >
              {pending && <Spinner />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
