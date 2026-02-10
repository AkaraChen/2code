import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

export default function TitleBar() {
  return (
    <div
      className="h-[38px] flex items-center px-3 bg-[var(--cds-layer)] select-none [-webkit-app-region:drag]"
      data-tauri-drag-region
      onDoubleClick={() => appWindow.toggleMaximize()}
    >
      <div className="group flex gap-2 [-webkit-app-region:no-drag]">
        <button
          className="size-3 rounded-full border-none p-0 flex items-center justify-center cursor-pointer text-transparent transition-colors duration-100 group-hover:text-black/50 dark:group-hover:text-white/50 bg-[#ff5f57]"
          onClick={() => appWindow.close()}
        >
          <svg className="size-1.5" viewBox="0 0 8 8">
            <path
              d="M1 1L7 7M7 1L1 7"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          className="size-3 rounded-full border-none p-0 flex items-center justify-center cursor-pointer text-transparent transition-colors duration-100 group-hover:text-black/50 dark:group-hover:text-white/50 bg-[#febc2e]"
          onClick={() => appWindow.minimize()}
        >
          <svg className="size-1.5" viewBox="0 0 8 2">
            <path
              d="M1 1H7"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          className="size-3 rounded-full border-none p-0 flex items-center justify-center cursor-pointer text-transparent transition-colors duration-100 group-hover:text-black/50 dark:group-hover:text-white/50 bg-[#28c840]"
          onClick={() => appWindow.toggleMaximize()}
        >
          <svg className="size-1.5" viewBox="0 0 8 8">
            <path
              d="M1 1L4 4L7 1M1 7L4 4L7 7"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
