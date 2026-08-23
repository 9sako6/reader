import type { ReactElement } from "react";

type SyntaxTokenKind = "comment" | "string" | "keyword" | "number" | "function" | "property" | "tag" | "operator";

type SyntaxToken = {
  text: string;
  kind?: SyntaxTokenKind;
};

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: "shell",
  cjs: "javascript",
  html: "markup",
  js: "javascript",
  javascript: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  py: "python",
  python: "python",
  qnt: "quint",
  quint: "quint",
  rs: "rust",
  rust: "rust",
  sh: "shell",
  shell: "shell",
  swift: "swift",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  xml: "markup",
  zsh: "shell",
};

const LANGUAGE_LABELS: Record<string, string> = {
  css: "CSS",
  javascript: "JavaScript",
  json: "JSON",
  jsonc: "JSONC",
  markup: "HTML",
  python: "Python",
  quint: "Quint",
  rust: "Rust",
  shell: "Shell",
  swift: "Swift",
  typescript: "TypeScript",
};

const KEYWORDS: Record<string, string[]> = {
  javascript: ["as", "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "export", "extends", "finally", "for", "from", "function", "get", "if", "import", "in", "instanceof", "let", "new", "of", "return", "set", "static", "super", "switch", "this", "throw", "try", "typeof", "var", "void", "while", "with", "yield", "true", "false", "null", "undefined"],
  typescript: ["abstract", "any", "as", "asserts", "async", "await", "boolean", "break", "case", "catch", "class", "const", "constructor", "continue", "declare", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "from", "function", "get", "if", "implements", "import", "in", "infer", "instanceof", "interface", "is", "keyof", "let", "namespace", "never", "new", "null", "number", "object", "of", "private", "protected", "public", "readonly", "return", "satisfies", "set", "static", "string", "super", "switch", "symbol", "this", "throw", "true", "try", "type", "typeof", "undefined", "unknown", "var", "void", "while", "yield"],
  python: ["and", "as", "assert", "async", "await", "break", "case", "class", "continue", "def", "del", "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "match", "None", "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield"],
  quint: ["action", "all", "and", "any", "assert", "assume", "bool", "const", "def", "else", "export", "false", "if", "import", "in", "int", "invariant", "List", "Map", "match", "module", "nondet", "not", "oneOf", "or", "pure", "run", "Set", "str", "temporal", "to", "true", "val", "var"],
  rust: ["as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while"],
  shell: ["case", "do", "done", "elif", "else", "esac", "export", "fi", "for", "function", "if", "in", "local", "readonly", "return", "select", "then", "time", "until", "while"],
  swift: ["actor", "any", "as", "associatedtype", "async", "await", "break", "case", "catch", "class", "continue", "default", "defer", "deinit", "do", "else", "enum", "extension", "fallthrough", "false", "fileprivate", "for", "func", "guard", "if", "import", "in", "init", "inout", "internal", "is", "let", "nil", "nonisolated", "open", "operator", "private", "protocol", "public", "repeat", "rethrows", "return", "self", "Self", "some", "static", "struct", "subscript", "super", "switch", "throw", "throws", "true", "try", "typealias", "var", "where", "while"],
};

const TOKEN_COLORS: Record<SyntaxTokenKind, string> = {
  comment: "#7f8c98",
  string: "#ff8170",
  keyword: "#ff7ab2",
  number: "#d9c97c",
  function: "#78c2ff",
  property: "#b8a1ff",
  tag: "#5dd8c7",
  operator: "#a8b4c0",
};

function normalizedLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] || normalized;
}

export function codeLanguageLabel(language: string): string {
  const normalized = normalizedLanguage(language);
  return LANGUAGE_LABELS[normalized] || language.trim();
}

export function highlightedCodeTokens(code: string, language: string): SyntaxToken[] {
  const normalized = normalizedLanguage(language);
  if (!code || !normalized) return [{ text: code }];
  const keywordPattern = (KEYWORDS[normalized] || [])
    .map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("|");
  const commentPattern = normalized === "python" || normalized === "shell"
    ? "#[^\\n]*"
    : normalized === "markup"
      ? "<!--[\\s\\S]*?-->"
      : "\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*";
  const alternatives = [
    `(?<comment>${commentPattern})`,
    normalized === "markup" ? "(?<tag><\\/?[A-Za-z][^>\\n]*>)" : "",
    normalized === "json" || normalized === "jsonc" ? "(?<property>\"(?:\\\\.|[^\"\\\\])*\"(?=\\s*:))" : "",
    normalized === "css" ? "(?<property>--?[A-Za-z_][\\w-]*(?=\\s*:)|[A-Za-z_][\\w-]*(?=\\s*:))" : "",
    "(?<string>\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|`(?:\\\\.|[^`\\\\])*`)",
    keywordPattern ? `(?<keyword>\\b(?:${keywordPattern})\\b)` : "",
    "(?<number>\\b(?:0[xX][0-9A-Fa-f]+|0[bB][01]+|\\d+(?:\\.\\d+)?)\\b)",
    "(?<function>\\b[A-Za-z_$][\\w$]*(?=\\s*\\())",
    "(?<operator>[+\\-*/%=!<>?:&|~^]+)",
  ].filter(Boolean);
  const pattern = new RegExp(alternatives.join("|"), "gmu");
  const tokens: SyntaxToken[] = [];
  let cursor = 0;
  for (const match of code.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ text: code.slice(cursor, index) });
    const kind = Object.entries(match.groups || {}).find(([, value]) => value !== undefined)?.[0] as SyntaxTokenKind | undefined;
    tokens.push({ text: match[0], kind });
    cursor = index + match[0].length;
  }
  if (cursor < code.length) tokens.push({ text: code.slice(cursor) });
  return tokens;
}

export function SyntaxHighlightedCode({ code, language }: { code: string; language: string }): ReactElement {
  const normalized = normalizedLanguage(language);
  return (
    <code data-reader-highlighted-code="true" data-reader-code-language={normalized}>
      {highlightedCodeTokens(code, language).map((token, index) => token.kind ? (
        <span key={`${index}-${token.kind}`} data-reader-syntax-token={token.kind} style={{ color: TOKEN_COLORS[token.kind] }}>
          {token.text}
        </span>
      ) : token.text)}
    </code>
  );
}
