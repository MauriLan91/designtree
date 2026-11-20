//! Reads a devicetree blob (`.dtb`) back into source (US-1.7), as
//! `dtc -I dtb -O dts` does: every value written as strings, cells or
//! bytes, whichever its bytes look like, phandles as numbers. Import then
//! restores the references (see [`crate::phandles`]).
//!
//! The blob is untrusted input: every offset and length is checked, the
//! nesting depth is bounded, and names are checked against the characters
//! devicetree source allows, so nothing in a blob can change the meaning of
//! the source written from it.

use std::fmt::Write;

use thiserror::Error;

use crate::dts::quote;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum DtbError {
    #[error("not a devicetree blob")]
    BadMagic,
    #[error("unsupported devicetree blob version {0}")]
    Version(u32),
    #[error("truncated or malformed devicetree blob")]
    Malformed,
    #[error("the blob nests nodes deeper than {MAX_DEPTH} levels")]
    TooDeep,
    #[error("invalid {kind} name `{name}` in the blob")]
    BadName { kind: &'static str, name: String },
}

const MAGIC: u32 = 0xd00d_feed;
const BEGIN_NODE: u32 = 1;
const END_NODE: u32 = 2;
const PROP: u32 = 3;
const NOP: u32 = 4;
const END: u32 = 9;
/// Deeper than any real tree, and shallow enough for the importer.
const MAX_DEPTH: usize = 64;

/// True if `blob` starts like a devicetree blob.
pub fn is_dtb(blob: &[u8]) -> bool {
    blob.get(..4) == Some(&MAGIC.to_be_bytes())
}

struct Reader<'a> {
    structs: &'a [u8],
    strings: &'a [u8],
    pos: usize,
}

impl Reader<'_> {
    fn u32(&mut self) -> Result<u32, DtbError> {
        let end = self.pos.checked_add(4).ok_or(DtbError::Malformed)?;
        let bytes = self.structs.get(self.pos..end).ok_or(DtbError::Malformed)?;
        self.pos = end;
        Ok(u32::from_be_bytes(bytes.try_into().expect("four bytes")))
    }

    fn align(&mut self) {
        self.pos = self.pos.saturating_add(3) & !3;
    }

    /// The NUL-terminated text at `at` in `data`.
    fn text(data: &[u8], at: usize) -> Result<&str, DtbError> {
        let rest = data.get(at..).ok_or(DtbError::Malformed)?;
        let len = rest
            .iter()
            .position(|b| *b == 0)
            .ok_or(DtbError::Malformed)?;
        std::str::from_utf8(&rest[..len]).map_err(|_| DtbError::Malformed)
    }

    /// Writes the node whose `BEGIN_NODE` was just read, at `depth`.
    fn node(&mut self, depth: usize, out: &mut String) -> Result<(), DtbError> {
        if depth > MAX_DEPTH {
            return Err(DtbError::TooDeep);
        }
        let name = Self::text(self.structs, self.pos)?;
        self.pos += name.len() + 1;
        self.align();
        let indent = "\t".repeat(depth);
        if depth == 0 {
            out.push_str("/ {\n");
        } else {
            check_name("node", name, is_node_char)?;
            let _ = writeln!(out, "\n{indent}{name} {{");
        }
        loop {
            match self.u32()? {
                PROP => {
                    let len = self.u32()? as usize;
                    let name = Self::text(self.strings, self.u32()? as usize)?;
                    check_name("property", name, is_property_char)?;
                    let end = self.pos.checked_add(len).ok_or(DtbError::Malformed)?;
                    let value = self.structs.get(self.pos..end).ok_or(DtbError::Malformed)?;
                    self.pos = end;
                    self.align();
                    let _ = writeln!(out, "{indent}\t{name}{};", format_value(value));
                }
                BEGIN_NODE => self.node(depth + 1, out)?,
                END_NODE => {
                    let _ = writeln!(out, "{indent}}};");
                    return Ok(());
                }
                NOP => {}
                _ => return Err(DtbError::Malformed),
            }
        }
    }
}

