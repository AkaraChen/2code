import { invoke } from "@tauri-apps/api/core";

export const ptyApi = {
  createSession: (shell: string, rows: number, cols: number) =>
    invoke<string>("create_pty_session", { shell, rows, cols }),

  write: (sessionId: string, data: string) =>
    invoke<void>("write_to_pty", { sessionId, data }),

  resize: (sessionId: string, rows: number, cols: number) =>
    invoke<void>("resize_pty", { sessionId, rows, cols }),

  close: (sessionId: string) =>
    invoke<void>("close_pty_session", { sessionId }),
};
