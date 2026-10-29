//! Symbolic constants of the kernel's `include/dt-bindings` headers
//! (`GPIO_ACTIVE_LOW`, `IRQ_TYPE_LEVEL_HIGH`, ...), so cells can be written by
//! name. Only object-like `#define`s whose value is an integer expression are
//! kept; anything else is skipped.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use walkdir::WalkDir;

/// Headers larger than this are not read.
const MAX_HEADER_BYTES: u64 = 2 * 1024 * 1024;

/// One constant of a `dt-bindings` header.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DtMacro {
    pub name: String,
    pub value: u32,
    /// Header as written in `#include <...>`, e.g. `dt-bindings/gpio/gpio.h`.
    pub header: String,
}

/// Reads the constants of every header below `<linux_src>/include/dt-bindings`.
/// Symbolic links are not followed, so the tree cannot lead out of the checkout.
pub fn index_dt_macros(linux_src: &Path) -> Vec<DtMacro> {
    let root = linux_src.join("include/dt-bindings");
    let mut files: Vec<_> = WalkDir::new(&root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "h"))
        .collect();
    files.sort();

    // Constants defined by earlier headers are visible to later ones, which
    // covers the headers that build on each other.
    let mut known: HashMap<String, u32> = HashMap::new();
    let mut macros = Vec::new();
    for path in files {
        if fs::metadata(&path).map_or(true, |m| m.len() > MAX_HEADER_BYTES) {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let header = format!(
            "dt-bindings/{}",
            path.strip_prefix(&root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/")
        );
        for (name, value) in defines(&text, &mut known) {
            macros.push(DtMacro {
                name,
                value,
                header: header.clone(),
            });
        }
    }
    macros
}

/// The integer constants a header defines, in order; they are added to
/// `known` for the headers that follow.
fn defines(text: &str, known: &mut HashMap<String, u32>) -> Vec<(String, u32)> {
    let text = strip_comments(text);
    let mut found = Vec::new();
    for line in text.lines() {
        let Some(rest) = line.trim().strip_prefix('#') else {
            continue;
        };
        let Some(rest) = rest.trim_start().strip_prefix("define") else {
            continue;
        };
        let rest = rest.trim_start();
        let name_end = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(rest.len());
        let (name, body) = rest.split_at(name_end);
        // `NAME(args)` is function-like.
        if name.is_empty() || body.starts_with('(') {
            continue;
        }
        if let Some(value) = Expr::new(body, known).eval() {
            known.insert(name.to_owned(), value);
            found.push((name.to_owned(), value));
        }
    }
    found
}

fn strip_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("/*") {
        out.push_str(&rest[..at]);
        match rest[at + 2..].find("*/") {
            // Keep the line structure of the text the comment covered.
            Some(end) => {
                out.extend(rest[at..at + 2 + end].chars().filter(|c| *c == '\n'));
                rest = &rest[at + 2 + end + 2..];
            }
            None => return out,
        }
    }
    out.push_str(rest);
    out.lines()
        .map(|l| l.split("//").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Integer expression: literals, known constants, parentheses and
/// `| & << >> + -` with C precedence. Arithmetic is in `i64` and the result
/// must fit a cell.
struct Expr<'a> {
    tokens: Vec<String>,
    at: usize,
    known: &'a HashMap<String, u32>,
}

impl<'a> Expr<'a> {
    fn new(text: &str, known: &'a HashMap<String, u32>) -> Self {
        let mut tokens = Vec::new();
        let mut chars = text.chars().peekable();
        while let Some(&c) = chars.peek() {
            if c.is_whitespace() {
                chars.next();
            } else if c.is_ascii_alphanumeric() || c == '_' {
                let mut word = String::new();
                while let Some(&c) = chars.peek() {
                    if !(c.is_ascii_alphanumeric() || c == '_') {
                        break;
                    }
                    word.push(c);
                    chars.next();
                }
                tokens.push(word);
            } else {
                chars.next();
                let two = match (c, chars.peek()) {
                    ('<', Some('<')) | ('>', Some('>')) => {
                        chars.next();
                        Some(format!("{c}{c}"))
                    }
                    _ => None,
                };
                tokens.push(two.unwrap_or_else(|| c.to_string()));
            }
        }
        Expr {
            tokens,
            at: 0,
            known,
        }
    }

    fn eval(mut self) -> Option<u32> {
        if self.tokens.is_empty() {
            return None;
        }
        let value = self.or()?;
        if self.at != self.tokens.len() {
            return None;
        }
        u32::try_from(value).ok()
    }

    fn peek(&self) -> Option<&str> {
        self.tokens.get(self.at).map(String::as_str)
    }

    fn eat(&mut self, op: &str) -> bool {
        if self.peek() == Some(op) {
            self.at += 1;
            true
        } else {
            false
        }
    }

    fn or(&mut self) -> Option<i64> {
        let mut value = self.and()?;
        while self.eat("|") {
            value |= self.and()?;
        }
        Some(value)
    }

    fn and(&mut self) -> Option<i64> {
        let mut value = self.shift()?;
        while self.eat("&") {
            value &= self.shift()?;
        }
        Some(value)
    }

    fn shift(&mut self) -> Option<i64> {
        let mut value = self.sum()?;
        loop {
            if self.eat("<<") {
                value = value.checked_shl(u32::try_from(self.sum()?).ok().filter(|n| *n < 63)?)?;
            } else if self.eat(">>") {
                value = value.checked_shr(u32::try_from(self.sum()?).ok().filter(|n| *n < 63)?)?;
            } else {
                return Some(value);
            }
        }
    }

    fn sum(&mut self) -> Option<i64> {
        let mut value = self.atom()?;
        loop {
            if self.eat("+") {
                value = value.checked_add(self.atom()?)?;
            } else if self.eat("-") {
                value = value.checked_sub(self.atom()?)?;
            } else {
                return Some(value);
            }
        }
    }

    fn atom(&mut self) -> Option<i64> {
        if self.eat("(") {
            let value = self.or()?;
            return self.eat(")").then_some(value);
        }
        if self.eat("~") {
            return Some(!self.atom()? & 0xffff_ffff);
        }
        let token = self.tokens.get(self.at)?.clone();
        self.at += 1;
        if token.starts_with(|c: char| c.is_ascii_digit()) {
            parse_int(&token)
        } else {
            self.known.get(&token).map(|v| i64::from(*v))
        }
    }
}

/// A C integer literal: decimal, hex or octal, with `u`/`l` suffixes.
fn parse_int(token: &str) -> Option<i64> {
    let digits = token.trim_end_matches(['u', 'U', 'l', 'L']);
    match digits
        .strip_prefix("0x")
        .or_else(|| digits.strip_prefix("0X"))
    {
        Some(hex) => i64::from_str_radix(hex, 16).ok(),
        None if digits.len() > 1 && digits.starts_with('0') => i64::from_str_radix(digits, 8).ok(),
        None => digits.parse().ok(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(text: &str) -> Vec<(String, u32)> {
        defines(text, &mut HashMap::new())
    }

    #[test]
    fn literals_and_expressions() {
        let found = values(
            "#define A 1\n#define B 0x10 /* hex */\n#define C (1 << 3)\n#define D (A | C)\n\
             #define E 0x7fU\n#define F ~0\n#define G (B + 2) // sum\n",
        );
        let get = |n: &str| found.iter().find(|(k, _)| k == n).map(|(_, v)| *v);
        assert_eq!(get("A"), Some(1));
        assert_eq!(get("B"), Some(16));
        assert_eq!(get("C"), Some(8));
        assert_eq!(get("D"), Some(9));
        assert_eq!(get("E"), Some(127));
        assert_eq!(get("F"), Some(0xffff_ffff));
        assert_eq!(get("G"), Some(18));
    }

    #[test]
    fn skips_what_is_not_a_constant() {
        let found = values(
            "#define BIT(n) (1 << (n))\n#define NAME \"text\"\n#define UNKNOWN OTHER_MACRO\n\
             #define EMPTY\n#define HUGE 0x1ffffffff\n#define NEG (-1)\n#define OK 3\n",
        );
        assert_eq!(found, vec![("OK".to_owned(), 3)]);
    }

    #[test]
    fn indexes_a_header_tree() {
        let dir = std::env::temp_dir().join(format!("designtree-macros-{}", std::process::id()));
        let gpio = dir.join("include/dt-bindings/gpio");
        std::fs::create_dir_all(&gpio).unwrap();
        std::fs::write(
            gpio.join("gpio.h"),
            "#define GPIO_ACTIVE_HIGH 0\n#define GPIO_ACTIVE_LOW 1\n",
        )
        .unwrap();
        let macros = index_dt_macros(&dir);
        assert_eq!(
            macros,
            vec![
                DtMacro {
                    name: "GPIO_ACTIVE_HIGH".into(),
                    value: 0,
                    header: "dt-bindings/gpio/gpio.h".into()
                },
                DtMacro {
                    name: "GPIO_ACTIVE_LOW".into(),
                    value: 1,
                    header: "dt-bindings/gpio/gpio.h".into()
                },
            ]
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
