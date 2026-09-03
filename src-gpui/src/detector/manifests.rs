//! Rule tables ported from `src/features/terminal/detector/rules/*.ts`.

use super::{Gate, Manifest, Region, Rule, Semantic};
use crate::state::AgentKind;

const fn c(contains: &'static [&'static str]) -> Gate {
	Gate {
		contains,
		..Gate::EMPTY
	}
}

const fn r(regex: &'static [&'static str]) -> Gate {
	Gate { regex, ..Gate::EMPTY }
}

const fn l(line_regex: &'static [&'static str]) -> Gate {
	Gate {
		line_regex,
		..Gate::EMPTY
	}
}

macro_rules! rule {
	($id:literal, $state:ident, $pri:expr, $region:expr, $gate:expr) => {
		Rule {
			id: $id,
			state: Semantic::$state,
			priority: $pri,
			region: $region,
			visible_idle: false,
			skip_state: false,
			gate: $gate,
		}
	};
	($id:literal, $state:ident, $pri:expr, $region:expr, $gate:expr, visible_idle) => {
		Rule {
			id: $id,
			state: Semantic::$state,
			priority: $pri,
			region: $region,
			visible_idle: true,
			skip_state: false,
			gate: $gate,
		}
	};
	($id:literal, $state:ident, $pri:expr, $region:expr, $gate:expr, skip_state) => {
		Rule {
			id: $id,
			state: Semantic::$state,
			priority: $pri,
			region: $region,
			visible_idle: false,
			skip_state: true,
			gate: $gate,
		}
	};
}

pub const MANIFESTS: &[Manifest] = &[
	CLAUDE, CODEX, OPENCODE, AMP, AGY, CLINE, CURSOR, DEVIN, DROID, GEMINI, COPILOT, GROK, HERMES, KILO, KIMI, KIRO,
	PI, QODER,
];

const CLAUDE: Manifest = Manifest {
	id: AgentKind::Claude,
	aliases: &["claude-code"],
	rules: &[
		rule!(
			"osc_title_working",
			Working,
			1100,
			Region::OscTitle,
			r(&[r"^[\u{2800}-\u{28FF}] "])
		),
		rule!(
			"live_blocked_form",
			Blocked,
			980,
			Region::AfterLastHorizontalRule,
			Gate {
				contains: &["enter to select", "esc to cancel"],
				any: &[
					c(&["tab/arrow keys to navigate"]),
					c(&["arrow keys to navigate"]),
					c(&["arrows to navigate"]),
					c(&["↑/↓ to navigate"]),
					c(&["↑↓ to navigate"]),
				],
				..Gate::EMPTY
			}
		),
		rule!(
			"dynamic_workflow_prompt",
			Blocked,
			980,
			Region::WholeRecent,
			c(&["run a dynamic workflow?", "esc to cancel"])
		),
		rule!(
			"live_prompt_box",
			Idle,
			950,
			Region::PromptBoxBody,
			Gate {
				line_regex: &[r"^\s*❯"],
				not: &[
					c(&["enter to select"]),
					c(&["esc to cancel"]),
					c(&["tab/arrow keys"]),
					c(&["arrow keys to navigate"]),
					c(&["↑/↓ to navigate"]),
				],
				..Gate::EMPTY
			},
			visible_idle
		),
		rule!(
			"bash_permission_prompt",
			Blocked,
			850,
			Region::WholeRecent,
			Gate {
				contains: &["do you want to proceed?"],
				any: &[
					c(&["bash command"]),
					c(&["bash("]),
					c(&["contains expansion"]),
					c(&["tab to amend"]),
					c(&["ctrl+e to explain"]),
				],
				all: &[Gate {
					any: &[
						l(&[r"^\s*(?:❯\s*)?yes\b"]),
						l(&[r"^\s*1\.\s*yes\b"]),
						l(&[r"^\s*2\.\s*no\b"]),
					],
					..Gate::EMPTY
				}],
				..Gate::EMPTY
			}
		),
		rule!(
			"generic_permission_prompt",
			Blocked,
			840,
			Region::AfterLastHorizontalRule,
			Gate {
				contains: &["do you want to proceed?", "esc to cancel"],
				all: &[Gate {
					any: &[
						l(&[r"^\s*(?:❯\s*)?1\.\s*yes\b"]),
						l(&[r"^\s*2\.\s*yes\b"]),
						l(&[r"^\s*2\.\s*no\b"]),
						l(&[r"^\s*3\.\s*no\b"]),
					],
					..Gate::EMPTY
				}],
				..Gate::EMPTY
			}
		),
		rule!(
			"legacy_no_prompt_blocker",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				any: &[
					Gate {
						contains: &["do you want to"],
						any: &[c(&["yes"]), c(&["❯"])],
						..Gate::EMPTY
					},
					Gate {
						contains: &["would you like to"],
						any: &[c(&["yes"]), c(&["❯"])],
						..Gate::EMPTY
					},
					c(&["waiting for permission"]),
					c(&["do you want to allow this connection?"]),
					c(&["tab to amend"]),
					c(&["ctrl+e to explain"]),
					c(&["do you want to proceed?", "esc to cancel"]),
					c(&["review your answers"]),
					c(&["skip interview and plan immediately"]),
				],
				not: &[r(&[r"^\s*❯\s*$"])],
				..Gate::EMPTY
			}
		),
		rule!(
			"osc_title_idle",
			Idle,
			250,
			Region::OscTitle,
			r(&[r"^\u{2733} "]),
			visible_idle
		),
		rule!("osc_progress_idle", Idle, 250, Region::OscProgress, r(&[r"^4;0"])),
	],
};

