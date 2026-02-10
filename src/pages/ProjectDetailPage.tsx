import { useParams, Navigate } from "react-router";
import { useProjects } from "@/contexts/ProjectContext";
import TerminalTabs from "@/components/TerminalTabs";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { projects } = useProjects();

  const project = projects.find((p) => p.id === id);

  if (!project) {
    return <Navigate to="/projects" replace />;
  }

  return (
    <div className="absolute inset-0">
      <TerminalTabs />
    </div>
  );
}
