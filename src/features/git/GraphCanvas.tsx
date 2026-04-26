// Phase 3 graph column.
//
// One Canvas per row. Paints:
//   - vertical lane lines from the previous row's edges (drawn from top
//     mid-y to mid-y) into THIS row's lane positions
//   - lane lines continuing past this row to the next (drawn from mid-y
//     to bottom) using THIS row's edges_down
//   - a colored dot at this row's lane × mid-y
//
// Color = lane index, mapped through a 12-color palette. Future work can
// swap in branching-model coloring (main = blue forever, feature = green
// per branch tip, etc.) by extending the backend's GraphRow.color field.

import { useEffect, useRef } from "react";

import type { GraphRow } from "./changesTabBindings";

const LANE_WIDTH = 14; // px between lanes
const LEFT_PADDING = 8; // px before first lane
const DOT_RADIUS = 4;
const LINE_WIDTH = 1.5;

const PALETTE = [
	"#2563eb", // blue
	"#16a34a", // green
	"#ea580c", // orange
	"#dc2626", // red
	"#9333ea", // purple
	"#0891b2", // cyan
	"#ca8a04", // yellow
	"#be185d", // pink
	"#0d9488", // teal
	"#65a30d", // lime
	"#7c3aed", // violet
	"#c2410c", // dark orange
];

function laneColor(color: number): string {
	return PALETTE[color % PALETTE.length];
}

function laneX(lane: number): number {
	return LEFT_PADDING + lane * LANE_WIDTH;
}

interface GraphCanvasProps {
	row: GraphRow;
	previousRow: GraphRow | null;
	rowHeight: number;
	width: number;
}

export default function GraphCanvas({
	row,
	previousRow,
	rowHeight,
	width,
}: GraphCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const dpr = window.devicePixelRatio ?? 1;
		canvas.width = width * dpr;
		canvas.height = rowHeight * dpr;
		canvas.style.width = `${width}px`;
		canvas.style.height = `${rowHeight}px`;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, width, rowHeight);
		ctx.lineWidth = LINE_WIDTH;
		ctx.lineCap = "round";

		const midY = rowHeight / 2;

		// Top half: draw lines from the previous row down to this row.
		// Use the previous row's edges_down — each one ends at a lane on
		// THIS row. (The first edge always ends at this row's lane.)
		if (previousRow) {
			for (const edge of previousRow.edges_down) {
				const startX = laneX(edge.from_lane);
				const endX = laneX(edge.to_lane);
				ctx.strokeStyle = laneColor(edge.to_lane);
				ctx.beginPath();
				if (startX === endX) {
					ctx.moveTo(startX, 0);
					ctx.lineTo(endX, midY);
				} else {
					// S-curve between lanes
					ctx.moveTo(startX, 0);
					ctx.bezierCurveTo(
						startX,
						midY * 0.5,
						endX,
						midY * 0.5,
						endX,
						midY,
					);
				}
				ctx.stroke();
			}
		}

		// Bottom half: this row's edges_down go to the next row's lanes.
		for (const edge of row.edges_down) {
			const startX = laneX(edge.from_lane);
			const endX = laneX(edge.to_lane);
			ctx.strokeStyle = laneColor(edge.to_lane);
			ctx.beginPath();
			if (startX === endX) {
				ctx.moveTo(startX, midY);
				ctx.lineTo(endX, rowHeight);
			} else {
				ctx.moveTo(startX, midY);
				ctx.bezierCurveTo(
					startX,
					midY + (rowHeight - midY) * 0.5,
					endX,
					midY + (rowHeight - midY) * 0.5,
					endX,
					rowHeight,
				);
			}
			ctx.stroke();
		}

		// The dot for this commit.
		const dotX = laneX(row.lane);
		ctx.fillStyle = laneColor(row.color);
		ctx.beginPath();
		ctx.arc(dotX, midY, DOT_RADIUS, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "var(--chakra-colors-bg, #fff)";
		ctx.lineWidth = 1;
		ctx.stroke();
	}, [row, previousRow, rowHeight, width]);

	return <canvas ref={canvasRef} />;
}
