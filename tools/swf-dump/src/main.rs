//! swf-dump — normalize an SWF into stable JSON for golden FLA/SWF diffing.
//!
//! Task 0698: the golden harness compares our SWF export against a reference
//! Flash 8 SWF. Raw bytes never match (different char-id allocation, tool
//! metadata, timestamps), so we normalize both SWFs to a canonical JSON form
//! and diff that instead.
//!
//! Normalization rules:
//!   * Drop non-semantic tags: FileAttributes, Metadata, EnableDebugger,
//!     EnableDebugger2, ProductInfo, DebugId, EnableTelemetry.
//!   * Renumber character IDs in first-use order so two SWFs that allocate IDs
//!     differently compare apples-to-apples.
//!   * Decode shape records to {type: moveTo|lineTo|curveTo, ...}.
//!   * Decode matrices to {scaleX, scaleY, skew0, skew1, translateX, translateY}.
//!   * Emit bytecode (DoAction / DoInitAction) as a hex string.
//!
//! Usage: swf-dump <file.swf>   →   normalized JSON on stdout.

use std::cell::RefCell;
use std::collections::HashMap;
use std::process::ExitCode;

use serde_json::{json, Map, Value};
use swf::{FillStyle, Matrix, PlaceObjectAction, ShapeRecord, Tag};

/// Remaps original SWF character IDs to a stable, first-use-order numbering.
struct IdRemap {
    map: RefCell<HashMap<u16, u32>>,
    next: RefCell<u32>,
}

impl IdRemap {
    fn new() -> Self {
        Self {
            map: RefCell::new(HashMap::new()),
            next: RefCell::new(1),
        }
    }

    /// Return the normalized id for `original`, allocating one on first use.
    fn get(&self, original: u16) -> u32 {
        let mut map = self.map.borrow_mut();
        if let Some(&id) = map.get(&original) {
            return id;
        }
        let mut next = self.next.borrow_mut();
        let assigned = *next;
        *next += 1;
        map.insert(original, assigned);
        assigned
    }
}

fn main() -> ExitCode {
    let path = match std::env::args().nth(1) {
        Some(p) => p,
        None => {
            eprintln!("usage: swf-dump <file.swf>");
            return ExitCode::FAILURE;
        }
    };

    let data = match std::fs::read(&path) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("swf-dump: failed to read {path}: {e}");
            return ExitCode::FAILURE;
        }
    };

    let stream = match swf::decompress_swf(&data[..]) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("swf-dump: failed to decompress SWF: {e}");
            return ExitCode::FAILURE;
        }
    };
    let swf = match swf::parse_swf(&stream) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("swf-dump: failed to parse SWF: {e}");
            return ExitCode::FAILURE;
        }
    };

    let remap = IdRemap::new();

    let header = json!({
        "version": swf.header.version(),
        "frameRate": swf.header.frame_rate().to_f64(),
        "numFrames": swf.header.num_frames(),
        "stage": rect_to_json(swf.header.stage_size()),
    });

    let tags: Vec<Value> = swf
        .tags
        .iter()
        .filter_map(|t| normalize_tag(t, &remap))
        .collect();

    let out = json!({
        "header": header,
        "tags": tags,
    });

    println!("{}", serde_json::to_string_pretty(&out).unwrap());
    ExitCode::SUCCESS
}