fn is_node_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || ",._+-@".contains(c)
}

fn is_property_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || ",._+*#?-".contains(c)
}

fn check_name(kind: &'static str, name: &str, ok: fn(char) -> bool) -> Result<(), DtbError> {
    if name.is_empty() || !name.chars().all(ok) {
        return Err(DtbError::BadName {
            kind,
            name: name.escape_default().to_string(),
        });
    }
    Ok(())
}

/// ` = value`, or nothing for an empty value, guessed from the bytes as dtc
/// does: printable NUL-terminated strings, else 32-bit cells, else bytes.
fn format_value(value: &[u8]) -> String {
    if value.is_empty() {
        return String::new();
    }
    if let Some(strings) = as_strings(value) {
        let quoted: Vec<String> = strings.iter().map(|s| quote(s)).collect();
        return format!(" = {}", quoted.join(", "));
    }
    if value.len() % 4 == 0 {
        let cells: Vec<String> = value
            .chunks(4)
            .map(|c| {
                format!(
                    "{:#04x}",
                    u32::from_be_bytes(c.try_into().expect("four bytes"))
                )
            })
            .collect();
        return format!(" = <{}>", cells.join(" "));
    }
    let bytes: Vec<String> = value.iter().map(|b| format!("{b:02x}")).collect();
    format!(" = [{}]", bytes.join(" "))
}

/// The strings of a value made of non-empty printable strings.
fn as_strings(value: &[u8]) -> Option<Vec<&str>> {
    let body = value.strip_suffix(&[0])?;
    let strings: Vec<&str> = body
        .split(|b| *b == 0)
        .map(|s| std::str::from_utf8(s).ok())
        .collect::<Option<_>>()?;
    let printable = |s: &&str| {
        !s.is_empty()
            && s.bytes()
                .all(|b| (0x20..0x7f).contains(&b) || b == b'\t' || b == b'\n')
    };
    strings.iter().all(printable).then_some(strings)
}

