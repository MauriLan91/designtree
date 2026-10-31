// Devicetree source highlighting for CodeMirror: a stream tokenizer is
// enough for colouring, the backend's parser does the real parsing.
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StringStream } from "@codemirror/language";
import { tags } from "@lezer/highlight";

interface State {
  inComment: boolean;
}

function token(stream: StringStream, state: State): string | null {
  if (state.inComment) {
    if (stream.skipTo("*/")) {
      stream.match("*/");
      state.inComment = false;
    } else {
      stream.skipToEnd();
    }
    return "comment";
  }
  if (stream.eatSpace()) return null;
  if (stream.match("//")) {
    stream.skipToEnd();
    return "comment";
  }
  if (stream.match("/*")) {
    state.inComment = true;
    return "comment";
  }
  if (stream.sol() && stream.match(/^#\s*\w+/)) {
    stream.skipToEnd();
    return "meta";
  }
  if (stream.match(/^\/[a-z0-9-]+\//)) return "keyword";
  if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
  if (stream.match(/^&\{[^}]*\}?/) || stream.match(/^&[\w-]+/)) return "link";
  if (stream.match(/^[\w-]+:(?!\w)/)) return "labelName";
  if (stream.match(/^(?:0x[0-9a-fA-F]+|\d+)\b/)) return "number";
  if (stream.match(/^[#\w,.+?@-]+(?=\s*(?:=|;))/)) return "propertyName";
  if (stream.match(/^[\w,.+-]+(?:@[\w,.+-]*)?(?=\s*\{)/)) return "typeName";
  if (stream.match(/^\/(?=\s*\{)/)) return "typeName";
  if (stream.match(/^[A-Z_][A-Z0-9_]*\b/)) return "macroName";
  stream.next();
  return null;
}

export const dts = StreamLanguage.define<State>({
  name: "dts",
  startState: () => ({ inComment: false }),
  token,
  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },
});

export const dtsHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.comment, color: "var(--muted)", fontStyle: "italic" },
    { tag: tags.meta, color: "#8250df" },
    { tag: tags.keyword, color: "#8250df" },
    { tag: tags.string, color: "#0a7d32" },
    { tag: tags.link, color: "var(--ref)" },
    { tag: tags.labelName, color: "var(--accent)", fontWeight: "600" },
    { tag: tags.number, color: "#b35900" },
    { tag: tags.propertyName, color: "var(--text)" },
    { tag: tags.typeName, color: "var(--accent)" },
    { tag: tags.macroName, color: "#b35900" },
  ]),
);
