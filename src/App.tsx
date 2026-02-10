import { Routes, Route, Navigate } from "react-router";
import AppSidebar from "./components/AppSidebar";
import TitleBar from "./components/TitleBar";
import HomePage from "./pages/HomePage";
import ProjectsPage from "./pages/ProjectsPage";
import SettingsPage from "./pages/SettingsPage";
import "./styles.scss";

export default function App() {
  return (
    <div className="app-container">
      <TitleBar />
      <div className="app-layout">
        <AppSidebar />
        <main className="app-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
