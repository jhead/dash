/**
 * Tests for generateHtmlWrapper() — task 0807.
 */

import { describe, it, expect } from "vitest";
import { generateHtmlWrapper } from "../html.js";
import type { HtmlPublishSettings } from "../html.js";

const BASE: HtmlPublishSettings = {
  width: 550,
  height: 400,
  bgcolor: "#ffffff",
  swfFilename: "movie.swf",
};

describe("generateHtmlWrapper — basic structure", () => {
  it("returns a string", () => {
    expect(typeof generateHtmlWrapper(BASE)).toBe("string");
  });

  it("contains <!DOCTYPE html>", () => {
    expect(generateHtmlWrapper(BASE)).toContain("<!DOCTYPE html>");
  });

  it("contains <object tag", () => {
    expect(generateHtmlWrapper(BASE)).toContain("<object");
  });

  it("contains <embed tag", () => {
    expect(generateHtmlWrapper(BASE)).toContain("<embed");
  });

  it("contains the swfFilename in object param", () => {
    const html = generateHtmlWrapper(BASE);
    expect(html).toContain('value="movie.swf"');
  });

  it("contains the swfFilename in embed src", () => {
    const html = generateHtmlWrapper(BASE);
    expect(html).toContain('src="movie.swf"');
  });
});

describe("generateHtmlWrapper — bgcolor", () => {
  it("includes bgcolor in body tag", () => {
    const html = generateHtmlWrapper({ ...BASE, bgcolor: "#336699" });
    expect(html).toContain('bgcolor="#336699"');
  });

  it("includes bgcolor param inside object", () => {
    const html = generateHtmlWrapper({ ...BASE, bgcolor: "#336699" });
    // Should appear at least twice: body + param + embed attribute
    const count = (html.match(/336699/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

describe("generateHtmlWrapper — width/height", () => {
  it("includes width in object", () => {
    const html = generateHtmlWrapper({ ...BASE, width: 800 });
    expect(html).toContain('width="800"');
  });

  it("includes height in object", () => {
    const html = generateHtmlWrapper({ ...BASE, height: 600 });
    expect(html).toContain('height="600"');
  });

  it("includes width in embed", () => {
    const html = generateHtmlWrapper({ ...BASE, width: 320 });
    const count = (html.match(/width="320"/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2); // object + embed
  });
});

describe("generateHtmlWrapper — title", () => {
  it("uses provided title in <title> tag", () => {
    const html = generateHtmlWrapper({ ...BASE, title: "My Movie" });
    expect(html).toContain("<title>My Movie</title>");
  });

  it("defaults title to swfFilename without extension", () => {
    const html = generateHtmlWrapper(BASE); // swfFilename = "movie.swf"
    expect(html).toContain("<title>movie</title>");
  });

  it("escapes HTML entities in title", () => {
    const html = generateHtmlWrapper({ ...BASE, title: "A & B" });
    expect(html).toContain("A &amp; B");
    expect(html).not.toContain("A & B");
  });
});

describe("generateHtmlWrapper — quality", () => {
  it("defaults quality to high", () => {
    const html = generateHtmlWrapper(BASE);
    expect(html).toContain('quality="high"');
  });

  it("uses provided quality value", () => {
    const html = generateHtmlWrapper({ ...BASE, quality: "best" });
    expect(html).toContain('quality="best"');
  });

  it("uses low quality", () => {
    const html = generateHtmlWrapper({ ...BASE, quality: "low" });
    expect(html).toContain('quality="low"');
  });
});

describe("generateHtmlWrapper — loop", () => {
  it("defaults loop to true", () => {
    const html = generateHtmlWrapper(BASE);
    expect(html).toContain('loop="true"');
  });

  it("loop=false produces loop=false in output", () => {
    const html = generateHtmlWrapper({ ...BASE, loop: false });
    expect(html).toContain('loop="false"');
    expect(html).not.toContain('loop="true"');
  });
});

describe("generateHtmlWrapper — menu", () => {
  it("defaults menu to true", () => {
    const html = generateHtmlWrapper(BASE);
    expect(html).toContain('menu="true"');
  });

  it("menu=false produces menu=false", () => {
    const html = generateHtmlWrapper({ ...BASE, menu: false });
    expect(html).toContain('menu="false"');
    expect(html).not.toContain('menu="true"');
  });
});

describe("generateHtmlWrapper — scale", () => {
  it("defaults scale to showall", () => {
    const html = generateHtmlWrapper(BASE);
    expect(html).toContain('scale="showall"');
  });

  it("uses provided scale", () => {
    const html = generateHtmlWrapper({ ...BASE, scale: "exactfit" });
    expect(html).toContain('scale="exactfit"');
  });
});

describe("generateHtmlWrapper — wmode", () => {
  it("defaults wmode to window", () => {
    const html = generateHtmlWrapper(BASE);
    expect(html).toContain('wmode="window"');
  });

  it("transparent wmode appears in output", () => {
    const html = generateHtmlWrapper({ ...BASE, wmode: "transparent" });
    expect(html).toContain('wmode="transparent"');
  });
});

describe("generateHtmlWrapper — align", () => {
  it("omits salign when align is empty/undefined", () => {
    const html = generateHtmlWrapper(BASE);
    expect(html).not.toContain("salign");
  });

  it("includes salign when align is set", () => {
    const html = generateHtmlWrapper({ ...BASE, align: "l" });
    expect(html).toContain('salign="l"');
  });
});

describe("generateHtmlWrapper — flashVersion", () => {
  it("defaults to version 8 in codebase URL", () => {
    const html = generateHtmlWrapper(BASE);
    expect(html).toContain("#version=8,0,0,0");
  });

  it("uses provided flashVersion", () => {
    const html = generateHtmlWrapper({ ...BASE, flashVersion: 9 });
    expect(html).toContain("#version=9,0,0,0");
  });
});
