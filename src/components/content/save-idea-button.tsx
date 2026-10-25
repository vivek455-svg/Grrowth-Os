"use client";

import { useState } from "react";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { saveIdea } from "@/server/actions/content";
import { useAction } from "@/hooks/use-action";

export function SaveIdeaButton({ pillars }: { pillars: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [pillarId, setPillarId] = useState("none");
  const { pending, run } = useAction();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Lightbulb /> Save idea
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save an idea</DialogTitle>
            <DialogDescription>Ideas stay in the library until you turn them into posts.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="idea-title">Idea</FieldLabel>
              <Input id="idea-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Teardown of a fintech pricing page" />
            </Field>
            <Field>
              <FieldLabel>Pillar</FieldLabel>
              <Select value={pillarId} onValueChange={setPillarId}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No pillar</SelectItem>
                  {pillars.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="idea-notes">Notes</FieldLabel>
              <Textarea id="idea-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={pending || !title.trim()}
              onClick={() =>
                run(() => saveIdea({ title, notes, pillarId: pillarId === "none" ? null : pillarId }), {
                  success: "Idea saved",
                  onSuccess: () => {
                    setOpen(false);
                    setTitle("");
                    setNotes("");
                  },
                })
              }
            >
              {pending && <Spinner />} Save idea
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
