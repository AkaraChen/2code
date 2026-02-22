import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import {
	createSkill,
	deleteSkill,
	listSkills,
	updateSkill,
} from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

export function useSkills() {
	return useSuspenseQuery({
		queryKey: queryKeys.skills.all,
		queryFn: listSkills,
	});
}

export function useCreateSkill() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (args: {
			name: string;
			description: string;
			content: string;
		}) => createSkill(args),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.skills.all,
			});
		},
	});
}

export function useUpdateSkill() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (args: {
			name: string;
			description?: string;
			content?: string;
		}) => updateSkill(args),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.skills.all,
			});
		},
	});
}

export function useDeleteSkill() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (name: string) => deleteSkill({ name }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.skills.all,
			});
		},
	});
}
