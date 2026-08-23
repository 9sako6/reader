import assert from "node:assert/strict";
import { codeLanguageLabel, highlightedCodeTokens } from "../src/SyntaxHighlightedCode";

test("language metadata highlights TypeScript without changing its source text", () => {
  const source = "const result = await client.readFully(); // done";
  const tokens = highlightedCodeTokens(source, "typescript");

  assert.equal(tokens.map((token) => token.text).join(""), source);
  assert.deepEqual(
    tokens.filter((token) => token.kind).map((token) => [token.text, token.kind]),
    [
      ["const", "keyword"],
      ["=", "operator"],
      ["await", "keyword"],
      ["readFully", "function"],
      ["// done", "comment"],
    ],
  );
  assert.equal(codeLanguageLabel("ts"), "TypeScript");
});

test("code without language metadata stays plain", () => {
  const source = "const result = 42;";

  assert.deepEqual(highlightedCodeTokens(source, ""), [{ text: source }]);
});
