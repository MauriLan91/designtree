//! Reads a flattened devicetree (`.dtb`), the input dt-schema validates.

use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum FdtError {
    #[error("not a devicetree blob")]
    BadMagic,
    #[error("truncated or malformed devicetree blob")]
    Malformed,
}

/// A node of a devicetree blob, with raw property values.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FdtNode {
    /// `serial@1000`; empty for the root.
    pub name: String,
    pub properties: Vec<(String, Vec<u8>)>,
    pub children: Vec<FdtNode>,
}

const MAGIC: u32 = 0xd00d_feed;
const BEGIN_NODE: u32 = 1;
const END_NODE: u32 = 2;
const PROP: u32 = 3;
const NOP: u32 = 4;
const END: u32 = 9;

struct Reader<'a> {
    data: &'a [u8],
    strings: &'a [u8],
    pos: usize,
}

impl Reader<'_> {
    fn u32(&mut self) -> Result<u32, FdtError> {
        let bytes = self
            .data
            .get(self.pos..self.pos + 4)
            .ok_or(FdtError::Malformed)?;
        self.pos += 4;
        Ok(u32::from_be_bytes(bytes.try_into().unwrap()))
    }

    fn align(&mut self) {
        self.pos = (self.pos + 3) & !3;
    }

    fn name(&mut self) -> Result<String, FdtError> {
        let rest = self.data.get(self.pos..).ok_or(FdtError::Malformed)?;
        let len = rest
            .iter()
            .position(|b| *b == 0)
            .ok_or(FdtError::Malformed)?;
        let name = String::from_utf8_lossy(&rest[..len]).into_owned();
        self.pos += len + 1;
        self.align();
        Ok(name)
    }

    fn string(&self, offset: usize) -> Result<String, FdtError> {
        let rest = self.strings.get(offset..).ok_or(FdtError::Malformed)?;
        let len = rest
            .iter()
            .position(|b| *b == 0)
            .ok_or(FdtError::Malformed)?;
        Ok(String::from_utf8_lossy(&rest[..len]).into_owned())
    }

    /// Reads a node whose `BEGIN_NODE` token was just consumed.
    fn node(&mut self, depth: usize) -> Result<FdtNode, FdtError> {
        if depth > 64 {
            return Err(FdtError::Malformed);
        }
        let mut node = FdtNode {
            name: self.name()?,
            ..FdtNode::default()
        };
        loop {
            match self.u32()? {
                PROP => {
                    let len = self.u32()? as usize;
                    let offset = self.u32()? as usize;
                    let name = self.string(offset)?;
                    let value = self
                        .data
                        .get(self.pos..self.pos + len)
                        .ok_or(FdtError::Malformed)?
                        .to_vec();
                    self.pos += len;
                    self.align();
                    node.properties.push((name, value));
                }
                BEGIN_NODE => node.children.push(self.node(depth + 1)?),
                END_NODE => return Ok(node),
                NOP => {}
                _ => return Err(FdtError::Malformed),
            }
        }
    }
}

/// Parses a devicetree blob into its root node.
pub fn parse_fdt(blob: &[u8]) -> Result<FdtNode, FdtError> {
    let word = |i: usize| -> Result<usize, FdtError> {
        let bytes = blob.get(i * 4..i * 4 + 4).ok_or(FdtError::Malformed)?;
        Ok(u32::from_be_bytes(bytes.try_into().unwrap()) as usize)
    };
    if word(0)? as u32 != MAGIC {
        return Err(FdtError::BadMagic);
    }
    let (structs, strings) = (word(2)?, word(3)?);
    let (strings_size, structs_size) = (word(8)?, word(9)?);
    let data = blob
        .get(structs..structs + structs_size)
        .ok_or(FdtError::Malformed)?;
    let strings = blob
        .get(strings..strings + strings_size)
        .ok_or(FdtError::Malformed)?;
    let mut reader = Reader {
        data,
        strings,
        pos: 0,
    };
    loop {
        match reader.u32()? {
            NOP => {}
            BEGIN_NODE => {
                let root = reader.node(0)?;
                return match reader.u32()? {
                    END => Ok(root),
                    _ => Err(FdtError::Malformed),
                };
            }
            _ => return Err(FdtError::Malformed),
        }
    }
}
