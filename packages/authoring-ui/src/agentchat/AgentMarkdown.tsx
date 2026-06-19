import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { chrome, halo } from "../theme/flash8Theme.js";

// ---------------------------------------------------------------------------
// AgentMarkdown — renders an ASSISTANT message body as Markdown (task 1290).
//
// SAFETY: this uses the DEFAULT react-markdown pipeline with ONLY remark-gfm
// added. We deliberately do NOT pass `rehype-raw` (or any raw-HTML plugin), so
// any literal HTML in the assistant text (e.g. `<script>`, `<b>`) is treated as
// plain TEXT — react-markdown escapes it and it can never become live DOM. This
// preserves the no-XSS property the security audit noted: the markdown renderer
// cannot inject HTML.
//
// STREAMING: react-markdown re-parses its `children` string on every render, so
// feeding it growing delta text just re-renders. remark/micromark parse partial
// or unclosed markdown gracefully (an open ``` code fence mid-stream parses as a
// code block that runs to the end of the buffer; an unbalanced **bold** is just
// text) — it never throws, so streaming a half-written message cannot crash the
// panel.
//
// THEME: every element is styled to the Flash 8 LIGHT theme via the flash8Theme
// tokens — near-black `chrome.textDefault` text on the light panel bg, code in a
// monospace face on a light `chrome.insetFieldStrip` inset, links in the halo
// blue. The container stays `user-select:text` (inherited from the transcript,
// task 1285) so message text remains selectable/copyable.
// ---------------------------------------------------------------------------

const CODE_BG = chrome.insetFieldStrip;
const CODE_FONT =
  'Consolas, "Lucida Console", "Courier New", monospace';