/// Convert one tag into a normalized JSON object, or `None` if it should be
/// dropped from the canonical representation.
fn normalize_tag(tag: &Tag, remap: &IdRemap) -> Option<Value> {
    match tag {
        // ---- Dropped: non-semantic / tool / debug metadata --------------
        Tag::FileAttributes(_)
        | Tag::Metadata(_)
        | Tag::EnableDebugger(_)
        | Tag::ProductInfo(_)
        | Tag::DebugId(_)
        | Tag::EnableTelemetry { .. } => None,

        Tag::ShowFrame => Some(json!({ "tag": "ShowFrame" })),
        Tag::End => Some(json!({ "tag": "End" })),

        Tag::SetBackgroundColor(color) => Some(json!({
            "tag": "SetBackgroundColor",
            "color": color_to_json(color),
        })),

        Tag::DefineShape(shape) => Some(json!({
            "tag": "DefineShape",
            "version": shape.version,
            "id": remap.get(shape.id),
            "bounds": rect_to_json(&shape.shape_bounds),
            "edgeBounds": rect_to_json(&shape.edge_bounds),
            "fillStyles": shape.styles.fill_styles.iter().map(|f| fill_style_to_json(f, remap)).collect::<Vec<_>>(),
            "lineStyles": shape.styles.line_styles.iter().map(line_style_to_json).collect::<Vec<_>>(),
            "records": shape_records_to_json(&shape.shape),
        })),

        // ---- Static text (DefineText / DefineText2) ----------------------
        // Structured so the parity harness can compare TextRecord offsets,
        // height, color, and the glyph-index sequence (task 1195).
        Tag::DefineText(text) | Tag::DefineText2(text) => Some(json!({
            "tag": tag_name(tag),
            "id": remap.get(text.id),
            "bounds": rect_to_json(&text.bounds),
            "matrix": matrix_to_json(&text.matrix),
            "records": text.records.iter().map(|r| text_record_to_json(r, remap)).collect::<Vec<_>>(),
        })),

        // ---- Dynamic / input text (DefineEditText) -----------------------
        // The harness previously could not resolve this character's type
        // because no `id` was emitted (task 1195). Emit id + easily-available
        // fields. Fields are guarded accessors returning Option, so absent
        // optionals are simply omitted.
        Tag::DefineEditText(et) => {
            let mut obj = Map::new();
            obj.insert("tag".into(), Value::String("DefineEditText".into()));
            obj.insert("id".into(), json!(remap.get(et.id())));
            obj.insert("bounds".into(), rect_to_json(et.bounds()));
            if let Some(fid) = et.font_id() {
                obj.insert("fontId".into(), json!(remap.get(fid)));
            }
            if let Some(h) = et.height() {
                obj.insert("height".into(), json!(h.get()));
            }
            if let Some(c) = et.color() {
                obj.insert("color".into(), color_to_json(&c));
            }
            Some(Value::Object(obj))
        }

        Tag::DefineSprite(sprite) => Some(json!({
            "tag": "DefineSprite",
            "id": remap.get(sprite.id),
            "numFrames": sprite.num_frames,
            "tags": sprite.tags.iter().filter_map(|t| normalize_tag(t, remap)).collect::<Vec<_>>(),
        })),

        Tag::PlaceObject(po) => {
            let mut obj = Map::new();
            obj.insert("tag".into(), Value::String(format!("PlaceObject{}", po.version)));
            obj.insert("depth".into(), json!(po.depth));
            match po.action {
                PlaceObjectAction::Place(id) => {
                    obj.insert("action".into(), Value::String("place".into()));
                    obj.insert("characterId".into(), json!(remap.get(id)));
                }
                PlaceObjectAction::Replace(id) => {
                    obj.insert("action".into(), Value::String("replace".into()));
                    obj.insert("characterId".into(), json!(remap.get(id)));
                }
                PlaceObjectAction::Modify => {
                    obj.insert("action".into(), Value::String("modify".into()));
                }
            }
            if let Some(m) = &po.matrix {
                obj.insert("matrix".into(), matrix_to_json(m));
            }
            if let Some(ratio) = po.ratio {
                obj.insert("ratio".into(), json!(ratio));
            }
            if let Some(name) = po.name {
                obj.insert("name".into(), json!(name.to_string_lossy(swf::SwfStr::encoding_for_version(8))));
            }
            if let Some(cd) = po.clip_depth {
                obj.insert("clipDepth".into(), json!(cd));
            }
            if let Some(bm) = po.blend_mode {
                obj.insert("blendMode".into(), Value::String(format!("{bm:?}")));
            }
            if let Some(filters) = &po.filters {
                obj.insert(
                    "filters".into(),
                    Value::Array(filters.iter().map(|f| Value::String(format!("{f:?}"))).collect()),
                );
            }
            if let Some(ct) = &po.color_transform {
                obj.insert("colorTransform".into(), Value::String(format!("{ct:?}")));
            }
            if let Some(ca) = &po.clip_actions {
                obj.insert("clipActions".into(), Value::String(format!("{ca:?}")));
            }
            Some(Value::Object(obj))
        }

        Tag::RemoveObject(ro) => {
            let mut obj = json!({ "tag": "RemoveObject", "depth": ro.depth });
            if let Some(id) = ro.character_id {
                obj["characterId"] = json!(remap.get(id));
            }
            Some(obj)
        }

        Tag::DoAction(action) => Some(json!({
            "tag": "DoAction",
            "bytecode": hex(action),
        })),

        Tag::DoInitAction { id, action_data } => Some(json!({
            "tag": "DoInitAction",
            "id": remap.get(*id),
            "bytecode": hex(action_data),
        })),

        Tag::FrameLabel(fl) => Some(json!({
            "tag": "FrameLabel",
            "label": fl.label.to_string_lossy(swf::SwfStr::encoding_for_version(8)),
            "isAnchor": fl.is_anchor,
        })),

        Tag::ExportAssets(assets) => Some(json!({
            "tag": "ExportAssets",
            "assets": assets.iter().map(|a| json!({
                "id": remap.get(a.id),
                "name": a.name.to_string_lossy(swf::SwfStr::encoding_for_version(8)),
            })).collect::<Vec<_>>(),
        })),

        Tag::DefineSceneAndFrameLabelData(d) => Some(json!({
            "tag": "DefineSceneAndFrameLabelData",
            "scenes": d.scenes.iter().map(|s| json!({
                "frameNum": s.frame_num,
                "label": s.label.to_string_lossy(swf::SwfStr::encoding_for_version(8)),
            })).collect::<Vec<_>>(),
            "frameLabels": d.frame_labels.iter().map(|f| json!({
                "frameNum": f.frame_num,
                "label": f.label.to_string_lossy(swf::SwfStr::encoding_for_version(8)),
            })).collect::<Vec<_>>(),
        })),

        // ---- Character-defining tags whose body we don't fully decode ----
        // Still renumber the character id so ordering / references line up.
        Tag::DefineBits { id, .. }
        | Tag::DefineBitsJpeg2 { id, .. } => Some(json!({
            "tag": format!("{:?}", tag_name(tag)),
            "id": remap.get(*id),
        })),

        // ---- Everything else: name + Debug fallback ----------------------
        other => Some(json!({
            "tag": tag_name(other),
            "debug": format!("{other:?}"),
        })),
    }
}