const CODEX: Manifest = Manifest {
	id: AgentKind::Codex,
	aliases: &[],
	rules: &[
		rule!(
			"osc_title_blocked",
			Blocked,
			1100,
			Region::OscTitle,
			c(&["Action Required"])
		),
		rule!(
			"osc_title_working",
			Working,
			1050,
			Region::OscTitle,
			r(&[r"^[\u{2800}-\u{28FF}] "])
		),
		rule!(
			"live_strong_blocker",
			Blocked,
			900,
			Region::AfterLastPromptMarker,
			Gate {
				any: &[
					c(&["press enter to confirm or esc to cancel"]),
					c(&["enter to submit answer"]),
					c(&["enter to submit all"]),
					c(&["allow command?"]),
				],
				..Gate::EMPTY
			}
		),
		rule!(
			"weak_blocker",
			Blocked,
			600,
			Region::WholeRecent,
			Gate {
				any: &[
					c(&["[y/n]"]),
					c(&["yes (y)"]),
					Gate {
						contains: &["do you want to"],
						any: &[c(&["yes"]), c(&["❯"])],
						..Gate::EMPTY
					},
					Gate {
						contains: &["would you like to"],
						any: &[c(&["yes"]), c(&["❯"])],
						..Gate::EMPTY
					},
				],
				..Gate::EMPTY
			}
		),
		rule!(
			"osc_title_idle",
			Idle,
			100,
			Region::OscTitle,
			Gate {
				regex: &[r"\S"],
				not: &[r(&[r"^[\u{2800}-\u{28FF}]"]), c(&["Action Required"])],
				..Gate::EMPTY
			},
			visible_idle
		),
	],
};

const OPENCODE: Manifest = Manifest {
	id: AgentKind::OpenCode,
	aliases: &["open-code"],
	rules: &[
		rule!(
			"permission_required",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				any: &[
					c(&["△ Permission required"]),
					Gate {
						contains: &["esc dismiss"],
						any: &[c(&["enter confirm"]), c(&["enter submit"]), c(&["enter toggle"])],
						all: &[Gate {
							any: &[c(&["↑↓ select"]), c(&["⇆ tab"])],
							..Gate::EMPTY
						}],
						..Gate::EMPTY
					},
				],
				..Gate::EMPTY
			}
		),
		rule!(
			"interrupt_hint_working",
			Working,
			110,
			Region::WholeRecent,
			Gate {
				any: &[
					c(&["esc to interrupt"]),
					c(&["ctrl+c to interrupt"]),
					c(&["press esc to interrupt"]),
				],
				..Gate::EMPTY
			}
		),
		rule!(
			"progress_bar_working",
			Working,
			100,
			Region::WholeRecent,
			r(&["(■|⬝){4,}"])
		),
	],
};

