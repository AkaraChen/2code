import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface Project {
  id: string;
  name: string;
  folder: string;
  created_at: string;
}

interface CreateProjectOpts {
  name?: string;
  folder?: string;
}

interface ProjectContextValue {
  projects: Project[];
  refresh: () => Promise<void>;
  createProject: (opts?: CreateProjectOpts) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<Project[]>("list_projects");
      setProjects(list);
    } catch {
      setProjects([]);
    }
  }, []);

  const createProject = useCallback(async (opts?: CreateProjectOpts) => {
    let project: Project;
    if (opts?.folder) {
      project = await invoke<Project>("create_project_from_folder", {
        name: opts.name || opts.folder.split("/").pop() || "Untitled",
        folder: opts.folder,
      });
    } else {
      project = await invoke<Project>("create_project_temporary", {
        name: opts?.name || null,
      });
    }
    await refresh();
    return project;
  }, [refresh]);

  const deleteProject = useCallback(async (id: string) => {
    await invoke("delete_project", { id });
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <ProjectContext.Provider value={{ projects, refresh, createProject, deleteProject }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjects() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjects must be used within ProjectProvider");
  return ctx;
}
