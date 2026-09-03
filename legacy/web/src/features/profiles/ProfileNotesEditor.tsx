import { useCallback, useEffect, useRef, useState } from "react";
import type { Profile } from "@/generated";
import MarkdownEditor, {
  type MarkdownEditorSaveStatus } from
"@/features/markdown/MarkdownEditor";
import { useUpdateProfileNotes } from "@/features/profiles/hooks";
import * as m from "@/paraglide/messages.js";import { toast } from "sonner";


interface ProfileNotesEditorProps {
  profile: Profile;
}

export default function ProfileNotesEditor({
  profile
}: ProfileNotesEditorProps) {
  const updateNotes = useUpdateProfileNotes();
  const [saveStatus, setSaveStatus] = useState<MarkdownEditorSaveStatus>("idle");
  const updateNotesRef = useRef(updateNotes);
  const profileIdRef = useRef(profile.id);
  const lastSavedMarkdownRef = useRef(profile.notes);
  const latestSaveRevisionRef = useRef(0);
  const saveStatusRef = useRef<MarkdownEditorSaveStatus>("idle");
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    updateNotesRef.current = updateNotes;
  }, [updateNotes]);

  const setSaveStatusIfChanged = useCallback((status: MarkdownEditorSaveStatus) => {
    if (saveStatusRef.current === status) return;
    saveStatusRef.current = status;
    setSaveStatus(status);
  }, []);

  useEffect(() => {
    if (profileIdRef.current === profile.id) return;
    profileIdRef.current = profile.id;
    lastSavedMarkdownRef.current = profile.notes;
    latestSaveRevisionRef.current = 0;
    saveStatusRef.current = "idle";
    if (saveStatusTimerRef.current) {
      clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = null;
    }
  }, [profile.id, profile.notes]);

  useEffect(() => {
    return () => {
      if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    };
  }, []);

  const handleMarkdownChange = useCallback(
    (markdown: string) => {
      if (markdown === lastSavedMarkdownRef.current) return;

      const saveRevision = latestSaveRevisionRef.current + 1;
      latestSaveRevisionRef.current = saveRevision;
      setSaveStatusIfChanged("saving");
      updateNotesRef.current.mutate(
        { id: profileIdRef.current, notes: markdown },
        {
          onSuccess: (updatedProfile) => {
            if (saveRevision !== latestSaveRevisionRef.current) return;
            lastSavedMarkdownRef.current = updatedProfile.notes;
            setSaveStatusIfChanged("saved");
            if (saveStatusTimerRef.current) {
              clearTimeout(saveStatusTimerRef.current);
            }
            saveStatusTimerRef.current = setTimeout(() => {
              setSaveStatusIfChanged("idle");
              saveStatusTimerRef.current = null;
            }, 1600);
          },
          onError: () => {
            if (saveRevision !== latestSaveRevisionRef.current) return;
            setSaveStatusIfChanged("failed");
            toast.error(
              m.notesSaveFailedTitle());


          }
        }
      );
    },
    [setSaveStatusIfChanged]
  );

  return (
    <MarkdownEditor
      editorKey={profile.id}
      initialMarkdown={profile.notes}
      onMarkdownChange={handleMarkdownChange}
      placeholder={m.notesPlaceholder()}
      saveStatus={saveStatus} />);


}