const AMP: Manifest = Manifest {
	id: AgentKind::Amp,
	aliases: &["amp-local"],
	rules: &[
		rule!(
			"approval_footer",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				any: &[
					c(&["waiting for approval"]),
					c(&["invoke tool"]),
					c(&["run this command?"]),
					c(&["allow editing file:"]),
					c(&["allow creating file:"]),
					c(&["confirm tool call"]),
					Gate {
						contains: &["approve"],
						any: &[
							c(&["allow all for this session"]),
							c(&["allow all for every session"]),
							c(&["allow file for every session"]),
							c(&["deny with feedback"]),
						],
						..Gate::EMPTY
					},
				],
				..Gate::EMPTY
			}
		),
		rule!(
			"esc_cancel_working",
			Working,
			100,
			Region::WholeRecent,
			c(&["esc to cancel"])
		),
	],
};

const AGY: Manifest = Manifest {
	id: AgentKind::Agy,
	aliases: &["antigravity", "antigravity-cli"],
	rules: &[
		rule!(
			"permission_prompt",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				contains: &["requesting permission for:"],
				any: &[c(&["do you want to proceed?"]), c(&["tab amend", "edit command"])],
				..Gate::EMPTY
			}
		),
		rule!(
			"spinner_working",
			Working,
			100,
			Region::WholeRecent,
			l(&[r"^\s*[\u{2800}-\u{28FF}]+\s+\p{Alphabetic}+(?:[\d_]\w*)?ing\b"])
		),
		rule!(
			"background_tasks_working",
			Working,
			90,
			Region::BottomNonEmpty(5),
			l(&[r"·\s*[1-9]\d*\s+task"])
		),
	],
};

const CLINE: Manifest = Manifest {
	id: AgentKind::Cline,
	aliases: &[],
	rules: &[
		rule!(
			"tool_permission",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				any: &[
					c(&["let cline use this tool"]),
					c(&["[act mode]", "execute command?", "yes"]),
					c(&["[act mode]", "use this tool?", "yes"]),
					c(&["[plan mode]", "execute command?", "yes"]),
					c(&["[plan mode]", "use this tool?", "yes"]),
				],
				..Gate::EMPTY
			}
		),
		rule!(
			"default_cline_working",
			Working,
			-10,
			Region::WholeRecent,
			r(&[r"[\s\S]+"])
		),
	],
};

const CURSOR: Manifest = Manifest {
	id: AgentKind::Cursor,
	aliases: &["cursor-agent"],
	rules: &[
		rule!(
			"write_file_approval",
			Blocked,
			320,
			Region::BottomNonEmpty(8),
			Gate {
				contains: &["write to this file?", "proceed (y)"],
				any: &[
					c(&["reject & propose changes"]),
					c(&["esc or n or p"]),
					c(&["add write("]),
				],
				..Gate::EMPTY
			}
		),
		rule!(
			"approval_prompt",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				any: &[
					Gate {
						contains: &["waiting for approval", "run this command?"],
						any: &[c(&["run (once) (y)"]), c(&["skip (esc or n)"])],
						..Gate::EMPTY
					},
					c(&["(y) (enter)"]),
					l(&[r"^\s*allow .*\(y\)"]),
					c(&["keep (n)"]),
					c(&["skip (esc or n)"]),
					c(&["(y)", "allow"]),
					c(&["(y)", "run (once)"]),
				],
				..Gate::EMPTY
			}
		),
		rule!(
			"stop_hint_working",
			Working,
			100,
			Region::BottomNonEmpty(6),
			c(&["ctrl+c to stop"])
		),
		rule!(
			"background_task_status_working",
			Working,
			95,
			Region::BottomNonEmpty(5),
			l(&[r"\b[1-9]\d*\s+background\s+tasks?\b"])
		),
		rule!(
			"spinner_working",
			Working,
			90,
			Region::BottomNonEmpty(8),
			l(&[r"^\s*(⬡|⬢|[\u{2800}-\u{28FF}]+)\s+\p{Alphabetic}"])
		),
	],
};

