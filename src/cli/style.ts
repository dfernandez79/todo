/** How text output looks: plain, or colored with ANSI escape codes for a terminal. */
type Style = {
  /** An Item ID, muted. */
  id: (text: string) => string;
  /** A whole Done Item line, muted. */
  done: (text: string) => string;
  /** The List heading. */
  heading: (text: string) => string;
  /** A Section heading. */
  section: (text: string) => string;
  /**
   * Inline Markdown in an Item's description: `**bold**`, `*italic*`, and
   * `` `code` ``. Inside a muted line, code keeps the muted color.
   */
  inline: (text: string, options?: { muted?: boolean }) => string;
};

const identity = (text: string) => text;

const PLAIN: Style = {
  id: identity,
  done: identity,
  heading: identity,
  section: identity,
  inline: identity,
};

const sgr = (open: number, close: number) => (text: string) =>
  `\u001B[${open}m${text}\u001B[${close}m`;

const gray = sgr(90, 39);
const bold = sgr(1, 22);
const italic = sgr(3, 23);
const yellow = sgr(33, 39);
const blue = sgr(34, 39);

const CODE = /`([^`]+)`/;
const BOLD = /\*\*(.+?)\*\*|__(.+?)__/g;
const ITALIC = /\*(.+?)\*|(?<![\w])_(.+?)_(?![\w])/g;

/** Bold and italic outside code spans. */
const emphasis = (text: string): string =>
  text
    .replaceAll(BOLD, (_, stars?: string, underscores?: string) => bold(stars ?? underscores ?? ""))
    .replaceAll(ITALIC, (_, star?: string, underscore?: string) =>
      italic(star ?? underscore ?? ""),
    );

const inline = (text: string, options: { muted?: boolean } = {}): string =>
  // Splitting on a group alternates text and code: even indexes are text, odd ones code.
  text
    .split(CODE)
    .map((part, index) =>
      index % 2 === 0 ? emphasis(part) : options.muted === true ? part : yellow(part),
    )
    .join("");

const COLORS: Style = {
  id: gray,
  done: gray,
  heading: bold,
  section: text => bold(blue(text)),
  inline,
};

/** Colored text for a terminal, or plain text. */
const styleFor = (color: boolean): Style => (color ? COLORS : PLAIN);

export { COLORS, PLAIN, type Style, styleFor };
