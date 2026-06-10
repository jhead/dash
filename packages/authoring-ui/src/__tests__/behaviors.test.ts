import { describe, it, expect } from "vitest";
import { BEHAVIORS, getBehaviorsByCategory } from "../behaviors.js";

describe("BEHAVIORS registry", () => {
  it("has at least 8 built-in behaviors", () => {
    expect(BEHAVIORS.length).toBeGreaterThanOrEqual(8);
  });

  it("every behavior has required fields", () => {
    for (const b of BEHAVIORS) {
      expect(b.id).toBeTruthy();
      expect(b.category).toBeTruthy();
      expect(b.name).toBeTruthy();
      expect(typeof b.generate).toBe("function");
      expect(Array.isArray(b.params)).toBe(true);
    }
  });

  it("all behavior ids are unique", () => {
    const ids = BEHAVIORS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("goto-and-play", () => {
  const b = BEHAVIORS.find((b) => b.id === "goto-and-play")!;

  it("generates correct AS2 with numeric frame", () => {
    expect(b.generate({ target: "_root", frame: "2" })).toBe("_root.gotoAndPlay(2);");
  });

  it("generates correct AS2 with string label", () => {
    expect(b.generate({ target: "mc", frame: "start" })).toBe('mc.gotoAndPlay("start");');
  });

  it("defaults target to _root when empty", () => {
    expect(b.generate({ target: "", frame: "1" })).toBe("_root.gotoAndPlay(1);");
  });
});

describe("goto-and-stop", () => {
  const b = BEHAVIORS.find((b) => b.id === "goto-and-stop")!;

  it("generates correct AS2 with numeric frame", () => {
    expect(b.generate({ target: "_root", frame: "3" })).toBe("_root.gotoAndStop(3);");
  });

  it("generates correct AS2 with string label", () => {
    expect(b.generate({ target: "clip", frame: "end" })).toBe('clip.gotoAndStop("end");');
  });
});

describe("play", () => {
  const b = BEHAVIORS.find((b) => b.id === "play")!;

  it("generates correct AS2", () => {
    expect(b.generate({ target: "mc" })).toBe("mc.play();");
  });

  it("defaults to _root", () => {
    expect(b.generate({ target: "" })).toBe("_root.play();");
  });
});

describe("stop", () => {
  const b = BEHAVIORS.find((b) => b.id === "stop")!;

  it("generates correct AS2", () => {
    expect(b.generate({ target: "mc" })).toBe("mc.stop();");
  });
});

describe("stop-all-sounds", () => {
  const b = BEHAVIORS.find((b) => b.id === "stop-all-sounds")!;

  it("generates stopAllSounds()", () => {
    expect(b.generate({})).toBe("stopAllSounds();");
  });

  it("has no params", () => {
    expect(b.params).toHaveLength(0);
  });
});

describe("web-link", () => {
  const b = BEHAVIORS.find((b) => b.id === "web-link")!;

  it("generates correct AS2", () => {
    expect(b.generate({ url: "http://example.com", window: "_blank" })).toBe(
      'getURL("http://example.com", "_blank");'
    );
  });

  it("falls back to default url and window when empty", () => {
    expect(b.generate({ url: "", window: "" })).toBe(
      'getURL("http://www.example.com", "_blank");'
    );
  });
});

describe("load-graphic", () => {
  const b = BEHAVIORS.find((b) => b.id === "load-graphic")!;

  it("generates correct AS2", () => {
    expect(b.generate({ url: "photo.jpg", target: "holder" })).toBe(
      'loadMovie("photo.jpg", "holder");'
    );
  });
});

describe("unload-movie", () => {
  const b = BEHAVIORS.find((b) => b.id === "unload-movie")!;

  it("generates correct AS2", () => {
    expect(b.generate({ target: "_level1" })).toBe('unloadMovie("_level1");');
  });
});

describe("getBehaviorsByCategory", () => {
  it("groups behaviors into categories", () => {
    const map = getBehaviorsByCategory();
    expect(map.has("Movie Clip")).toBe(true);
    expect(map.has("Sound")).toBe(true);
    expect(map.has("Web")).toBe(true);
  });

  it("Movie Clip category has multiple behaviors", () => {
    const map = getBehaviorsByCategory();
    expect((map.get("Movie Clip") ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("Embedded Video behaviors", () => {
  it("Embedded Video category has at least 5 behaviors", () => {
    expect(getBehaviorsByCategory("Embedded Video").length).toBeGreaterThanOrEqual(5);
  });

  it("video-seek generates correct AS2", () => {
    expect(BEHAVIORS.find(b => b.id === "video-seek")!.generate({ target: "v", time: "10" }))
      .toBe("v.seek(10);");
  });

  it("video-play generates correct AS2", () => {
    const b = BEHAVIORS.find(b => b.id === "video-play")!;
    expect(b.generate({ target: "myVid" })).toBe("myVid.play();");
    expect(b.generate({ target: "" })).toBe("myVideo.play();");
  });

  it("video-stop generates close() call", () => {
    const b = BEHAVIORS.find(b => b.id === "video-stop")!;
    expect(b.generate({ target: "vid" })).toBe("vid.close();");
  });

  it("video-show generates _visible assignment", () => {
    const b = BEHAVIORS.find(b => b.id === "video-show")!;
    expect(b.generate({ target: "mc", visible: "false" })).toBe("mc._visible = false;");
  });

  it("video-fast-forward generates seek with +5", () => {
    const b = BEHAVIORS.find(b => b.id === "video-fast-forward")!;
    expect(b.generate({ target: "v" })).toBe("var _nc = v;\n_nc.seek(_nc.time + 5);");
  });

  it("video-rewind generates seek with Math.max(0, time - 5)", () => {
    const b = BEHAVIORS.find(b => b.id === "video-rewind")!;
    expect(b.generate({ target: "v" })).toBe("var _nc = v;\n_nc.seek(Math.max(0, _nc.time - 5));");
  });
});
