# service/src/pty.rs — create_session 函数需要改的部分
# 
# 原来的代码 (lines 271-289):
# ============================================================

	// 3. Prepare shell init directory (graceful degradation on failure)
	let init_dir =
		infra::shell_init::prepare_init_dir(&session_id, &project_init_scripts);
	if let Err(ref e) = init_dir {
		tracing::warn!(target: "pty", "Failed to prepare init dir: {e}");
	}

	// 4. Create PTY session
	let reader = session::create_session(
		&ctx.sessions,
		&session_id,
		&config.shell,
		&config.cwd,
		config.rows,
		config.cols,
		init_dir.as_deref().ok(),
		ctx.helper_url.as_deref(),
		ctx.helper_bin.as_deref(),
	)?;

# ============================================================
# 改成:
# ============================================================

	// 3. Detect shell type and prepare injection
	let shell_type = infra::shell_init::detect_shell_type(&config.shell);
	let injection = infra::shell_init::prepare_shell_injection(
		&session_id,
		shell_type,
		&project_init_scripts,
	);
	let injection = match injection {
		Ok(inj) => inj,
		Err(e) => {
			tracing::warn!(target: "pty", "Failed to prepare shell injection: {e}");
			infra::shell_init::ShellInjection::None
		}
	};

	// 4. Create PTY session
	let reader = session::create_session(
		&ctx.sessions,
		&session_id,
		&config.shell,
		&config.cwd,
		config.rows,
		config.cols,
		&injection,
		ctx.helper_url.as_deref(),
		ctx.helper_bin.as_deref(),
	)?;

# ============================================================
# restore_session 函数里也有类似的调用，同理改法。
