// flashdrv — drive Flash 8 (Win7 VM) as a differential FLA oracle over HTTP.
//
//   server (in the VM):  flashdrv serve [--addr 0.0.0.0:8080] [--flash <path>] [--workdir C:\flashdrv]
//   client (on the Mac): flashdrv run  --script gen.jsfl --out ./corpus [--server http://VMIP:8080]
//                        flashdrv ping [--server http://VMIP:8080]
//
// On POST /run the server writes the (wrapped) JSFL to its local workdir, launches
// Flash, polls for a __DONE__ sentinel the wrapper emits, then streams every produced
// file back as a simple archive. Nothing crosses a shared folder.
//
// Build: see build.sh. Pin Zig 0.14.1 (0.16 networking is mid-reform).

const std = @import("std");
const builtin = @import("builtin");

const VERSION = "flashdrv v7 (warm + dirty-on-save + gettickcount-poll + graceful-close)";

// tickMs() — wall-clock milliseconds via GetTickCount (timer interrupt, NOT QPC/RDTSC).
// Safe on Parallels+Win7 where QPC returns 0 (std.time.Timer uses QPC → infinite loop).
// GetTickCount wraps after ~49 days; u32 wrapping subtraction handles that correctly.
// On non-Windows we call it only for compile-time symmetry; the runtime path is dead.
fn tickMs() u32 {
    if (builtin.os.tag == .windows) {
        // WINAPI = stdcall on x86, C on x86_64. Zig's kernel32 bindings use this pattern.
        const WinAPI: std.builtin.CallingConvention = if (builtin.cpu.arch == .x86) .Stdcall else .C;
        const f = struct {
            extern "kernel32" fn GetTickCount() callconv(WinAPI) std.os.windows.DWORD;
        };
        return @intCast(f.GetTickCount());
    }
    return 0;
}

// Set true when Flash was killed due to timeout. At the start of the next run we
// call killFlash again (no-op if already dead) and wait for it to fully exit before
// spawning a fresh instance. Prevents DDE / single-instance conflicts between a
// dying Flash and a newly-launched one. Single-threaded server — no atomic needed.
var g_flash_kill_on_next_run: bool = false;

const DEFAULT_ADDR = "0.0.0.0:8080";
const DEFAULT_FLASH = "C:\\Program Files\\Macromedia\\Flash 8\\Flash.exe";
const DEFAULT_WORKDIR = "C:\\flashdrv";
const DEFAULT_TIMEOUT_S: u32 = 180;
const MAX_FILE = 64 * 1024 * 1024;

pub fn main() !void {
    var gpa_state = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa_state.deinit();
    const gpa = gpa_state.allocator();

    // Winsock must be initialized before any socket call. std.net auto-inits on the
    // client connect path but NOT on the server listen path, so do it explicitly here.
    if (builtin.os.tag == .windows) {
        _ = std.os.windows.WSAStartup(2, 2) catch |err| {
            std.debug.print("WSAStartup failed: {s}\n", .{@errorName(err)});
            std.process.exit(1);
        };
    }

    const args = try std.process.argsAlloc(gpa);
    defer std.process.argsFree(gpa, args);

    if (args.len < 2) return usage();
    const cmd = args[1];
    if (std.mem.eql(u8, cmd, "serve")) {
        try serve(gpa, args[2..]);
    } else if (std.mem.eql(u8, cmd, "run")) {
        try clientRun(gpa, args[2..]);
    } else if (std.mem.eql(u8, cmd, "ping")) {
        try clientPing(gpa, args[2..]);
    } else {
        return usage();
    }
}