const DEVIN: Manifest = Manifest {
	id: AgentKind::Devin,
	aliases: &["devin-cli", "devin cli"],
	rules: &[
		rule!(
			"workspace_trust_prompt",
			Blocked,
			300,
			Region::BottomNonEmpty(8),
			c(&[
				"do you trust the authors of this directory?",
				"with untrusted content.",
				"yes, trust ",
			])
		),
		rule!(
			"permission_prompt",
			Blocked,
			290,
			Region::BottomNonEmpty(8),
			c(&["approve once", "select", "confirm", "esc cancel"])
		),
		rule!(
			"running_tools_footer",
			Working,
			200,
			Region::BottomNonEmpty(8),
			Gate {
				contains: &["running tools", "esc to interrupt"],
				not: &[c(&["approve once", "esc cancel"])],
				..Gate::EMPTY
			}
		),
		rule!(
			"guide_while_working",
			Working,
			190,
			Region::BottomNonEmpty(6),
			Gate {
				contains: &["guide devin while it works"],
				not: &[c(&["approve once", "esc cancel"])],
				..Gate::EMPTY
			}
		),
		rule!(
			"welcome_prompt_footer",
			Idle,
			120,
			Region::BottomNonEmpty(8),
			Gate {
				contains: &["ask devin to build", "features, fix bugs", "your code"],
				line_regex: &[r"^\s*❭ Ask Devin to build"],
				not: &[
					c(&["approve once", "esc cancel"]),
					c(&["running tools", "esc to interrupt"]),
				],
				..Gate::EMPTY
			},
			visible_idle
		),
		rule!(
			"live_prompt_footer",
			Idle,
			100,
			Region::BottomNonEmpty(6),
			Gate {
				contains: &["context:"],
				line_regex: &[r"^\s*❭"],
				not: &[
					c(&["approve once", "esc cancel"]),
					c(&["running tools", "esc to interrupt"]),
				],
				..Gate::EMPTY
			},
			visible_idle
		),
	],
};

const DROID: Manifest = Manifest {
	id: AgentKind::Droid,
	aliases: &["factory droid"],
	rules: &[
		rule!(
			"execute_selection_blocker",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				contains: &["enter to select", "esc to cancel"],
				any: &[c(&["↑↓ to navigate"]), c(&["use ↑↓ to navigate"])],
				all: &[Gate {
					any: &[c(&["> yes, allow"]), c(&["> no, cancel"])],
					..Gate::EMPTY
				}],
				..Gate::EMPTY
			}
		),
		rule!(
			"selection_menu_blocker",
			Blocked,
			290,
			Region::BottomNonEmpty(8),
			Gate {
				contains: &["enter select", "esc cancel"],
				any: &[c(&["↑/↓ navigate"]), c(&["↑↓ navigate"])],
				..Gate::EMPTY
			}
		),
		rule!(
			"spinner_stop_working",
			Working,
			110,
			Region::WholeRecent,
			Gate {
				contains: &["esc to stop"],
				line_regex: &[r"^\s*[\u{2800}-\u{28FF}]"],
				..Gate::EMPTY
			}
		),
		rule!(
			"stop_hint_working",
			Working,
			100,
			Region::WholeRecent,
			c(&["esc to stop"])
		),
	],
};

