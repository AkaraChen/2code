// Phase 3 graph column.
//
// One Canvas per row. Paints:
//   - top half (0 → midY): from edges_up. Each edge is (lane on row above
//     → destination lane on THIS row). Pass-through lanes go straight
//     down; "branch-out" lines for fork points come into this commit's
//     lane from sibling lanes.
//   - bottom half (midY → rowHeight): from edges_down. Each edge is (lane
//     on THIS row → lane on the NEXT row). Includes parent edges and
//     pass-throughs.
//   - a colored dot at this row's lane × midY.
//
// Color = lane index, mapped through a 12-color palette.

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
	rowHeight: number;
	width: number;
}

export default function GraphCanvas({
	row,
	rowHeight,
	width,
}: GraphCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const dpr = window.devicePixelRatio ?? 1;
		// Reset transform before re-sizing — getContext('2d').scale is
		// cumulative across re-renders and would compound DPR each pass.
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		canvas.width = width * dpr;
		canvas.height = rowHeight * dpr;
		canvas.style.width = `${width}px`;
		canvas.style.height = `${rowHeight}px`;
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, width, rowHeight);
		ctx.lineWidth = LINE_WIDTH;
		ctx.lineCap = "round";

		const midY = rowHeight / 2;

		// Top half: edges_up — lines coming INTO this row from above.
		for (const edge of row.edges_up) {
			const startX = laneX(edge.from_lane);
			const endX = laneX(edge.to_lane);
			ctx.strokeStyle = laneColor(edge.to_lane);
			ctx.beginPath();
			if (startX === endX) {
				ctx.moveTo(startX, 0);
				ctx.lineTo(endX, midY);
			} else {
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

		// Bottom half: edges_down — lines leaving this row toward the next.
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

		// The dot for this commit. Use a literal background color for the
		// 1px ring (Canvas doesn't resolve CSS variables).
		const dotX = laneX(row.lane);
		ctx.fillStyle = laneColor(row.color);
		ctx.beginPath();
		ctx.arc(dotX, midY, DOT_RADIUS, 0, Math.PI * 2);
		ctx.fill();
	}, [row, rowHeight, width]);

	return <canvas ref={canvasRef} />;
}
