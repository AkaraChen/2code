import { FolderIcon, FolderPlusIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { useProjects } from "@/features/projects/hooks";
import * as m from "@/paraglide/messages.js";

const TourOnboarding = lazy(() =>
	import("./TourOnboarding").then((module) => ({
		default: module.TourOnboarding,
	})),
);

export default function HomePage() {
	const { data: projects } = useProjects();
	const navigate = useNavigate();
	const hasNoProjects = projects.length === 0;
	const firstProjectProfilePath = useMemo(() => {
		const firstProject = projects[0];
		const defaultProfile = firstProject?.profiles.find((p) => p.is_default);
		if (!firstProject || !defaultProfile) return null;
		return `/projects/${firstProject.id}/profiles/${defaultProfile.id}`;
	}, [projects]);

	useEffect(() => {
		if (firstProjectProfilePath) {
			navigate(firstProjectProfilePath, {
				replace: true,
			});
		}
	}, [firstProjectProfilePath, navigate]);

	return (
		<div className="h-full">
			<header
				data-tauri-drag-region
				className="flex h-[52px] items-center gap-2 border-b px-5"
			>
				<FolderIcon className="size-4 text-muted-foreground" />
				<h1 className="select-none text-sm font-semibold">{m.home()}</h1>
			</header>

			{hasNoProjects ? (
				<div className="flex h-[calc(100%-52px)] items-center justify-center">
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<FolderPlusIcon />
							</EmptyMedia>
							<EmptyTitle>{m.emptyProjectsTitle()}</EmptyTitle>
							<EmptyDescription>{m.emptyProjectsDesc()}</EmptyDescription>
						</EmptyHeader>
					</Empty>
				</div>
			) : null}

			{hasNoProjects && (
				<Suspense fallback={null}>
					<TourOnboarding isEnabled />
				</Suspense>
			)}
		</div>
	);
}
