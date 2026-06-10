/**
 * HTML wrapper generator — produces a Flash 8-compatible HTML page
 * that embeds the SWF using <object>/<embed> tags.
 *
 * Follows the standard Flash 8 HTML publish template pattern.
 */

export interface HtmlPublishSettings {
  /** Page title (defaults to swfFilename without extension). */
  title?: string;
  /** Stage width in pixels. */
  width: number;
  /** Stage height in pixels. */
  height: number;
  /** Background colour as "#rrggbb". */
  bgcolor: string;
  /** Playback quality hint. Default "high". */
  quality?: "low" | "medium" | "high" | "best";
  /** Whether the movie loops. Default true. */
  loop?: boolean;
  /** Whether the Flash context-menu is shown. Default true. */
  menu?: boolean;
  /** Scale mode. Default "showall". */
  scale?: "showall" | "noborder" | "exactfit" | "noscale";
  /** Horizontal/vertical alignment. Default "". */
  align?: "l" | "r" | "t" | "b" | "";
  /** Window mode for transparency/layering. Default "window". */
  wmode?: "window" | "opaque" | "transparent";
  /** The SWF filename to embed, e.g. "movie.swf". */
  swfFilename: string;
  /** Flash Player major version, e.g. 8. Default 8. */
  flashVersion?: number;
}

/**
 * Generate a standard Flash 8 HTML wrapper page.
 *
 * Returns the full HTML document as a string.
 */
export function generateHtmlWrapper(settings: HtmlPublishSettings): string {
  const {
    width,
    height,
    bgcolor,
    swfFilename,
    quality = "high",
    loop = true,
    menu = true,
    scale = "showall",
    align = "",
    wmode = "window",
    flashVersion = 8,
  } = settings;

  const title = settings.title ?? swfFilename.replace(/\.swf$/i, "");
  const loopStr = loop ? "true" : "false";
  const menuStr = menu ? "true" : "false";

  // Build optional <param> / attribute strings for align (omit when empty).
  const alignParam = align
    ? `\n    <param name="salign" value="${align}">`
    : "";
  const alignAttr = align ? ` salign="${align}"` : "";

  return `<!DOCTYPE html>
<html>
<head>
  <title>${escapeHtml(title)}</title>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
</head>
<body bgcolor="${escapeHtml(bgcolor)}">
  <object classid="clsid:d27cdb6e-ae6d-11cf-96b8-444553540000"
          codebase="http://fpdownload.macromedia.com/pub/shockwave/cabs/flash/swflash.cab#version=${flashVersion},0,0,0"
          width="${width}" height="${height}">
    <param name="movie" value="${escapeHtml(swfFilename)}">
    <param name="quality" value="${quality}">
    <param name="bgcolor" value="${escapeHtml(bgcolor)}">
    <param name="loop" value="${loopStr}">
    <param name="menu" value="${menuStr}">
    <param name="scale" value="${scale}">
    <param name="wmode" value="${wmode}">${alignParam}
    <embed src="${escapeHtml(swfFilename)}"
           quality="${quality}"
           bgcolor="${escapeHtml(bgcolor)}"
           width="${width}" height="${height}"
           loop="${loopStr}"
           menu="${menuStr}"
           scale="${scale}"
           wmode="${wmode}"${alignAttr}
           pluginspage="http://www.macromedia.com/go/getflashplayer"
           type="application/x-shockwave-flash">
    </embed>
  </object>
</body>
</html>`;
}

/** Minimal HTML attribute/text escape (handles the few dynamic values we insert). */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
