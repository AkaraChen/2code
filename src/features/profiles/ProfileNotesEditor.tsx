import { useCallback, useEffect, useRef } from "react";
import { Box } from "@chakra-ui/react";
import {
	Milkdown,
	MilkdownProvider,
	useEditor,
} from "@milkdown/react";
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { nord } from "@milkdown/theme-nord";
import type { Profile } from "@/generated";
import { useUpdateProfileNotes } from "@/features/profiles/hooks";

interface ProfileNotesEditorProps {
	profile: Profile;
}

function MilkdownEditor({ profile }: ProfileNotesEditorProps) {
	const updateNotes = useUpdateProfileNotes();
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Clear pending save timer on unmount
	useEffect(() => {
		return () => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		};
	}, []);

	const handleChange = useCallback(
		(markdown: string) => {
			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
			}
			saveTimerRef.current = setTimeout(() => {
				updateNotes.mutate({ id: profile.id, notes: markdown });
			}, 500);
		},
		[profile.id, updateNotes],
	);

	// Only re-create the editor when the profile ID changes (not on every keystroke).
	// profile.notes is read once as the initial value; subsequent edits are handled by the listener.
	useEditor(
		(root) => {
			return Editor.make()
				.config(nord)
				.config((ctx) => {
					ctx.set(rootCtx, root);
					ctx.set(defaultValueCtx, profile.notes);
					ctx
						.get(listenerCtx)
						.markdownUpdated((_ctx, markdown) => {
							handleChange(markdown);
						});
				})
				.use(commonmark)
				.use(gfm)
				.use(history)
				.use(listener);
		},
		[profile.id],
	);

	return <Milkdown />;
}

export default function ProfileNotesEditor({
	profile,
}: ProfileNotesEditorProps) {
	return (
		<Box h="full" overflow="auto" p="4" className="milkdown-wrapper">
			<MilkdownProvider>
				<MilkdownEditor profile={profile} />
			</MilkdownProvider>
		</Box>
	);
}
