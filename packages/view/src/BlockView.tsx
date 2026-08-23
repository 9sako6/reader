import type { ReactElement, ReactNode } from "react";
import { blockTag } from "./block-tag";
import type { ReaderViewBlock } from "./types";

export function BlockView({ block, index }: { block: ReaderViewBlock; index: number }): ReactElement {
  const tag = blockTag(block);
  const Tag = tag;
  const children = block.sentenceSpans.length > 0
    ? block.sentenceSpans.map((sentence, sentenceIndex) => (
      <span
        key={`${sentence.start}-${sentenceIndex}`}
        className="text-sentence"
        data-reader-text-anchor="true"
        data-reader-position-kind="text"
        data-source-start={String(block.start + sentence.start)}
        data-source-end={String(block.start + sentence.end)}
      >
        {inlineCodeChildren(block, sentence.start, sentence.end)}
      </span>
    ))
    : inlineCodeChildren(block, 0, block.text.length);
  return (
    <Tag
      key={`${block.start}-${index}`}
      className={tag === "p" ? "paragraph" : tag === "h1" ? "article-title" : undefined}
      data-source-start={String(block.start)}
      data-source-end={String(block.end)}
    >
      {children}
    </Tag>
  );
}

function inlineCodeChildren(block: ReaderViewBlock, relativeStart: number, relativeEnd: number): ReactNode[] {
  const absoluteStart = block.start + relativeStart;
  const absoluteEnd = block.start + relativeEnd;
  const ranges = (block.codeRanges || [])
    .filter((range) => range.start >= absoluteStart && range.end <= absoluteEnd)
    .sort((left, right) => left.start - right.start);
  if (ranges.length === 0) return [block.text.slice(relativeStart, relativeEnd)];
  const children: ReactNode[] = [];
  let cursor = absoluteStart;
  for (const range of ranges) {
    if (range.start > cursor) children.push(block.text.slice(cursor - block.start, range.start - block.start));
    children.push(
      <code
        key={`${range.start}-${range.end}`}
        data-reader-inline-code="true"
        style={{
          padding: "0.12em 0.34em",
          borderRadius: "0.32em",
          background: "rgba(255,255,255,0.09)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: "0.88em",
          whiteSpace: "nowrap",
        }}
      >
        {block.text.slice(range.start - block.start, range.end - block.start)}
      </code>,
    );
    cursor = range.end;
  }
  if (cursor < absoluteEnd) children.push(block.text.slice(cursor - block.start, relativeEnd));
  return children;
}