fn tag_name(tag: &Tag) -> &'static str {
    match tag {
        Tag::ExportAssets(_) => "ExportAssets",
        Tag::ScriptLimits { .. } => "ScriptLimits",
        Tag::ShowFrame => "ShowFrame",
        Tag::Protect(_) => "Protect",
        Tag::CsmTextSettings(_) => "CsmTextSettings",
        Tag::DebugId(_) => "DebugId",
        Tag::DefineBinaryData(_) => "DefineBinaryData",
        Tag::DefineBits { .. } => "DefineBits",
        Tag::DefineBitsJpeg2 { .. } => "DefineBitsJpeg2",
        Tag::DefineBitsJpeg3(_) => "DefineBitsJpeg3",
        Tag::DefineBitsLossless(_) => "DefineBitsLossless",
        Tag::DefineButton(_) => "DefineButton",
        Tag::DefineButton2(_) => "DefineButton2",
        Tag::DefineButtonColorTransform(_) => "DefineButtonColorTransform",
        Tag::DefineButtonSound(_) => "DefineButtonSound",
        Tag::DefineEditText(_) => "DefineEditText",
        Tag::DefineFont(_) => "DefineFont",
        Tag::DefineFont2(_) => "DefineFont2",
        Tag::DefineFont4(_) => "DefineFont4",
        Tag::DefineFontAlignZones { .. } => "DefineFontAlignZones",
        Tag::DefineFontInfo(_) => "DefineFontInfo",
        Tag::DefineFontName { .. } => "DefineFontName",
        Tag::DefineMorphShape(_) => "DefineMorphShape",
        Tag::DefineScalingGrid { .. } => "DefineScalingGrid",
        Tag::DefineShape(_) => "DefineShape",
        Tag::DefineSound(_) => "DefineSound",
        Tag::DefineSprite(_) => "DefineSprite",
        Tag::DefineText(_) => "DefineText",
        Tag::DefineText2(_) => "DefineText2",
        Tag::DefineVideoStream(_) => "DefineVideoStream",
        Tag::DoAbc(_) => "DoAbc",
        Tag::DoAbc2(_) => "DoAbc2",
        Tag::DoAction(_) => "DoAction",
        Tag::DoInitAction { .. } => "DoInitAction",
        Tag::EnableDebugger(_) => "EnableDebugger",
        Tag::EnableTelemetry { .. } => "EnableTelemetry",
        Tag::End => "End",
        Tag::Metadata(_) => "Metadata",
        Tag::ImportAssets { .. } => "ImportAssets",
        Tag::JpegTables(_) => "JpegTables",
        Tag::NameCharacter(_) => "NameCharacter",
        Tag::SetBackgroundColor(_) => "SetBackgroundColor",
        Tag::SetTabIndex { .. } => "SetTabIndex",
        Tag::SoundStreamBlock(_) => "SoundStreamBlock",
        Tag::SoundStreamHead(_) => "SoundStreamHead",
        Tag::SoundStreamHead2(_) => "SoundStreamHead2",
        Tag::StartSound(_) => "StartSound",
        Tag::StartSound2 { .. } => "StartSound2",
        Tag::SymbolClass(_) => "SymbolClass",
        Tag::PlaceObject(_) => "PlaceObject",
        Tag::RemoveObject(_) => "RemoveObject",
        Tag::VideoFrame(_) => "VideoFrame",
        Tag::FileAttributes(_) => "FileAttributes",
        Tag::FrameLabel(_) => "FrameLabel",
        Tag::DefineSceneAndFrameLabelData(_) => "DefineSceneAndFrameLabelData",
        Tag::ProductInfo(_) => "ProductInfo",
        Tag::Unknown { .. } => "Unknown",
    }
}

