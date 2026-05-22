use std::process::Command;

/// Create a `Command` that won't open a console window on Windows.
///
/// On non-Windows platforms this is identical to `Command::new`.
pub fn command_without_windows_console(program: &str) -> Command {
	#[cfg(target_os = "windows")]
	{
		windows_no_window_command(program)
	}

	#[cfg(not(target_os = "windows"))]
	{
		Command::new(program)
	}
}

#[cfg(target_os = "windows")]
fn windows_no_window_command(program: &str) -> Command {
	use std::os::windows::process::CommandExt;

	let mut command = Command::new(program);
	command.creation_flags(0x08000000); // CREATE_NO_WINDOW
	command
}