/// The source of a devicetree blob.
pub fn decompile(blob: &[u8]) -> Result<String, DtbError> {
    let word = |i: usize| -> Result<u32, DtbError> {
        let bytes = blob.get(i * 4..i * 4 + 4).ok_or(DtbError::Malformed)?;
        Ok(u32::from_be_bytes(bytes.try_into().expect("four bytes")))
    };
    if !is_dtb(blob) {
        return Err(DtbError::BadMagic);
    }
    // Version 17 added the size of the structure block; 16 is the oldest
    // a reader of 17 must accept.
    let version = word(5)?;
    if version < 16 || word(6)? > 17 {
        return Err(DtbError::Version(version));
    }
    let slice = |offset: u32, size: u32| {
        let start = offset as usize;
        let end = start
            .checked_add(size as usize)
            .ok_or(DtbError::Malformed)?;
        blob.get(start..end).ok_or(DtbError::Malformed)
    };
    let total = (word(1)? as usize).min(blob.len());
    let (structs_at, strings_at, reserve_at) = (word(2)?, word(3)?, word(4)? as usize);
    let strings = slice(strings_at, word(8)?)?;
    let structs = if version >= 17 {
        slice(structs_at, word(9)?)?
    } else {
        blob.get(structs_at as usize..total)
            .ok_or(DtbError::Malformed)?
    };

    let mut out = String::from("/dts-v1/;\n\n");
    let mut at = reserve_at;
    loop {
        let entry = blob
            .get(at..at.checked_add(16).ok_or(DtbError::Malformed)?)
            .ok_or(DtbError::Malformed)?;
        let address = u64::from_be_bytes(entry[..8].try_into().expect("eight bytes"));
        let size = u64::from_be_bytes(entry[8..].try_into().expect("eight bytes"));
        if address == 0 && size == 0 {
            break;
        }
        let _ = writeln!(out, "/memreserve/ {address:#018x} {size:#018x};");
        at += 16;
    }
    if at != reserve_at {
        out.push('\n');
    }

    let mut reader = Reader {
        structs,
        strings,
        pos: 0,
    };
    loop {
        match reader.u32()? {
            NOP => {}
            BEGIN_NODE => {
                reader.node(0, &mut out)?;
                loop {
                    match reader.u32()? {
                        NOP => {}
                        END => return Ok(out),
                        _ => return Err(DtbError::Malformed),
                    }
                }
            }
            _ => return Err(DtbError::Malformed),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_are_written_as_their_bytes_look() {
        assert_eq!(format_value(b""), "");
        assert_eq!(format_value(b"okay\0"), " = \"okay\"");
        assert_eq!(format_value(b"a\0b\0"), " = \"a\", \"b\"");
        assert_eq!(
            format_value(&[0, 0, 0, 1, 0, 0, 0x10, 0]),
            " = <0x01 0x1000>"
        );
        assert_eq!(format_value(&[0, 0x11, 0x22]), " = [00 11 22]");
        // An empty string among others reads as numbers, so it stays exact.
        assert_eq!(format_value(b"\0" as &[u8]), " = [00]");
        assert_eq!(format_value(b"\x002K\0"), " = <0x324b00>");
        assert_eq!(format_value(b"q\"\\\0"), " = \"q\\\"\\\\\"");
    }

    fn blob(source: &str) -> Vec<u8> {
        let graph = crate::import_dts(
            source,
            std::path::Path::new("board.dts"),
            &crate::ImportOptions::default(),
        )
        .unwrap();
        crate::to_dtb(&graph).unwrap().blob
    }

    const BOARD: &str = "/dts-v1/;
/memreserve/ 0x40000000 0x1000;
/ {
	#address-cells = <1>;
	#size-cells = <1>;
	osc: osc { #clock-cells = <0>; };
	serial@1000 { reg = <0x1000 0x100>; clocks = <&osc>; status = \"okay\"; mac = [00 11 22]; };
};
";

    #[test]
    fn a_blob_reads_back_as_source() {
        let source = decompile(&blob(BOARD)).unwrap();
        assert!(source
            .starts_with("/dts-v1/;\n\n/memreserve/ 0x0000000040000000 0x0000000000001000;\n"));
        assert!(source.contains("\tserial@1000 {\n\t\treg = <0x1000 0x100>;\n\t\tclocks = <0x01>;\n\t\tstatus = \"okay\";\n\t\tmac = [00 11 22];\n\t};\n"), "{source}");
        // The same blob again.
        assert_eq!(blob(&source), blob(BOARD));
    }

    #[test]
    fn hostile_blobs_are_refused() {
        assert_eq!(decompile(b"not a blob"), Err(DtbError::BadMagic));
        assert_eq!(decompile(&MAGIC.to_be_bytes()), Err(DtbError::Malformed));
        let good = blob(BOARD);
        // Every truncation fails cleanly.
        for len in 4..good.len() {
            assert!(decompile(&good[..len]).is_err(), "truncated to {len}");
        }
        let with = |word: usize, value: u32| {
            let mut bad = good.clone();
            bad[word * 4..word * 4 + 4].copy_from_slice(&value.to_be_bytes());
            decompile(&bad)
        };
        assert_eq!(with(2, u32::MAX), Err(DtbError::Malformed));
        assert_eq!(with(8, u32::MAX), Err(DtbError::Malformed));
        assert_eq!(with(5, 3), Err(DtbError::Version(3)));
        // A property name that would change the meaning of the source.
        let mut bad = good.clone();
        let at = bad.windows(6).position(|w| w == b"status").unwrap();
        bad[at..at + 6].copy_from_slice(b"st{tus");
        assert!(matches!(decompile(&bad), Err(DtbError::BadName { .. })));
        // Nesting deeper than the limit.
        let mut deep = String::from("/dts-v1/;\n/ {");
        for _ in 0..=MAX_DEPTH {
            deep.push_str(" n {");
        }
        for _ in 0..=MAX_DEPTH {
            deep.push_str(" };");
        }
        deep.push_str(" };\n");
        assert_eq!(decompile(&blob(&deep)), Err(DtbError::TooDeep));
    }
}
