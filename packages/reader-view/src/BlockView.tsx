import type { ReactElement } from "react";
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
        {block.text.slice(sentence.start, sentence.end)}
      </span>
    ))
    : block.text;
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
