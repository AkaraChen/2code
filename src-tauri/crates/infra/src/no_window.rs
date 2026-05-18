use std::process::Command;

/// Create a `Command` that won't open a console window on Windows.
/// On non-Windows platforms this is identical to `Command::new`.
pub fn silent_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command
}
