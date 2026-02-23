import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { deleteSkill, listSkills } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

export function useSkills() {
	return useSuspenseQuery({
		queryKey: queryKeys.skills.all,
		queryFn: listSkills,
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
