import agy from "./agy";
import amp from "./amp";
import claude from "./claude";
import cline from "./cline";
import codex from "./codex";
import copilot from "./copilot";
import cursor from "./cursor";
import devin from "./devin";
import droid from "./droid";
import gemini from "./gemini";
import grok from "./grok";
import hermes from "./hermes";
import kilo from "./kilo";
import kimi from "./kimi";
import kiro from "./kiro";
import opencode from "./opencode";
import pi from "./pi";
import qodercli from "./qodercli";
import type { Manifest } from "../types";

// Ported from ogulcancelik/herdr@48d5864 src/detect/manifests/*.toml.
export const MANIFESTS: Manifest[] = [
	codex,
	claude,
	opencode,
	amp,
	agy,
	cline,
	cursor,
	devin,
	droid,
	gemini,
	copilot,
	grok,
	hermes,
	kilo,
	kimi,
	kiro,
	pi,
	qodercli,
];
