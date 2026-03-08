import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import {
	deleteSkill,
	installSkillFromRegistry,
	listSkills,
	searchSkills,
} from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

export function useSkills() {
	return useSuspenseQuery({
		queryKey: queryKeys.skills.all,
		queryFn: listSkills,
	});
}

export function useSkillSearch(query: string) {
	return useQuery({
		queryKey: queryKeys.skills.search(query),
		queryFn: () => searchSkills({ query, limit: 10 }),
		enabled: query.trim().length >= 2,
		staleTime: 60 * 1000, // 1 minute
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

export function useInstallSkill() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ source, skill }: { source: string; skill: string }) =>
			installSkillFromRegistry({ source, skill }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.skills.all,
			});
		},
	});
}

