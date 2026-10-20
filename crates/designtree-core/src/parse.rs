//! Parser for devicetree source (`.dts`).
//!
//! The result is a [`Document`] that mirrors the source: root blocks,
//! `&label { }` overrides and deletions stay separate items, so a later stage
//! can either merge them into one tree ([`crate::import`]) or keep them apart.
//! The C preprocessor is not run: `#include` and macros are rejected with a
//! clear error.

use std::fmt;

use crate::model::{Cell, ValueChunk};

/// 1-based line and column (in characters) in the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pos {
    pub line: u32,
    pub column: u32,
}

/// An error at a position in the source, either a syntax error or a
/// semantic one found while building the tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub pos: Pos,
    pub message: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}: {}", self.pos.line, self.pos.column, self.message)
    }
}

impl std::error::Error for ParseError {}

#[derive(Debug, Clone, PartialEq)]
pub struct Document {
    pub items: Vec<TopItem>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TopItem {
    /// `/ { ... };`
    Root(NodeBody),
    /// `&label { ... };` or `&{/path} { ... };`
    Override { target: Reference, body: NodeBody },
    /// `/delete-node/ &label;`
    DeleteNode(Reference),
}

/// `&label` or `&{/path}`; `target` is the label, or the path when it starts
/// with `/`.
#[derive(Debug, Clone, PartialEq)]
pub struct Reference {
    pub target: String,
    pub pos: Pos,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct NodeBody {
    pub items: Vec<BodyItem>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum BodyItem {
    Property(PropertyDef),
    DeleteProperty { name: String, pos: Pos },
    Node(NodeDef),
    DeleteNode { name: String, pos: Pos },
}

#[derive(Debug, Clone, PartialEq)]
pub struct PropertyDef {
    pub name: String,
    /// Comma-separated chunks; empty for a boolean property.
    pub value: Vec<ValueChunk>,
    /// Every reference in `value`, in order, with its position.
    pub references: Vec<Reference>,
    pub pos: Pos,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NodeDef {
    pub label: Option<String>,
    /// Full name including the unit address, e.g. `serial@10000000`.
    pub name: String,
    pub body: NodeBody,
    pub pos: Pos,
}

/// Parses devicetree source text.
pub fn parse(source: &str) -> Result<Document> {
    Parser {
        chars: source.chars().collect(),
        i: 0,
        pos: Pos { line: 1, column: 1 },
    }
    .document()
}

const PREPROCESSOR_DIRECTIVES: &[&str] = &[
    "include", "define", "undef", "if", "ifdef", "ifndef", "elif", "else", "endif", "error",
    "warning", "pragma", "line",
];

/// Binary operators by increasing precedence, as in C.
const BINARY_OPERATORS: &[&[&str]] = &[
    &["||"],
    &["&&"],
    &["|"],
    &["^"],
    &["&"],
    &["==", "!="],
    &["<=", ">=", "<", ">"],
    &["<<", ">>"],
    &["+", "-"],
    &["*", "/", "%"],
];

fn is_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || ",._+*#?@-".contains(c)
}

fn is_label_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn is_path_char(c: char) -> bool {
    is_name_char(c) || c == '/'
}

type Result<T> = std::result::Result<T, ParseError>;

struct Parser {
    chars: Vec<char>,
    i: usize,
    pos: Pos,
}

impl Parser {
    fn peek(&self) -> Option<char> {
        self.peek_at(0)
    }

    fn peek_at(&self, n: usize) -> Option<char> {
        self.chars.get(self.i + n).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek()?;
        self.i += 1;
        if c == '\n' {
            self.pos.line += 1;
            self.pos.column = 1;
        } else {
            self.pos.column += 1;
        }
        Some(c)
    }

    fn error<T>(&self, pos: Pos, message: impl Into<String>) -> Result<T> {
        Err(ParseError {
            pos,
            message: message.into(),
        })
    }

    fn unsupported<T>(&self, pos: Pos, what: &str) -> Result<T> {
        self.error(pos, format!("{what} is not supported yet"))
    }

    /// Describes the next character for error messages.
    fn found(&self) -> String {
        match self.peek() {
            Some(c) => format!("found `{c}`"),
            None => "found end of file".into(),
        }
    }

    fn skip_trivia(&mut self) -> Result<()> {
        loop {
            match (self.peek(), self.peek_at(1)) {
                (Some(c), _) if c.is_whitespace() => {
                    self.bump();
                }
                (Some('/'), Some('/')) => {
                    while self.peek().is_some_and(|c| c != '\n') {
                        self.bump();
                    }
                }
                (Some('/'), Some('*')) => {
                    let start = self.pos;
                    self.bump();
                    self.bump();
                    loop {
                        match self.bump() {
                            Some('*') if self.peek() == Some('/') => {
                                self.bump();
                                break;
                            }
                            Some(_) => {}
                            None => return self.error(start, "unterminated comment"),
                        }
                    }
                }
                (Some('#'), _) if self.at_line_marker() => {
                    while self.peek().is_some_and(|c| c != '\n') {
                        self.bump();
                    }
                }
                (Some('#'), _) if self.at_preprocessor_directive() => {
                    return self.error(
                        self.pos,
                        "C preprocessor directives (`#include`, `#define`, ...) are not \
                         supported yet; preprocess the file with `cpp` first",
                    );
                }
                _ => return Ok(()),
            }
        }
    }

    /// Index of the first non-blank character after a `#` that starts a
    /// line, or `None` if the `#` is not at the start of a line.
    fn after_line_start_hash(&self) -> Option<usize> {
        let line_start = self.chars[..self.i]
            .iter()
            .rev()
            .take_while(|&&c| c != '\n')
            .all(|c| c.is_whitespace());
        if !line_start {
            return None;
        }
        let mut j = self.i + 1;
        while self.chars.get(j).is_some_and(|&c| c == ' ' || c == '\t') {
            j += 1;
        }
        Some(j)
    }

    /// True at a line marker written by `cpp` (`# 12 "board.dts"`).
    // TODO(US-1.2): use line markers to report positions in the original files.
    fn at_line_marker(&self) -> bool {
        self.after_line_start_hash()
            .is_some_and(|j| self.chars.get(j).is_some_and(char::is_ascii_digit))
    }

    /// True at a `#` that starts a line and introduces a preprocessor
    /// directive, as opposed to a property such as `#address-cells`.
    fn at_preprocessor_directive(&self) -> bool {
        let Some(mut j) = self.after_line_start_hash() else {
            return false;
        };
        let start = j;
        while self.chars.get(j).is_some_and(char::is_ascii_lowercase) {
            j += 1;
        }
        let word: String = self.chars[start..j].iter().collect();
        PREPROCESSOR_DIRECTIVES.contains(&word.as_str())
            && !self.chars.get(j).is_some_and(|&c| is_name_char(c))
    }

    /// The `word` of a `/word/` keyword at the cursor, without consuming it.
    fn peek_keyword(&self) -> Option<String> {
        if self.peek() != Some('/') {
            return None;
        }
        let word: String = self.chars[self.i + 1..]
            .iter()
            .take_while(|&&c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            .collect();
        let closed = self.peek_at(word.len() + 1) == Some('/');
        (!word.is_empty() && closed).then_some(word)
    }

    fn consume_keyword(&mut self, word: &str) {
        for _ in 0..word.len() + 2 {
            self.bump();
        }
    }

    fn expect(&mut self, expected: char) -> Result<()> {
        self.skip_trivia()?;
        if self.peek() == Some(expected) {
            self.bump();
            Ok(())
        } else {
            self.error(self.pos, format!("expected `{expected}`, {}", self.found()))
        }
    }

    fn eat(&mut self, c: char) -> Result<bool> {
        self.skip_trivia()?;
        let found = self.peek() == Some(c);
        if found {
            self.bump();
        }
        Ok(found)
    }

    fn document(&mut self) -> Result<Document> {
        let mut items = Vec::new();
        let mut has_version = false;
        loop {
            self.skip_trivia()?;
            let pos = self.pos;
            match self.peek() {
                None => break,
                Some('/') => match self.peek_keyword().as_deref() {
                    Some("dts-v1") => {
                        self.consume_keyword("dts-v1");
                        self.expect(';')?;
                        has_version = true;
                    }
                    Some("delete-node") => {
                        self.consume_keyword("delete-node");
                        self.skip_trivia()?;
                        if self.peek() != Some('&') {
                            return self.error(
                                self.pos,
                                format!(
                                    "expected `&label` after top-level `/delete-node/`, {}",
                                    self.found()
                                ),
                            );
                        }
                        let target = self.reference()?;
                        self.expect(';')?;
                        items.push(TopItem::DeleteNode(target));
                    }
                    Some(word) => return self.top_level_keyword(pos, word),
                    None => {
                        if !has_version {
                            return self.error(pos, "missing `/dts-v1/;` before the root node");
                        }
                        self.bump();
                        items.push(TopItem::Root(self.node_body()?));
                    }
                },
                Some('&') => {
                    let target = self.reference()?;
                    let body = self.node_body()?;
                    items.push(TopItem::Override { target, body });
                }
                Some(_) if self.at_label() => {
                    return self.unsupported(pos, "a label on a top-level override");
                }
                Some(_) => {
                    return self.error(
                        pos,
                        format!(
                            "expected `/ {{`, `&label {{` or a directive, {}",
                            self.found()
                        ),
                    );
                }
            }
        }
        if !has_version {
            return self.error(self.pos, "missing `/dts-v1/;` header");
        }
        Ok(Document { items })
    }

    fn top_level_keyword<T>(&self, pos: Pos, word: &str) -> Result<T> {
        match word {
            "plugin" => self.unsupported(pos, "`/plugin/` (devicetree overlays)"),
            "memreserve" | "omit-if-no-ref" | "include" => {
                self.unsupported(pos, &format!("`/{word}/`"))
            }
            _ => self.error(pos, format!("unknown directive `/{word}/`")),
        }
    }

    /// `{ items };`
    fn node_body(&mut self) -> Result<NodeBody> {
        self.expect('{')?;
        let mut body = NodeBody::default();
        loop {
            self.skip_trivia()?;
            let pos = self.pos;
            match self.peek() {
                Some('}') => {
                    self.bump();
                    self.expect(';')?;
                    return Ok(body);
                }
                None => return self.error(pos, "expected `}`, found end of file"),
                Some('/') => {
                    let item = match self.peek_keyword().as_deref() {
                        Some("delete-property") => {
                            self.consume_keyword("delete-property");
                            let name = self.name()?;
                            BodyItem::DeleteProperty { name, pos }
                        }
                        Some("delete-node") => {
                            self.consume_keyword("delete-node");
                            let name = self.name()?;
                            BodyItem::DeleteNode { name, pos }
                        }
                        Some("omit-if-no-ref") => {
                            return self.unsupported(pos, "`/omit-if-no-ref/`")
                        }
                        Some(word) => {
                            return self.error(pos, format!("unknown directive `/{word}/`"))
                        }
                        None => {
                            return self.error(
                                pos,
                                format!("expected a property or a child node, {}", self.found()),
                            )
                        }
                    };
                    self.expect(';')?;
                    body.items.push(item);
                }
                Some(_) => body.items.push(self.body_definition()?),
            }
        }
    }

    /// A property or a child node, optionally preceded by a label.
    fn body_definition(&mut self) -> Result<BodyItem> {
        let label_pos = self.pos;
        let label = if self.at_label() {
            let label = self.label();
            self.skip_trivia()?;
            if self.at_label() {
                return self.unsupported(self.pos, "more than one label on a node");
            }
            Some(label)
        } else {
            None
        };
        let pos = self.pos;
        let name = self.name()?;
        self.skip_trivia()?;
        match self.peek() {
            Some('{') => {
                let body = self.node_body()?;
                Ok(BodyItem::Node(NodeDef {
                    label,
                    name,
                    body,
                    pos,
                }))
            }
            Some('=' | ';') if label.is_some() => {
                self.unsupported(label_pos, "a label on a property")
            }
            Some('=' | ';') => {
                let (value, references) = if self.eat('=')? {
                    self.value()?
                } else {
                    Default::default()
                };
                self.expect(';')?;
                Ok(BodyItem::Property(PropertyDef {
                    name,
                    value,
                    references,
                    pos,
                }))
            }
            _ => self.error(
                self.pos,
                format!("expected `{{`, `=` or `;` after `{name}`, {}", self.found()),
            ),
        }
    }

    /// True if the cursor is on a label definition (`uart0:`).
    fn at_label(&self) -> bool {
        let rest = &self.chars[self.i..];
        let len = rest.iter().take_while(|&&c| is_label_char(c)).count();
        len > 0 && !rest[0].is_ascii_digit() && rest.get(len) == Some(&':')
    }

    fn label(&mut self) -> String {
        let mut label = String::new();
        while self.peek().is_some_and(is_label_char) {
            label.extend(self.bump());
        }
        self.bump(); // ':'
        label
    }

    fn name(&mut self) -> Result<String> {
        self.skip_trivia()?;
        let mut name = String::new();
        while self.peek().is_some_and(is_name_char) {
            name.extend(self.bump());
        }
        if name.is_empty() {
            return self.error(
                self.pos,
                format!("expected a property or node name, {}", self.found()),
            );
        }
        Ok(name)
    }

    /// `&label` or `&{/path}`.
    fn reference(&mut self) -> Result<Reference> {
        let pos = self.pos;
        self.bump(); // '&'
        let mut target = String::new();
        if self.peek() == Some('{') {
            self.bump();
            while self.peek().is_some_and(is_path_char) {
                target.extend(self.bump());
            }
            if !target.starts_with('/') {
                return self.error(pos, "a path reference must start with `/`: `&{/path}`");
            }
            if self.bump() != Some('}') {
                return self.error(pos, "unterminated path reference, expected `}`");
            }
        } else {
            while self.peek().is_some_and(is_label_char) {
                target.extend(self.bump());
            }
            if target.is_empty() {
                return self.error(pos, "expected a label or `{/path}` after `&`");
            }
        }
        Ok(Reference { target, pos })
    }

    /// The comma-separated chunks of a property value.
    fn value(&mut self) -> Result<(Vec<ValueChunk>, Vec<Reference>)> {
        let mut chunks = Vec::new();
        let mut references = Vec::new();
        loop {
            self.skip_trivia()?;
            let pos = self.pos;
            let chunk = match self.peek() {
                Some('"') => ValueChunk::String {
                    value: self.string()?,
                },
                Some('<') => self.cells(32, &mut references)?,
                Some('[') => ValueChunk::Bytes {
                    value: self.bytes()?,
                },
                Some('&') => {
                    let reference = self.reference()?;
                    let target = reference.target.clone();
                    references.push(reference);
                    ValueChunk::Path { target }
                }
                Some('/') => match self.peek_keyword().as_deref() {
                    Some("bits") => {
                        self.consume_keyword("bits");
                        self.skip_trivia()?;
                        let bits_pos = self.pos;
                        let bits = match self.literal()? {
                            n @ (8 | 16 | 32 | 64) => n as u8,
                            _ => return self.error(bits_pos, "`/bits/` must be 8, 16, 32 or 64"),
                        };
                        self.skip_trivia()?;
                        if self.peek() != Some('<') {
                            return self.error(
                                self.pos,
                                format!("expected `<` after `/bits/ {bits}`, {}", self.found()),
                            );
                        }
                        self.cells(bits, &mut references)?
                    }
                    Some("incbin") => return self.unsupported(pos, "`/incbin/`"),
                    _ => return self.error(pos, format!("expected a value, {}", self.found())),
                },
                _ => return self.error(pos, format!("expected a value, {}", self.found())),
            };
            chunks.push(chunk);
            if !self.eat(',')? {
                return Ok((chunks, references));
            }
        }
    }

    /// `<1 0x2 &label (3 + 4)>`, cells of `bits` width.
    fn cells(&mut self, bits: u8, references: &mut Vec<Reference>) -> Result<ValueChunk> {
        self.bump(); // '<'
        let mask = if bits == 64 {
            u64::MAX
        } else {
            (1u64 << bits) - 1
        };
        let mut cells = Vec::new();
        loop {
            self.skip_trivia()?;
            let pos = self.pos;
            match self.peek() {
                Some('>') => {
                    self.bump();
                    return Ok(ValueChunk::Cells { bits, cells });
                }
                Some('&') => {
                    if bits != 32 {
                        return self.error(pos, "references are only allowed in 32-bit cells");
                    }
                    let reference = self.reference()?;
                    cells.push(Cell::Phandle {
                        phandle: reference.target.clone(),
                    });
                    references.push(reference);
                }
                Some(_) if self.at_label() => {
                    return self.unsupported(pos, "a label inside a property value");
                }
                None => return self.error(pos, "expected `>`, found end of file"),
                Some(_) => {
                    let value = self.primary()?;
                    // Like dtc, accept negative values: their bits above
                    // the cell width are all ones.
                    if value > mask && (value | mask) != u64::MAX {
                        return self
                            .error(pos, format!("value {value:#x} does not fit in {bits} bits"));
                    }
                    cells.push(Cell::Number(value & mask));
                }
            }
        }
    }

    fn bytes(&mut self) -> Result<Vec<u8>> {
        self.bump(); // '['
        let mut bytes = Vec::new();
        loop {
            self.skip_trivia()?;
            if self.peek() == Some(']') {
                self.bump();
                return Ok(bytes);
            }
            let pos = self.pos;
            let pair = (self.peek(), self.peek_at(1));
            match pair {
                (Some(hi), Some(lo)) if hi.is_ascii_hexdigit() && lo.is_ascii_hexdigit() => {
                    self.bump();
                    self.bump();
                    let digits = [hi, lo].iter().collect::<String>();
                    bytes.push(u8::from_str_radix(&digits, 16).expect("two hex digits"));
                }
                _ => {
                    return self.error(
                        pos,
                        format!("expected two hex digits or `]`, {}", self.found()),
                    )
                }
            }
        }
    }

    fn string(&mut self) -> Result<String> {
        let pos = self.pos;
        self.bump(); // '"'
        let mut bytes = Vec::new();
        loop {
            match self.bump() {
                Some('"') => break,
                Some('\\') => bytes.push(self.escape(pos)?),
                Some(c) => {
                    let mut buf = [0; 4];
                    bytes.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
                }
                None => return self.error(pos, "unterminated string"),
            }
        }
        String::from_utf8(bytes).or_else(|_| self.error(pos, "string is not valid UTF-8"))
    }

    /// The character after a backslash, as in dtc (and C).
    fn escape(&mut self, pos: Pos) -> Result<u8> {
        let c = match self.bump() {
            Some(c) => c,
            None => return self.error(pos, "unterminated escape sequence"),
        };
        let byte = match c {
            'a' => 0x07,
            'b' => 0x08,
            't' => b'\t',
            'n' => b'\n',
            'v' => 0x0b,
            'f' => 0x0c,
            'r' => b'\r',
            'x' => {
                let digits = self.take_digits(2, 16);
                if digits.is_empty() {
                    return self.error(pos, "`\\x` needs at least one hex digit");
                }
                u8::from_str_radix(&digits, 16).expect("hex digits")
            }
            '0'..='7' => {
                let digits = c.to_string() + &self.take_digits(2, 8);
                u8::try_from(u32::from_str_radix(&digits, 8).expect("octal digits"))
                    .or_else(|_| self.error(pos, "octal escape out of range"))?
            }
            c if c.is_ascii() => c as u8,
            _ => return self.error(pos, "invalid escape sequence"),
        };
        Ok(byte)
    }

    fn take_digits(&mut self, max: usize, radix: u32) -> String {
        let mut digits = String::new();
        while digits.len() < max && self.peek().is_some_and(|c| c.is_digit(radix)) {
            digits.extend(self.bump());
        }
        digits
    }

    /// An integer literal, `'c'` or a parenthesized expression: the forms dtc
    /// accepts directly inside `<...>`.
    fn primary(&mut self) -> Result<u64> {
        self.skip_trivia()?;
        let pos = self.pos;
        match self.peek() {
            Some('(') => {
                self.bump();
                let value = self.expression()?;
                self.expect(')')?;
                Ok(value)
            }
            Some('\'') => {
                self.bump();
                let value = match self.bump() {
                    Some('\\') => u64::from(self.escape(pos)?),
                    Some(c) if c.is_ascii() && c != '\'' => c as u64,
                    _ => return self.error(pos, "invalid character literal"),
                };
                if self.bump() != Some('\'') {
                    return self.error(pos, "unterminated character literal");
                }
                Ok(value)
            }
            Some(c) if c.is_ascii_digit() => self.literal(),
            _ => self.error(pos, format!("expected a number, {}", self.found())),
        }
    }

    /// Decimal, hex (`0x`) or octal (leading `0`) literal with optional C
    /// suffixes (`U`, `L`, `UL`, `ULL`).
    fn literal(&mut self) -> Result<u64> {
        let pos = self.pos;
        let mut text = String::new();
        while self.peek().is_some_and(|c| c.is_ascii_alphanumeric()) {
            text.extend(self.bump());
        }
        let digits = text.trim_end_matches(['u', 'U', 'l', 'L']);
        let parsed = if let Some(hex) = digits
            .strip_prefix("0x")
            .or_else(|| digits.strip_prefix("0X"))
        {
            u64::from_str_radix(hex, 16)
        } else if digits.len() > 1 && digits.starts_with('0') {
            u64::from_str_radix(&digits[1..], 8)
        } else {
            digits.parse()
        };
        parsed.or_else(|_| self.error(pos, format!("invalid number `{text}`")))
    }

    /// A C integer expression, evaluated on 64-bit unsigned values as dtc does.
    fn expression(&mut self) -> Result<u64> {
        let condition = self.binary(0)?;
        if !self.eat('?')? {
            return Ok(condition);
        }
        let then = self.expression()?;
        self.expect(':')?;
        let otherwise = self.expression()?;
        Ok(if condition != 0 { then } else { otherwise })
    }

    fn binary(&mut self, level: usize) -> Result<u64> {
        let Some(operators) = BINARY_OPERATORS.get(level) else {
            return self.unary();
        };
        let mut lhs = self.binary(level + 1)?;
        loop {
            self.skip_trivia()?;
            let pos = self.pos;
            let Some(op) = operators.iter().find(|op| self.at_operator(op)) else {
                return Ok(lhs);
            };
            for _ in 0..op.len() {
                self.bump();
            }
            let rhs = self.binary(level + 1)?;
            lhs = match *op {
                "||" => u64::from(lhs != 0 || rhs != 0),
                "&&" => u64::from(lhs != 0 && rhs != 0),
                "|" => lhs | rhs,
                "^" => lhs ^ rhs,
                "&" => lhs & rhs,
                "==" => u64::from(lhs == rhs),
                "!=" => u64::from(lhs != rhs),
                "<=" => u64::from(lhs <= rhs),
                ">=" => u64::from(lhs >= rhs),
                "<" => u64::from(lhs < rhs),
                ">" => u64::from(lhs > rhs),
                "<<" => lhs
                    .checked_shl(rhs.try_into().unwrap_or(u32::MAX))
                    .unwrap_or(0),
                ">>" => lhs
                    .checked_shr(rhs.try_into().unwrap_or(u32::MAX))
                    .unwrap_or(0),
                "+" => lhs.wrapping_add(rhs),
                "-" => lhs.wrapping_sub(rhs),
                "*" => lhs.wrapping_mul(rhs),
                "/" | "%" if rhs == 0 => return self.error(pos, "division by zero"),
                "/" => lhs / rhs,
                "%" => lhs % rhs,
                _ => unreachable!("operator table and evaluation are out of sync"),
            };
        }
    }

    /// True if `op` is at the cursor and is not the start of a longer
    /// operator (`<` in `<<` or `<=`, `&` in `&&`).
    fn at_operator(&self, op: &str) -> bool {
        let matches = op
            .chars()
            .enumerate()
            .all(|(k, c)| self.peek_at(k) == Some(c));
        if !matches || op.len() > 1 {
            return matches;
        }
        let first = op.chars().next().expect("operators are not empty");
        let next = self.peek_at(1);
        !(next == Some(first) && "<>&|".contains(first)
            || next == Some('=') && "<>".contains(first))
    }

    fn unary(&mut self) -> Result<u64> {
        self.skip_trivia()?;
        match self.peek() {
            Some('-') => {
                self.bump();
                Ok(self.unary()?.wrapping_neg())
            }
            Some('~') => {
                self.bump();
                Ok(!self.unary()?)
            }
            Some('!') => {
                self.bump();
                Ok(u64::from(self.unary()? == 0))
            }
            _ => self.primary(),
        }
    }
}