// ---------------------------------------------------------------------------
// Sub-record decoders
// ---------------------------------------------------------------------------

/// Decode one DefineText TEXTRECORD into structured JSON. Style-change fields
/// (font_id, color, x_offset, y_offset, height) are emitted when present; the
/// glyph run is emitted as {index, advance} pairs so the harness can compare
/// glyph-index sequences (font-independent) and per-glyph advances separately.
fn text_record_to_json(r: &swf::TextRecord, remap: &IdRemap) -> Value {
    let mut obj = Map::new();
    if let Some(fid) = r.font_id {
        obj.insert("fontId".into(), json!(remap.get(fid)));
    }
    if let Some(c) = &r.color {
        obj.insert("color".into(), color_to_json(c));
    }
    if let Some(x) = r.x_offset {
        obj.insert("xOffset".into(), json!(x.get()));
    }
    if let Some(y) = r.y_offset {
        obj.insert("yOffset".into(), json!(y.get()));
    }
    if let Some(h) = r.height {
        obj.insert("height".into(), json!(h.get()));
    }
    obj.insert(
        "glyphs".into(),
        Value::Array(
            r.glyphs
                .iter()
                .map(|g| json!({ "index": g.index, "advance": g.advance }))
                .collect(),
        ),
    );
    Value::Object(obj)
}

fn matrix_to_json(m: &Matrix) -> Value {
    json!({
        "scaleX": m.a.to_f64(),
        "scaleY": m.d.to_f64(),
        "skew0": m.b.to_f64(),
        "skew1": m.c.to_f64(),
        "translateX": m.tx.get(),
        "translateY": m.ty.get(),
    })
}

fn color_to_json(c: &swf::Color) -> Value {
    json!({ "r": c.r, "g": c.g, "b": c.b, "a": c.a })
}

fn rect_to_json(r: &swf::Rectangle<swf::Twips>) -> Value {
    json!({
        "xMin": r.x_min.get(),
        "xMax": r.x_max.get(),
        "yMin": r.y_min.get(),
        "yMax": r.y_max.get(),
    })
}

