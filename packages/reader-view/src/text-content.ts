import { createElement, type ReactNode } from "react";
import { BlockView } from "./block-view";
import { Figure } from "./figure";
import type { ReaderViewHandlers, ReaderViewModel } from "./types";

export function orderedTextChildren(model: Extract<ReaderViewModel, { kind: "text" }>, handlers: ReaderViewHandlers): ReactNode[] {
  const blocks = model.blocks.map((block, index) => ({ kind: "block" as const, offset: block.start, value: createElement(BlockView, { key: `block-${block.start}-${index}`, block, index }) }));
  const figures = model.figures.map((figure, figureIndex) => ({ kind: "figure" as const, offset: figure.sourceOffset, value: createElement(Figure, { key: `figure-${figure.sourceOffset}-${figureIndex}`, figureView: { figure, figureIndex, status: "ready", brightness: "dimmed" }, handlers, text: true }) }));
  return [...blocks, ...figures].sort((left, right) => left.offset - right.offset || (left.kind === "figure" ? -1 : 1)).map((entry) => entry.value);
}
