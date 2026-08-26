import type { ReactNode } from "react";
import { BlockView } from "./BlockView";
import { Figure } from "./Figure";
import type { ReaderViewHandlers, TextScreen } from "./types";

export function orderedTextChildren(model: TextScreen, handlers: ReaderViewHandlers): ReactNode[] {
  const blocks = model.blocks
    .filter((block) => !model.figures.some((figure) => (
      figure.kind !== "image"
      && (
        (block.kind === "preformatted" && block.start === figure.sourceOffset && block.end === figure.sourceEnd)
        || (block.start >= figure.sourceOffset && block.end <= figure.sourceEnd)
      )
    )))
    .map((block, index) => ({ kind: "block" as const, offset: block.start, order: index, value: <BlockView key={`block-${block.start}-${index}`} block={block} index={index} /> }));
  const figures = model.figures.map((figure, figureIndex) => ({ kind: "figure" as const, offset: figure.sourceOffset, order: figureIndex, value: <Figure key={`figure-${figure.sourceOffset}-${figureIndex}`} figureView={{ figure, figureIndex, status: "ready", brightness: figure.kind === "mermaid" ? "revealed" : "dimmed" }} handlers={handlers} text /> }));
  return [...blocks, ...figures]
    .sort((left, right) => left.offset - right.offset || (left.kind === right.kind ? left.order - right.order : left.kind === "figure" ? -1 : 1))
    .map((entry) => entry.value);
}
