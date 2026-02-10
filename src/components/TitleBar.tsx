import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

export default function TitleBar() {
  return (
    <div
      className="titlebar"
      data-tauri-drag-region
      onDoubleClick={() => appWindow.toggleMaximize()}
    >
      <div className="titlebar-buttons">
        <button
          className="titlebar-button close"
          onClick={() => appWindow.close()}
        >
          <svg width="8" height="8" viewBox="0 0 8 8">
            <path
              d="M1 1L7 7M7 1L1 7"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          className="titlebar-button minimize"
          onClick={() => appWindow.minimize()}
        >
          <svg width="8" height="2" viewBox="0 0 8 2">
            <path
              d="M1 1H7"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          className="titlebar-button maximize"
          onClick={() => appWindow.toggleMaximize()}
        >
          <svg width="8" height="8" viewBox="0 0 8 8">
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