fn usage() void {
    std.debug.print(
        \\flashdrv — Flash 8 differential FLA oracle
        \\
        \\  flashdrv serve [--addr 0.0.0.0:8080] [--flash <Flash.exe>] [--workdir C:\flashdrv]
        \\  flashdrv run   --script <file|-> --out <dir> [--server http://host:8080] [--timeout 180]
        \\  flashdrv ping  [--server http://host:8080]
        \\
    , .{});
}

// ---------------------------------------------------------------------------
// flag helpers
// ---------------------------------------------------------------------------

fn optVal(args: [][:0]u8, name: []const u8, default: []const u8) []const u8 {
    var i: usize = 0;
    while (i + 1 < args.len) : (i += 1) {
        if (std.mem.eql(u8, args[i], name)) return args[i + 1];
    }
    return default;
}

const HostPort = struct { host: []const u8, port: u16 };

fn hasFlag(args: [][:0]u8, name: []const u8) bool {
    for (args) |a| {
        if (std.mem.eql(u8, a, name)) return true;
    }
    return false;
}

fn splitHostPort(s: []const u8, default_port: u16) HostPort {
    // last ':' separates host:port (good enough; no IPv6 literals here)
    if (std.mem.lastIndexOfScalar(u8, s, ':')) |idx| {
        const host = s[0..idx];
        const port = std.fmt.parseInt(u16, s[idx + 1 ..], 10) catch default_port;
        return .{ .host = if (host.len == 0) "0.0.0.0" else host, .port = port };
    }
    return .{ .host = s, .port = default_port };
}

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------

const Config = struct {
    flash: []const u8,
    workdir: []const u8,
};

fn serve(gpa: std.mem.Allocator, args: [][:0]u8) !void {
    const addr_s = optVal(args, "--addr", DEFAULT_ADDR);
    const cfg = Config{
        .flash = optVal(args, "--flash", DEFAULT_FLASH),
        .workdir = optVal(args, "--workdir", DEFAULT_WORKDIR),
    };

    const hp = splitHostPort(addr_s, 8080);
    const address = try std.net.Address.parseIp(hp.host, hp.port);
    var server = listenNoCloexec(address) catch |err| {
        std.debug.print("listen on {s} failed: {s}\n", .{ addr_s, @errorName(err) });
        std.process.exit(1);
    };
    defer server.deinit();

    std.debug.print("{s}\nflashdrv serving on {s}\n  flash   = {s}\n  workdir = {s}\n", .{ VERSION, addr_s, cfg.flash, cfg.workdir });

    while (true) {
        const conn = server.accept() catch |err| {
            std.debug.print("accept error: {s}\n", .{@errorName(err)});
            continue;
        };
        handleConn(gpa, conn, cfg) catch |err| {
            std.debug.print("conn error: {s}\n", .{@errorName(err)});
        };
        // Graceful TCP close: shutdown write-half first (sends FIN, flushes send buffer),
        // then close. Without this, closesocket() with unsent data sends RST instead of FIN,
        // causing the client's readAll to get ECONNRESET before receiving the response body.
        std.posix.shutdown(conn.stream.handle, .send) catch {};
        conn.stream.close();
    }
}

/// Like std.net.Address.listen but WITHOUT SOCK.CLOEXEC. std's listen passes CLOEXEC,
/// which makes posix.socket pass WSA_FLAG_NO_HANDLE_INHERIT to WSASocketW — a flag that
/// requires Windows 7 SP1. On Win7 RTM (build 7600) that fails with error.Unexpected.
/// accept() is unaffected (Windows accept() takes no flags), so we still use Server.accept.
fn listenNoCloexec(address: std.net.Address) !std.net.Server {
    const sockfd = try std.posix.socket(address.any.family, std.posix.SOCK.STREAM, std.posix.IPPROTO.TCP);
    const stream = std.net.Stream{ .handle = sockfd };
    errdefer stream.close();
    try std.posix.setsockopt(sockfd, std.posix.SOL.SOCKET, std.posix.SO.REUSEADDR, &std.mem.toBytes(@as(c_int, 1)));
    var socklen = address.getOsSockLen();
    try std.posix.bind(sockfd, &address.any, socklen);
    try std.posix.listen(sockfd, 128);
    var server = std.net.Server{ .listen_address = undefined, .stream = stream };
    try std.posix.getsockname(sockfd, &server.listen_address.any, &socklen);
    return server;
}

const Request = struct {
    method: []const u8,
    target: []const u8,
    body: []const u8,
};

fn readRequest(alloc: std.mem.Allocator, stream: std.net.Stream) !Request {
    var buf = std.ArrayList(u8).init(alloc);
    var tmp: [8192]u8 = undefined;

    // read until we have the full header block
    const header_end: usize = while (true) {
        if (std.mem.indexOf(u8, buf.items, "\r\n\r\n")) |idx| break idx + 4;
        const n = try stream.read(&tmp);
        if (n == 0) return error.UnexpectedEof;
        try buf.appendSlice(tmp[0..n]);
    };

    // Parse the header block and dupe out method/target NOW — the body-read loop
    // below (and toOwnedSlice) can realloc buf, invalidating slices into it.
    var method: []const u8 = undefined;
    var target: []const u8 = undefined;
    var content_len: usize = 0;
    {
        const head = buf.items[0..header_end];
        var lines = std.mem.splitSequence(u8, head, "\r\n");
        const reqline = lines.next() orelse return error.BadRequest;
        var parts = std.mem.tokenizeScalar(u8, reqline, ' ');
        method = try alloc.dupe(u8, parts.next() orelse return error.BadRequest);
        target = try alloc.dupe(u8, parts.next() orelse return error.BadRequest);
        while (lines.next()) |line| {
            if (line.len == 0) continue;
            if (asciiHasPrefixIgnoreCase(line, "content-length:")) {
                const v = std.mem.trim(u8, line["content-length:".len..], " \t");
                content_len = std.fmt.parseInt(usize, v, 10) catch 0;
            }
        }
    }

    // ensure full body present
    while (buf.items.len < header_end + content_len) {
        const n = try stream.read(&tmp);
        if (n == 0) break;
        try buf.appendSlice(tmp[0..n]);
    }

    const owned = try buf.toOwnedSlice();
    const body_end = @min(owned.len, header_end + content_len);
    return .{
        .method = method,
        .target = target,
        .body = owned[header_end..body_end],
    };
}

fn asciiHasPrefixIgnoreCase(s: []const u8, prefix: []const u8) bool {
    if (s.len < prefix.len) return false;
    for (prefix, 0..) |c, i| {
        if (std.ascii.toLower(s[i]) != std.ascii.toLower(c)) return false;
    }
    return true;
}

fn handleConn(gpa: std.mem.Allocator, conn: std.net.Server.Connection, cfg: Config) !void {
    var arena_state = std.heap.ArenaAllocator.init(gpa);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const req = readRequest(arena, conn.stream) catch |err| {
        try sendText(conn.stream, 400, "Bad Request", @errorName(err));
        return;
    };

    // path without query
    const path = if (std.mem.indexOfScalar(u8, req.target, '?')) |q| req.target[0..q] else req.target;

    if (std.mem.eql(u8, path, "/ping")) {
        const msg = try std.fmt.allocPrint(arena, "{s}\nflash={s}\nworkdir={s}\n", .{ VERSION, cfg.flash, cfg.workdir });
        try sendText(conn.stream, 200, "OK", msg);
        return;
    }

    if (std.mem.eql(u8, path, "/run") and std.mem.eql(u8, req.method, "POST")) {
        try handleRun(arena, conn.stream, cfg, req);
        return;
    }

    try sendText(conn.stream, 404, "Not Found", "no such endpoint\n");
}

fn queryTimeout(target: []const u8) u32 {
    const q = std.mem.indexOfScalar(u8, target, '?') orelse return DEFAULT_TIMEOUT_S;
    var it = std.mem.tokenizeScalar(u8, target[q + 1 ..], '&');
    while (it.next()) |kv| {
        if (asciiHasPrefixIgnoreCase(kv, "timeout=")) {
            return std.fmt.parseInt(u32, kv["timeout=".len..], 10) catch DEFAULT_TIMEOUT_S;
        }
    }
    return DEFAULT_TIMEOUT_S;
}

fn queryQuit(target: []const u8) bool {
    const q = std.mem.indexOfScalar(u8, target, '?') orelse return false;
    var it = std.mem.tokenizeScalar(u8, target[q + 1 ..], '&');
    while (it.next()) |kv| {
        if (asciiHasPrefixIgnoreCase(kv, "quit=")) return std.mem.eql(u8, kv["quit=".len..], "1");
    }
    return false;
}

fn releaseChild(child: *std.process.Child) void {
    if (builtin.os.tag == .windows) {
        std.os.windows.CloseHandle(child.id);
        std.os.windows.CloseHandle(child.thread_handle);
    }
}

fn handleRun(arena: std.mem.Allocator, stream: std.net.Stream, cfg: Config, req: Request) !void {
    const timeout_s = queryTimeout(req.target);
    const out_dir = try std.fs.path.join(arena, &.{ cfg.workdir, "out" });
    const job_path = try std.fs.path.join(arena, &.{ cfg.workdir, "job.jsfl" });
    const done_path = try std.fs.path.join(arena, &.{ out_dir, "__DONE__" });

    // If the previous run timed out, kill any lingering Flash before starting fresh.
    if (g_flash_kill_on_next_run) {
        killFlash(arena, cfg.flash);
        g_flash_kill_on_next_run = false;
    }

    // reset workdir/out
    std.fs.deleteTreeAbsolute(out_dir) catch {};
    std.fs.makeDirAbsolute(cfg.workdir) catch {};
    std.fs.makeDirAbsolute(out_dir) catch {};

    // wrap + write job script. Flash stays warm unless ?quit=1 — warm = faster batches AND
    // avoids the cold-start registration/init state that silently makes saveDocument return false.
    const quit_after = queryQuit(req.target);
    const script = try wrapScript(arena, out_dir, req.body, quit_after);
    {
        const f = try std.fs.createFileAbsolute(job_path, .{ .truncate = true });
        defer f.close();
        try f.writeAll(script);
    }

    // launch Flash (single-instance: if already running, this hands the script to the
    // warm instance and exits immediately; sentinel drives completion either way)
    var child = std.process.Child.init(&.{ cfg.flash, job_path }, arena);
    child.spawn() catch |err| {
        const m = try std.fmt.allocPrint(arena, "launch failed: {s} ({s})\n", .{ @errorName(err), cfg.flash });
        try sendText(stream, 500, "Launch Failed", m);
        return;
    };

    // Poll for sentinel using GetTickCount() — driven by the Windows timer interrupt, NOT
    // QPC/RDTSC. On some Parallels+Win7 configurations QPC returns 0 constantly, which makes
    // std.time.Timer's while-condition permanently true (infinite loop). GetTickCount is safe:
    // it wraps after ~49 days, and u32 wrapping subtraction handles that correctly.
    const start_tick = tickMs();
    const timeout_ms: u32 = @as(u32, timeout_s) * 1000;
    var done = false;
    while (tickMs() -% start_tick < timeout_ms) {
        if (accessAbs(done_path)) {
            done = true;
            break;
        }
        std.time.sleep(250 * std.time.ns_per_ms);
    }

    if (!done) {
        killFlash(arena, cfg.flash);
        g_flash_kill_on_next_run = true; // next run: verify Flash is dead before spawning
        releaseChild(&child);
        const m = try std.fmt.allocPrint(arena, "timeout after {d}s (no __DONE__); flash killed\n", .{timeout_s});
        try sendText(stream, 504, "Timeout", m);
        return;
    }
    // Do NOT wait() — with warm Flash the spawned process may be the long-lived Flash itself.
    // Just release our handle refs; the process keeps running independently.
    releaseChild(&child);

    // collect produced files (skip control sentinels) into archive
    var archive = std.ArrayList(u8).init(arena);
    var count: usize = 0;
    var err_text: []const u8 = "";
    {
        var dir = try std.fs.openDirAbsolute(out_dir, .{ .iterate = true });
        defer dir.close();
        err_text = dir.readFileAlloc(arena, "__ERROR__", 4096) catch "";
        var it = dir.iterate();
        while (try it.next()) |entry| {
            if (entry.kind != .file) continue;
            if (std.mem.eql(u8, entry.name, "__DONE__")) continue;
            if (std.mem.eql(u8, entry.name, "__ERROR__")) continue;
            const data = try dir.readFileAlloc(arena, entry.name, MAX_FILE);
            try appendU32(&archive, @intCast(entry.name.len));
            try archive.appendSlice(entry.name);
            try appendU32(&archive, @intCast(data.len));
            try archive.appendSlice(data);
            count += 1;
        }
    }

    try sendArchive(stream, archive.items, err_text, count);
}

fn accessAbs(path: []const u8) bool {
    std.fs.accessAbsolute(path, .{}) catch return false;
    return true;
}

fn killFlash(arena: std.mem.Allocator, flash_path: []const u8) void {
    const image = std.fs.path.basename(flash_path);
    var child = std.process.Child.init(&.{ "taskkill", "/IM", image, "/F" }, arena);
    _ = child.spawnAndWait() catch {};
}

fn appendU32(list: *std.ArrayList(u8), v: u32) !void {
    var b: [4]u8 = undefined;
    std.mem.writeInt(u32, &b, v, .little);
    try list.appendSlice(&b);
}

/// Wrap the user JSFL: inject OUT uri + save helper, run in try/catch, always emit
/// __ERROR__/__DONE__ sentinels. Quits Flash only if quit_after (else leaves it warm).
fn wrapScript(arena: std.mem.Allocator, out_dir: []const u8, body: []const u8, quit_after: bool) ![]const u8 {
    // C:\flashdrv\out  ->  file:///C|/flashdrv/out/
    const fwd = try arena.dupe(u8, out_dir);
    for (fwd) |*c| {
        if (c.* == '\\') c.* = '/';
    }
    const colon = std.mem.indexOfScalar(u8, fwd, ':');
    if (colon) |i| fwd[i] = '|';

    const quit_line: []const u8 = if (quit_after) "fl.quit(false);\n" else "";

    // fl.saveDocument returns false for an UNMODIFIED doc (Flash quirk). Real generators
    // modify the doc, so the first save succeeds with zero pollution; only a pristine doc
    // needs the harmless add-then-delete-layer dirty before retrying. saveDocumentAs is NOT
    // usable — it pops a modal dialog regardless of any URI argument.
    const helper =
        "function flashdrvSave(doc,name){var u=OUT+name+\".fla\";" ++
        "if(!fl.saveDocument(doc,u)){var t=doc.getTimeline();var li=t.addNewLayer(\"__fd\");t.deleteLayer(li);fl.saveDocument(doc,u);}" ++
        "fl.closeDocument(doc,false);}";

    return std.fmt.allocPrint(arena,
        \\var OUT="file:///{s}/";
        \\var FLASHDRV_OUT=OUT;
        \\{s}
        \\try{{
        \\{s}
        \\}}catch(e){{try{{FLfile.write(OUT+"__ERROR__",String(e));}}catch(_e){{}}}}
        \\try{{FLfile.write(OUT+"__DONE__","1");}}catch(_e){{}}
        \\{s}
    , .{ fwd, helper, body, quit_line });
}

// ---------------------------------------------------------------------------
// HTTP response writers
// ---------------------------------------------------------------------------

fn sendText(stream: std.net.Stream, code: u16, reason: []const u8, body: []const u8) !void {
    var buf: [512]u8 = undefined;
    const head = try std.fmt.bufPrint(&buf, "HTTP/1.1 {d} {s}\r\nContent-Type: text/plain\r\nContent-Length: {d}\r\nConnection: close\r\n\r\n", .{ code, reason, body.len });
    try stream.writeAll(head);
    try stream.writeAll(body);
}

fn sendArchive(stream: std.net.Stream, body: []const u8, err_text: []const u8, count: usize) !void {
    var hb = std.ArrayList(u8).init(std.heap.page_allocator);
    defer hb.deinit();
    const w = hb.writer();
    try w.print("HTTP/1.1 200 OK\r\nContent-Type: application/x-flashdrv\r\nX-Flashdrv-Count: {d}\r\n", .{count});
    if (err_text.len > 0) {
        // one-line the error for the header
        const line = try std.heap.page_allocator.dupe(u8, err_text);
        defer std.heap.page_allocator.free(line);
        for (line) |*c| {
            if (c.* == '\r' or c.* == '\n') c.* = ' ';
        }
        try w.print("X-Flashdrv-Error: {s}\r\n", .{line});
    }
    try w.print("Content-Length: {d}\r\nConnection: close\r\n\r\n", .{body.len});
    try stream.writeAll(hb.items);
    try stream.writeAll(body);
}

// ---------------------------------------------------------------------------
// client
// ---------------------------------------------------------------------------

fn serverHostPort(args: [][:0]u8) HostPort {
    var s = optVal(args, "--server", "http://localhost:8080");
    if (std.mem.startsWith(u8, s, "http://")) s = s["http://".len..];
    if (std.mem.indexOfScalar(u8, s, '/')) |i| s = s[0..i];
    return splitHostPort(s, 8080);
}

fn clientPing(gpa: std.mem.Allocator, args: [][:0]u8) !void {
    const hp = serverHostPort(args);
    const stream = std.net.tcpConnectToHost(gpa, hp.host, hp.port) catch |err| {
        std.debug.print("connect {s}:{d} failed: {s}\n", .{ hp.host, hp.port, @errorName(err) });
        std.process.exit(1);
    };
    defer stream.close();
    const reqline = try std.fmt.allocPrint(gpa, "GET /ping HTTP/1.1\r\nHost: {s}\r\nConnection: close\r\n\r\n", .{hp.host});
    defer gpa.free(reqline);
    try stream.writeAll(reqline);
    const resp = try readAll(gpa, stream);
    defer gpa.free(resp);
    const body = httpBody(resp);
    std.debug.print("{s}", .{body});
}

fn clientRun(gpa: std.mem.Allocator, args: [][:0]u8) !void {
    const hp = serverHostPort(args);
    const script_path = optVal(args, "--script", "-");
    const out_dir = optVal(args, "--out", "./corpus");
    const timeout = optVal(args, "--timeout", "180");
    const quit = hasFlag(args, "--quit"); // close Flash after this run

    const script = if (std.mem.eql(u8, script_path, "-"))
        try std.io.getStdIn().readToEndAlloc(gpa, MAX_FILE)
    else
        try std.fs.cwd().readFileAlloc(gpa, script_path, MAX_FILE);
    defer gpa.free(script);

    const stream = std.net.tcpConnectToHost(gpa, hp.host, hp.port) catch |err| {
        std.debug.print("connect {s}:{d} failed: {s}\n", .{ hp.host, hp.port, @errorName(err) });
        std.process.exit(1);
    };
    defer stream.close();

    const head = try std.fmt.allocPrint(gpa, "POST /run?timeout={s}&quit={s} HTTP/1.1\r\nHost: {s}\r\nContent-Type: application/x-jsfl\r\nContent-Length: {d}\r\nConnection: close\r\n\r\n", .{ timeout, if (quit) "1" else "0", hp.host, script.len });
    defer gpa.free(head);
    try stream.writeAll(head);
    try stream.writeAll(script);

    const resp = try readAll(gpa, stream);
    defer gpa.free(resp);

    const status = httpStatus(resp);
    if (httpHeader(resp, "x-flashdrv-error")) |e| {
        std.debug.print("JSFL error: {s}\n", .{e});
    }
    const body = httpBody(resp);
    if (status != 200) {
        std.debug.print("server error {d}: {s}\n", .{ status, body });
        std.process.exit(1);
    }

    try std.fs.cwd().makePath(out_dir);
    var dir = try std.fs.cwd().openDir(out_dir, .{});
    defer dir.close();

    var i: usize = 0;
    var n: usize = 0;
    while (i + 4 <= body.len) {
        const name_len = std.mem.readInt(u32, body[i..][0..4], .little);
        i += 4;
        if (i + name_len > body.len) break;
        const name = body[i .. i + name_len];
        i += name_len;
        if (i + 4 > body.len) break;
        const data_len = std.mem.readInt(u32, body[i..][0..4], .little);
        i += 4;
        if (i + data_len > body.len) break;
        const data = body[i .. i + data_len];
        i += data_len;
        try dir.writeFile(.{ .sub_path = name, .data = data });
        std.debug.print("  {s} ({d} bytes)\n", .{ name, data_len });
        n += 1;
    }
    std.debug.print("wrote {d} file(s) to {s}\n", .{ n, out_dir });
}

fn readAll(alloc: std.mem.Allocator, stream: std.net.Stream) ![]u8 {
    var buf = std.ArrayList(u8).init(alloc);
    var tmp: [8192]u8 = undefined;
    while (true) {
        const k = try stream.read(&tmp);
        if (k == 0) break;
        try buf.appendSlice(tmp[0..k]);
    }
    return buf.toOwnedSlice();
}

fn httpStatus(resp: []const u8) u16 {
    const sp = std.mem.indexOfScalar(u8, resp, ' ') orelse return 0;
    var it = std.mem.tokenizeScalar(u8, resp[sp + 1 ..], ' ');
    const code = it.next() orelse return 0;
    return std.fmt.parseInt(u16, code, 10) catch 0;
}

fn httpBody(resp: []const u8) []const u8 {
    if (std.mem.indexOf(u8, resp, "\r\n\r\n")) |idx| return resp[idx + 4 ..];
    return resp;
}

fn httpHeader(resp: []const u8, name_lower: []const u8) ?[]const u8 {
    const head_end = std.mem.indexOf(u8, resp, "\r\n\r\n") orelse resp.len;
    var lines = std.mem.splitSequence(u8, resp[0..head_end], "\r\n");
    _ = lines.next(); // status line
    while (lines.next()) |line| {
        const colon = std.mem.indexOfScalar(u8, line, ':') orelse continue;
        if (std.ascii.eqlIgnoreCase(std.mem.trim(u8, line[0..colon], " \t"), name_lower)) {
            return std.mem.trim(u8, line[colon + 1 ..], " \t");
        }
    }
    return null;
}