const components: Components = {
  // Headings — scaled down to fit the compact chat column, near-black, bold.
  h1: ({ children }) => <div style={styles.h1}>{children}</div>,
  h2: ({ children }) => <div style={styles.h2}>{children}</div>,
  h3: ({ children }) => <div style={styles.h3}>{children}</div>,
  h4: ({ children }) => <div style={styles.h4}>{children}</div>,
  h5: ({ children }) => <div style={styles.h4}>{children}</div>,
  h6: ({ children }) => <div style={styles.h4}>{children}</div>,

  p: ({ children }) => <p style={styles.p}>{children}</p>,
  strong: ({ children }) => <strong style={styles.strong}>{children}</strong>,
  em: ({ children }) => <em style={styles.em}>{children}</em>,
  del: ({ children }) => <del style={styles.del}>{children}</del>,

  a: ({ href, children }) => (
    // Links open in a new tab and never leak the opener / referrer.
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={styles.a}
    >
      {children}
    </a>
  ),

  ul: ({ children }) => <ul style={styles.ul}>{children}</ul>,
  ol: ({ children }) => <ol style={styles.ol}>{children}</ol>,
  li: ({ children }) => <li style={styles.li}>{children}</li>,

  blockquote: ({ children }) => (
    <blockquote style={styles.blockquote}>{children}</blockquote>
  ),

  hr: () => <hr style={styles.hr} />,

  // Code — react-markdown renders inline code as <code> WITHOUT a wrapping
  // <pre>, and fenced/indented blocks as <code> INSIDE a <pre>. We distinguish
  // the two via the `inline`-ish heuristic: a fenced block's content has a
  // language class and/or contains a newline. To keep it robust across
  // react-markdown majors we style inline code here and let the `pre` renderer
  // own the block chrome (monospace + inset bg + horizontal scroll).
  code: (props) => {
    const { children, className } = props as {
      children?: React.ReactNode;
      className?: string;
    };
    const isBlock =
      typeof className === "string" && className.includes("language-");
    const text = childrenToString(children);
    const looksMultiline = text.includes("\n");
    if (isBlock || looksMultiline) {
      // Block code: rendered raw inside our themed <pre>; no inline pill.
      return <code style={styles.codeBlock}>{children}</code>;
    }
    return <code style={styles.codeInline}>{children}</code>;
  },
  pre: ({ children }) => <pre style={styles.pre}>{children}</pre>,

  // GFM tables.
  table: ({ children }) => (
    <div style={styles.tableWrap}>
      <table style={styles.table}>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => <th style={styles.th}>{children}</th>,
  td: ({ children }) => <td style={styles.td}>{children}</td>,
};

/** Flatten a react node tree to a plain string (best-effort, for heuristics). */
function childrenToString(node: React.ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(childrenToString).join("");
  if (React.isValidElement(node)) {
    return childrenToString(
      (node.props as { children?: React.ReactNode }).children
    );
  }
  return "";
}

export interface AgentMarkdownProps {
  /** The (possibly streaming, possibly partial) markdown source. */
  children: string;
}

/**
 * Render an assistant message body as themed, XSS-safe Markdown.
 *
 * @remarks Used by {@link AgentChatPanel} for assistant text entries. User
 * messages and tool-call chips stay plain text.
 */
export function AgentMarkdown({
  children,
}: AgentMarkdownProps): React.JSX.Element {
  return (
    <div style={styles.root} data-testid="agent-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

// --- Styles -----------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  root: {
    fontSize: 11,
    color: chrome.textDefault,
    lineHeight: 1.45,
    wordBreak: "break-word",
    overflowWrap: "anywhere",
    // Inherit user-select:text from the transcript (task 1285) — do not reset.
  },
  h1: {
    fontSize: 15,
    fontWeight: 700,
    color: chrome.textDefault,
    margin: "6px 0 3px",
    lineHeight: 1.25,
  },
  h2: {
    fontSize: 14,
    fontWeight: 700,
    color: chrome.textDefault,
    margin: "6px 0 3px",
    lineHeight: 1.25,
  },
  h3: {
    fontSize: 12,
    fontWeight: 700,
    color: chrome.textDefault,
    margin: "5px 0 2px",
    lineHeight: 1.25,
  },
  h4: {
    fontSize: 11,
    fontWeight: 700,
    color: chrome.textDefault,
    margin: "4px 0 2px",
    lineHeight: 1.25,
  },
  p: {
    margin: "0 0 6px",
  },
  strong: { fontWeight: 700 },
  em: { fontStyle: "italic" },
  del: { textDecoration: "line-through" },
  a: {
    color: halo.haloBlue,
    textDecoration: "underline",
  },
  ul: {
    margin: "0 0 6px",
    paddingLeft: 18,
  },
  ol: {
    margin: "0 0 6px",
    paddingLeft: 18,
  },
  li: {
    margin: "1px 0",
  },
  blockquote: {
    margin: "0 0 6px",
    paddingLeft: 8,
    borderLeft: `3px solid ${chrome.separator}`,
    color: halo.disabledText,
    fontStyle: "italic",
  },
  hr: {
    border: "none",
    borderTop: `1px solid ${chrome.separator}`,
    margin: "6px 0",
  },
  codeInline: {
    fontFamily: CODE_FONT,
    fontSize: 10,
    background: CODE_BG,
    border: `1px solid ${chrome.separator}`,
    borderRadius: 3,
    padding: "0 3px",
  },
  codeBlock: {
    fontFamily: CODE_FONT,
    fontSize: 10,
    // No own bg/border — the <pre> owns the block chrome.
    background: "transparent",
    border: "none",
    padding: 0,
    whiteSpace: "pre",
  },
  pre: {
    margin: "0 0 6px",
    padding: "6px 8px",
    background: CODE_BG,
    border: `1px solid ${chrome.separator}`,
    borderRadius: 4,
    // Long lines scroll horizontally instead of wrapping/overflowing the panel.
    overflowX: "auto",
    fontFamily: CODE_FONT,
    fontSize: 10,
    lineHeight: 1.4,
  },
  tableWrap: {
    margin: "0 0 6px",
    overflowX: "auto",
  },
  table: {
    borderCollapse: "collapse",
    fontSize: 10,
  },
  th: {
    border: `1px solid ${chrome.separator}`,
    background: CODE_BG,
    padding: "2px 6px",
    textAlign: "left",
    fontWeight: 700,
  },
  td: {
    border: `1px solid ${chrome.separator}`,
    padding: "2px 6px",
  },
};