const GEMINI: Manifest = Manifest {
	id: AgentKind::Gemini,
	aliases: &[],
	rules: &[
		rule!(
			"apply_or_allow_change",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				any: &[
					c(&["│ Apply this change"]),
					c(&["│ Allow execution"]),
					Gate {
						all: &[c(&["yes"])],
						any: &[
							c(&["waiting for user confirmation"]),
							c(&["│ Do you want to proceed"]),
							c(&["do you want to proceed?"]),
						],
						..Gate::EMPTY
					},
					l(&[r"^\s*❯.*(yes|allow)"]),
				],
				..Gate::EMPTY
			}
		),
		rule!(
			"esc_cancel_working",
			Working,
			100,
			Region::WholeRecent,
			c(&["esc to cancel"])
		),
	],
};

const COPILOT: Manifest = Manifest {
	id: AgentKind::Copilot,
	aliases: &["github-copilot", "github copilot", "ghcs"],
	rules: &[
		rule!(
			"selection_blocker",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				all: &[
					Gate {
						any: &[c(&["esc to cancel"]), c(&["esc cancel"])],
						..Gate::EMPTY
					},
					Gate {
						any: &[
							c(&["enter to select"]),
							c(&["enter to confirm"]),
							c(&["enter to submit"]),
							c(&["enter accept"]),
						],
						..Gate::EMPTY
					},
				],
				..Gate::EMPTY
			}
		),
		rule!(
			"working_cancel_hint",
			Working,
			100,
			Region::WholeRecent,
			Gate {
				any: &[c(&["esc to cancel"]), c(&["esc cancel"]), c(&["esc again to cancel"]),],
				..Gate::EMPTY
			}
		),
	],
};

const GROK: Manifest = Manifest {
	id: AgentKind::Grok,
	aliases: &["grok-build"],
	rules: &[
		rule!(
			"permission_scope_selector",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				contains: &["yes, proceed", "no, reject"],
				any: &[c(&["use ← → to choose permission whitelist scope"]), c(&["←/→:scope"]),],
				..Gate::EMPTY
			}
		),
		rule!(
			"waiting_tool_working",
			Working,
			120,
			Region::WholeRecent,
			Gate {
				any: &[
					Gate {
						all: &[c(&["ctrl+c:cancel", "ctrl+enter:interject"]), c(&["waiting"]),],
						..Gate::EMPTY
					},
					l(&[r"^\s*[\u{2800}-\u{28FF}]\s+(Run|Read|Search|List)\b"]),
				],
				..Gate::EMPTY
			}
		),
	],
};

const HERMES: Manifest = Manifest {
	id: AgentKind::Hermes,
	aliases: &["hermes-agent"],
	rules: &[
		rule!(
			"dangerous_command_approval",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				any: &[
					c(&["dangerous command"]),
					c(&["allow once", "allow for this session", "deny"]),
				],
				all: &[Gate {
					any: &[
						c(&["enter to confirm"]),
						c(&["↑/↓ to select"]),
						c(&["show full command"]),
					],
					..Gate::EMPTY
				}],
				..Gate::EMPTY
			}
		),
		rule!(
			"interrupt_status_working",
			Working,
			100,
			Region::WholeRecent,
			Gate {
				any: &[c(&["msg=interrupt"]), c(&["ctrl+c cancel"])],
				..Gate::EMPTY
			}
		),
	],
};

const KILO: Manifest = Manifest {
	id: AgentKind::Kilo,
	aliases: &["kilo-code", "kilo code"],
	rules: &[
		rule!(
			"opencode_permission",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				any: &[c(&["△ Permission required"]), c(&["esc dismiss", "enter confirm"])],
				..Gate::EMPTY
			}
		),
		rule!(
			"esc_interrupt_working",
			Working,
			100,
			Region::WholeRecent,
			c(&["esc interrupt"])
		),
	],
};