fn fill_style_to_json(f: &FillStyle, remap: &IdRemap) -> Value {
    match f {
        FillStyle::Color(c) => json!({ "type": "solid", "color": color_to_json(c) }),
        FillStyle::LinearGradient(g) => json!({
            "type": "linearGradient",
            "matrix": matrix_to_json(&g.matrix),
            "records": g.records.iter().map(|r| json!({
                "ratio": r.ratio, "color": color_to_json(&r.color)
            })).collect::<Vec<_>>(),
        }),
        FillStyle::RadialGradient(g) => json!({
            "type": "radialGradient",
            "matrix": matrix_to_json(&g.matrix),
            "records": g.records.iter().map(|r| json!({
                "ratio": r.ratio, "color": color_to_json(&r.color)
            })).collect::<Vec<_>>(),
        }),
        FillStyle::FocalGradient { gradient, focal_point } => json!({
            "type": "focalGradient",
            "focalPoint": focal_point.to_f64(),
            "matrix": matrix_to_json(&gradient.matrix),
            "records": gradient.records.iter().map(|r| json!({
                "ratio": r.ratio, "color": color_to_json(&r.color)
            })).collect::<Vec<_>>(),
        }),
        FillStyle::Bitmap { id, matrix, is_smoothed, is_repeating } => json!({
            "type": "bitmap",
            "bitmapId": remap.get(*id),
            "matrix": matrix_to_json(matrix),
            "smoothed": is_smoothed,
            "repeating": is_repeating,
        }),
    }
}

fn line_style_to_json(l: &swf::LineStyle) -> Value {
    json!({
        "width": l.width().get(),
        "fill": match l.fill_style() {
            FillStyle::Color(c) => color_to_json(c),
            other => Value::String(format!("{other:?}")),
        },
        "startCap": format!("{:?}", l.start_cap()),
        "endCap": format!("{:?}", l.end_cap()),
        "joinStyle": format!("{:?}", l.join_style()),
    })
}

/// Decode a shape record stream into a flat list of {type, ...} drawing ops.
/// Edge deltas are accumulated into an absolute pen position so two SWFs that
/// split records differently still produce comparable absolute coordinates.
fn shape_records_to_json(records: &[ShapeRecord]) -> Value {
    let mut out: Vec<Value> = Vec::new();
    let mut x: i32 = 0;
    let mut y: i32 = 0;
    for rec in records {
        match rec {
            ShapeRecord::StyleChange(sc) => {
                let mut obj = Map::new();
                obj.insert("type".into(), Value::String("styleChange".into()));
                if let Some(p) = sc.move_to {
                    x = p.x.get();
                    y = p.y.get();
                    obj.insert("type".into(), Value::String("moveTo".into()));
                    obj.insert("x".into(), json!(x));
                    obj.insert("y".into(), json!(y));
                }
                if let Some(fs) = sc.fill_style_0 {
                    obj.insert("fillStyle0".into(), json!(fs));
                }
                if let Some(fs) = sc.fill_style_1 {
                    obj.insert("fillStyle1".into(), json!(fs));
                }
                if let Some(ls) = sc.line_style {
                    obj.insert("lineStyle".into(), json!(ls));
                }
                if sc.new_styles.is_some() {
                    obj.insert("newStyles".into(), json!(true));
                }
                out.push(Value::Object(obj));
            }
            ShapeRecord::StraightEdge { delta } => {
                x += delta.dx.get();
                y += delta.dy.get();
                out.push(json!({ "type": "lineTo", "x": x, "y": y }));
            }
            ShapeRecord::CurvedEdge { control_delta, anchor_delta } => {
                let cx = x + control_delta.dx.get();
                let cy = y + control_delta.dy.get();
                x = cx + anchor_delta.dx.get();
                y = cy + anchor_delta.dy.get();
                out.push(json!({
                    "type": "curveTo",
                    "controlX": cx, "controlY": cy,
                    "x": x, "y": y
                }));
            }
        }
    }
    Value::Array(out)
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}
