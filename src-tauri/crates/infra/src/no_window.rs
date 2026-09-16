use std::ffi::OsStr;
use std::process::Command;

/// Create a `Command` that won't open a console window on Windows.
///
/// On non-Windows platforms this is identical to `Command::new`.
pub fn command_without_windows_console(program: impl AsRef<OsStr>) -> Command {
	#[cfg(target_os = "windows")]
	{
		windows_no_window_command(program.as_ref())
	}

	#[cfg(not(target_os = "windows"))]
	{
		Command::new(program)
	}
}

#[cfg(target_os = "windows")]
fn windows_no_window_command(program: &OsStr) -> Command {
	use std::os::windows::process::CommandExt;

	let mut command = Command::new(program);
	command.creation_flags(0x08000000); // CREATE_NO_WINDOW
	command
}