const KIMI: Manifest = Manifest {
	id: AgentKind::Kimi,
	aliases: &["kimi-code", "kimi code"],
	rules: &[
		rule!(
			"current_approval_panel",
			Blocked,
			400,
			Region::WholeRecent,
			Gate {
				contains: &["↵ confirm"],
				any: &[
					c(&["run this command?"]),
					c(&["write this file?"]),
					c(&["apply these edits?"]),
					c(&["stop this task?"]),
					c(&["ready to build with this plan?"]),
				],
				all: &[
					c(&[" choose"]),
					Gate {
						any: &[c(&["approve"]), c(&["reject"]), c(&["revise"])],
						..Gate::EMPTY
					},
				],
				..Gate::EMPTY
			}
		),
		rule!(
			"legacy_approval_panel",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				contains: &["requesting approval", "reject"],
				any: &[c(&["approve once"]), c(&["approve for this session"])],
				..Gate::EMPTY
			}
		),
		rule!(
			"moon_spinner_working",
			Working,
			100,
			Region::WholeRecent,
			l(&[r"^\s*([🌕🌖🌗🌘🌑🌒🌓🌔])\s*$"])
		),
		rule!(
			"braille_spinner_working",
			Working,
			90,
			Region::WholeRecent,
			l(&[r"^\s*[\u{2800}-\u{28FF}]+\s*(thinking\.\.\.|working\.\.\.|using )"])
		),
	],
};

const KIRO: Manifest = Manifest {
	id: AgentKind::Kiro,
	aliases: &["kiro-cli"],
	rules: &[
		rule!(
			"tool_approval",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				contains: &["requires approval"],
				any: &[
					c(&["yes, single permission"]),
					c(&["trust, always allow"]),
					c(&["no (tab to edit)"]),
					c(&["esc to close"]),
				],
				..Gate::EMPTY
			}
		),
		rule!(
			"subagent_approval",
			Blocked,
			290,
			Region::WholeRecent,
			Gate {
				contains: &["pending from subagents"],
				any: &[c(&["tool approval"]), c(&["tool approvals"])],
				all: &[Gate {
					any: &[
						c(&["approve all pending"]),
						c(&["configure individually"]),
						c(&["exit (cancel subagents)"]),
					],
					..Gate::EMPTY
				}],
				..Gate::EMPTY
			}
		),
		rule!(
			"kiro_working_marker",
			Working,
			100,
			Region::WholeRecent,
			c(&["kiro is working"])
		),
		rule!(
			"tool_spinner_working",
			Working,
			90,
			Region::WholeRecent,
			Gate {
				contains: &["esc to cancel"],
				line_regex: &[r"^\s*([◔◑◕●])\s+\p{Alphabetic}"],
				..Gate::EMPTY
			}
		),
	],
};

const PI: Manifest = Manifest {
	id: AgentKind::Pi,
	aliases: &["pi agent"],
	rules: &[rule!(
		"working_literal",
		Working,
		100,
		Region::WholeRecent,
		c(&["Working..."])
	)],
};

const QODER: Manifest = Manifest {
	id: AgentKind::Qoder,
	aliases: &["qoderclicn", "qoder", "qodercn"],
	rules: &[
		rule!(
			"confirmation_or_input_blocker",
			Blocked,
			300,
			Region::WholeRecent,
			Gate {
				any: &[
					Gate {
						contains: &["waiting for user confirmation"],
						any: &[c(&["yes"]), c(&["no"]), c(&["allow"]), c(&["reject"])],
						..Gate::EMPTY
					},
					c(&["permission required"]),
					c(&["allow once or always?"]),
					c(&["asking user"]),
					c(&["enter your response"]),
					c(&["review your answers:"]),
					c(&["shell awaiting input"]),
				],
				..Gate::EMPTY
			}
		),
		rule!(
			"cancel_hint_working",
			Working,
			100,
			Region::WholeRecent,
			c(&["(esc to cancel,"])
		),
		rule!(
			"spinner_working",
			Working,
			90,
			Region::WholeRecent,
			l(&[r"^\s*[\u{2800}-\u{28FF}]\s+(?:\S.*)?\p{Alphabetic}"])
		),
	],
};
