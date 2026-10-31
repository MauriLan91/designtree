//! C preprocessor for devicetree sources.
//!
//! The kernel build runs `cpp -x assembler-with-cpp -undef -D__DTS__` on
//! every `.dts`; this module does the same work in-process: `#include`,
//! `#define` (object-like and function-like, with `#`, `##` and variadic
//! arguments), `#undef`, `#if`/`#ifdef`/`#ifndef`/`#elif`/`#else`/`#endif`,
//! `#error`, and dtc's own `/include/`. A `#` line that is not a directive
//! (`#address-cells = <1>;`) is ordinary text, as in cpp's assembler mode.
//!
//! The output carries line markers (`# 12 "board.dtsi"`) before every block
//! of text, so the parser reports positions in the original files.

use std::cell::Cell;
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

use crate::dts::quote;
use crate::parse::{evaluate, ImportError};

/// Include directory of the kernel build for devicetrees, relative to the
/// top of a kernel tree.
const KERNEL_INCLUDE_DIR: &str = "scripts/dtc/include-prefixes";

/// Where `#include` looks for files.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ImportOptions {
    /// Directories searched in order for `#include <...>`, and for
    /// `#include "..."` after the directory of the including file.
    pub include_dirs: Vec<PathBuf>,
}

impl ImportOptions {
    /// The include directory the kernel build uses for devicetrees in the
    /// kernel tree `linux`.
    pub fn kernel(linux: &Path) -> Self {
        ImportOptions {
            include_dirs: vec![linux.join(KERNEL_INCLUDE_DIR)],
        }
    }

    /// Kernel include directories when `file` lies in a kernel tree, none
    /// otherwise.
    pub fn detect(file: &Path) -> Self {
        Self::detect_or(file, None)
    }

    /// Like [`detect`](Self::detect), using the kernel tree `fallback` when
    /// `file` is not in one.
    pub fn detect_or(file: &Path, fallback: Option<&Path>) -> Self {
        match find_kernel_tree(file) {
            Some(linux) => Self::kernel(&linux),
            None => fallback.map(Self::kernel).unwrap_or_default(),
        }
    }
}

/// The kernel source tree that contains `file`, recognized by its
/// `scripts/dtc/include-prefixes` directory.
pub(crate) fn find_kernel_tree(file: &Path) -> Option<PathBuf> {
    let file = std::path::absolute(file).ok()?;
    file.ancestors()
        .skip(1)
        .find(|dir| dir.join(KERNEL_INCLUDE_DIR).is_dir())
        .map(Path::to_path_buf)
}

/// Reads a file; the import uses the file system, tests use a map.
pub(crate) type ReadFile<'a> = &'a dyn Fn(&Path) -> io::Result<String>;

/// Reads files for importing `file`, but only inside the directory of
/// `file`, the kernel tree it lies in, and the include directories (with
/// their kernel trees), so that a downloaded source cannot pull in, say,
/// `~/.ssh/id_rsa`. Symbolic links count where they point.
pub(crate) fn confined_reader(
    file: &Path,
    options: &ImportOptions,
) -> impl Fn(&Path) -> io::Result<String> {
    let kernel_of = |dir: &Path| {
        dir.ends_with(KERNEL_INCLUDE_DIR)
            .then(|| dir.ancestors().nth(3).map(Path::to_path_buf))
            .flatten()
    };
    let mut roots: Vec<PathBuf> = std::path::absolute(file)
        .ok()
        .and_then(|file| file.parent().map(Path::to_path_buf))
        .into_iter()
        .chain(find_kernel_tree(file))
        .collect();
    for dir in &options.include_dirs {
        roots.extend(kernel_of(dir));
        roots.push(dir.clone());
    }
    let roots: Vec<PathBuf> = roots
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .collect();
    move |path: &Path| {
        let real = path.canonicalize()?;
        if !roots.iter().any(|root| real.starts_with(root)) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "outside the directory of the imported file and the include directories",
            ));
        }
        std::fs::read_to_string(real)
    }
}

/// Nesting limit for `#include`, as in GCC.
const MAX_INCLUDE_DEPTH: usize = 200;
/// Limits against hostile sources, far above what kernel boards need (a few
/// hundred files, a few MiB of text, tens of thousands of macro expansions).
/// Total files read.
const MAX_FILES: usize = 10_000;
/// Total bytes read, and size of the preprocessed text.
const MAX_OUTPUT: usize = 64 << 20;
/// Total macro expansions.
const MAX_EXPANSIONS: usize = 1_000_000;
/// Nesting of macro expansions, including inside macro arguments.
const MAX_EXPANSION_DEPTH: usize = 200;

/// Directive names; a `#` line starting with anything else is text.
pub(crate) const DIRECTIVES: &[&str] = &[
    "include", "define", "undef", "if", "ifdef", "ifndef", "elif", "else", "endif", "error",
    "warning", "pragma", "line", "ident",
];

/// The result of [`preprocess`].
pub(crate) struct Preprocessed {
    pub text: String,
    /// Include directives of the top file, in order (`#include "a.dtsi"`),
    /// with its `#define`s and `#undef`s, which may configure the included
    /// files; each with its line.
    pub directives: Vec<(u32, String)>,
}

/// Preprocesses `source`, read from `file`.
pub(crate) fn preprocess(
    source: &str,
    file: &Path,
    options: &ImportOptions,
    read: ReadFile,
) -> Result<Preprocessed, ImportError> {
    let mut preprocessor = Preprocessor {
        options,
        read,
        // Defined by `cpp -x assembler-with-cpp -undef -D__DTS__`.
        macros: ["__DTS__", "__ASSEMBLER__"]
            .into_iter()
            .map(|name| {
                let one = Macro {
                    params: None,
                    variadic: false,
                    body: "1".into(),
                };
                (name.to_owned(), one)
            })
            .collect(),
        out: String::new(),
        directives: Vec::new(),
        depth: 0,
        files: 0,
        bytes_read: 0,
        expansions: Cell::new(0),
        nesting: Cell::new(0),
    };
    preprocessor.file(source, file)?;
    Ok(Preprocessed {
        text: preprocessor.out,
        directives: preprocessor.directives,
    })
}

struct Macro {
    /// `None` for an object-like macro.
    params: Option<Vec<String>>,
    /// The last parameter takes the remaining arguments.
    variadic: bool,
    body: String,
}

/// A source line after comments are removed and `\` continuations joined.
struct Line {
    /// Physical line number of its first line.
    number: u32,
    text: String,
    /// Physical lines it covers.
    span: u32,
}

struct Condition {
    /// Lines are kept.
    active: bool,
    /// A branch of this `#if` chain was taken.
    taken: bool,
    /// The enclosing region is active.
    parent_active: bool,
    line: u32,
}

/// An error at a byte offset into the text being expanded.
type ExpandError = (usize, String);

struct Preprocessor<'a> {
    options: &'a ImportOptions,
    read: ReadFile<'a>,
    macros: HashMap<String, Macro>,
    out: String,
    directives: Vec<(u32, String)>,
    /// Nesting of `#include`.
    depth: usize,
    files: usize,
    bytes_read: usize,
    expansions: Cell<usize>,
    /// Nesting of [`Preprocessor::expand_in`].
    nesting: Cell<usize>,
}

impl Preprocessor<'_> {
    fn file(&mut self, source: &str, path: &Path) -> Result<(), ImportError> {
        let name = path.display().to_string();
        let lines = logical_lines(source);
        let mut conditions: Vec<Condition> = Vec::new();
        let mut block: Vec<&Line> = Vec::new();
        for line in &lines {
            let active = conditions.last().is_none_or(|c| c.active);
            if let Some((directive, rest)) = directive(&line.text) {
                self.flush(&name, &mut block)?;
                let fail = |message: String| ImportError::new(&*name, line.number, message);
                match directive {
                    "if" | "ifdef" | "ifndef" => {
                        let condition = active
                            && match directive {
                                "if" => self.condition(rest).map_err(fail)?,
                                "ifdef" => self.macros.contains_key(identifier(rest)),
                                _ => !self.macros.contains_key(identifier(rest)),
                            };
                        conditions.push(Condition {
                            active: condition,
                            taken: condition,
                            parent_active: active,
                            line: line.number,
                        });
                    }
                    "elif" => {
                        let top = innermost(&mut conditions, directive).map_err(fail)?;
                        let take = top.parent_active
                            && !top.taken
                            && self.condition(rest).map_err(fail)?;
                        top.active = take;
                        top.taken |= take;
                    }
                    "else" => {
                        let top = innermost(&mut conditions, directive).map_err(fail)?;
                        top.active = top.parent_active && !top.taken;
                        top.taken = true;
                    }
                    "endif" => {
                        innermost(&mut conditions, directive).map_err(fail)?;
                        conditions.pop();
                    }
                    _ if !active => {}
                    "include" => {
                        let target = self.include_target(rest).map_err(fail)?;
                        self.directive(
                            line.number,
                            match &target {
                                IncludeTarget::Quoted(file) => format!("#include \"{file}\""),
                                IncludeTarget::Angle(file) => format!("#include <{file}>"),
                            },
                        );
                        self.include(&target, path, &name, line.number)?;
                    }
                    "define" => {
                        self.define(rest).map_err(fail)?;
                        self.directive(line.number, line.text.trim().to_owned());
                    }
                    "undef" => {
                        self.macros.remove(identifier(rest));
                        self.directive(line.number, line.text.trim().to_owned());
                    }
                    "error" => return Err(fail(format!("#error {}", rest.trim()))),
                    _ => {} // #warning, #pragma, #line, #ident
                }
                continue;
            }
            if !active {
                continue;
            }
            if let Some(rest) = line.text.trim_start().strip_prefix("/include/") {
                self.flush(&name, &mut block)?;
                let fail = |message: String| ImportError::new(&*name, line.number, message);
                let target = match quoted(rest.trim()) {
                    Some(target) => target.to_owned(),
                    None => return Err(fail("expected `/include/ \"file\"`".into())),
                };
                self.directive(line.number, format!("/include/ \"{target}\""));
                let target = IncludeTarget::Quoted(target);
                self.include(&target, path, &name, line.number)?;
                continue;
            }
            block.push(line);
        }
        self.flush(&name, &mut block)?;
        match conditions.last() {
            Some(open) => Err(ImportError::new(
                &*name,
                open.line,
                "`#if` without `#endif`",
            )),
            None => Ok(()),
        }
    }

    /// Records a directive of the top file, at `line`, for [`Preprocessed`].
    fn directive(&mut self, line: u32, text: String) {
        if self.depth == 0 {
            self.directives.push((line, text));
        }
    }

    /// Writes the pending text lines, macro-expanded, after a line marker.
    fn flush(&mut self, name: &str, block: &mut Vec<&Line>) -> Result<(), ImportError> {
        // Blank blocks need no output: the next line marker resyncs lines.
        if block.iter().all(|line| line.text.trim().is_empty()) {
            block.clear();
            return Ok(());
        }
        let first = block[0].number;
        let mut text = String::new();
        for line in block.iter() {
            text.push_str(&line.text);
            for _ in 0..line.span {
                text.push('\n');
            }
        }
        let expanded = self.expand(&text).map_err(|(offset, message)| {
            let line = first + text[..offset].matches('\n').count() as u32;
            ImportError::new(name, line, message)
        })?;
        self.out.push_str(&format!("# {first} {}\n", quote(name)));
        self.out.push_str(&expanded);
        block.clear();
        if self.out.len() > MAX_OUTPUT {
            return Err(ImportError::new(
                name,
                first,
                "preprocessed source is too large (recursive macros?)",
            ));
        }
        Ok(())
    }

    fn include_target(&self, rest: &str) -> Result<IncludeTarget, String> {
        let rest = rest.trim();
        if let Some(target) = parse_include_target(rest) {
            return Ok(target);
        }
        // `#include MACRO`: the expansion must give one of the two forms.
        let expanded = self.expand(rest).map_err(|(_, message)| message)?;
        parse_include_target(expanded.trim()).ok_or_else(|| {
            format!("expected `\"file\"` or `<file>` after `#include`, found `{rest}`")
        })
    }

    /// Finds and preprocesses a file included from line `line` of `from`,
    /// called `name` in errors.
    fn include(
        &mut self,
        target: &IncludeTarget,
        from: &Path,
        name: &str,
        line: u32,
    ) -> Result<(), ImportError> {
        let fail = |message: String| ImportError::new(name, line, message);
        if self.depth >= MAX_INCLUDE_DEPTH {
            return Err(fail(
                "`#include` nested too deeply (recursive include?)".into(),
            ));
        }
        let (file, local) = match target {
            IncludeTarget::Quoted(file) => (file, true),
            IncludeTarget::Angle(file) => (file, false),
        };
        let local_dir = from.parent().filter(|_| local).map(Path::to_path_buf);
        let dirs = local_dir.iter().chain(&self.options.include_dirs);
        for dir in dirs {
            let path = dir.join(file);
            match (self.read)(&path) {
                Ok(source) => {
                    self.files += 1;
                    self.bytes_read += source.len();
                    if self.files > MAX_FILES || self.bytes_read > MAX_OUTPUT {
                        return Err(fail("too many or too large included files".into()));
                    }
                    self.depth += 1;
                    let result = self.file(&source, &path);
                    self.depth -= 1;
                    return result;
                }
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::NotFound
                            | io::ErrorKind::IsADirectory
                            | io::ErrorKind::NotADirectory
                    ) => {}
                Err(e) => return Err(fail(format!("cannot read `{}`: {e}", path.display()))),
            }
        }
        Err(fail(format!("cannot find include file `{file}`")))
    }

    fn define(&mut self, rest: &str) -> Result<(), String> {
        let rest = rest.trim_start();
        let name = identifier(rest);
        if name.is_empty() {
            return Err("expected a macro name after `#define`".into());
        }
        let after = &rest[name.len()..];
        let (params, variadic, body) = match after.strip_prefix('(') {
            Some(list) => {
                let close = list
                    .find(')')
                    .ok_or_else(|| format!("missing `)` in parameters of macro `{name}`"))?;
                let mut params: Vec<String> = list[..close]
                    .split(',')
                    .map(|p| p.trim().to_owned())
                    .filter(|p| !p.is_empty())
                    .collect();
                let mut variadic = false;
                if let Some(last) = params.last_mut() {
                    if let Some(named) = last.strip_suffix("...") {
                        variadic = true;
                        *last = if named.trim().is_empty() {
                            "__VA_ARGS__".into()
                        } else {
                            named.trim().to_owned()
                        };
                    }
                }
                (Some(params), variadic, &list[close + 1..])
            }
            None => (None, false, after),
        };
        self.macros.insert(
            name.to_owned(),
            Macro {
                params,
                variadic,
                body: body.trim().to_owned(),
            },
        );
        Ok(())
    }

    /// Evaluates the condition of `#if` / `#elif`.
    fn condition(&self, expression: &str) -> Result<bool, String> {
        let with_defined = replace_defined(expression, &self.macros);
        let expanded = self.expand(&with_defined).map_err(|(_, message)| message)?;
        // Identifiers left after expansion count as 0.
        let numeric: String = tokens(&expanded)
            .map(|token| match Token::of(token) {
                Token::Identifier(_) => "0",
                Token::Other(text) => text,
            })
            .collect();
        evaluate(&numeric)
            .map(|value| value != 0)
            .map_err(|message| {
                format!("invalid `#if` condition `{}`: {message}", expression.trim())
            })
    }

    /// Expands macros in `text`.
    fn expand(&self, text: &str) -> Result<String, ExpandError> {
        self.expand_in(text, &mut Vec::new())
    }

    /// Expands macros in `text`. `disabled` holds the macros being expanded,
    /// which do not expand again inside their own expansion.
    fn expand_in(&self, text: &str, disabled: &mut Vec<String>) -> Result<String, ExpandError> {
        if self.nesting.get() >= MAX_EXPANSION_DEPTH {
            return Err((0, "macro expansion nested too deeply".into()));
        }
        self.nesting.set(self.nesting.get() + 1);
        let result = self.expand_text(text, disabled);
        self.nesting.set(self.nesting.get() - 1);
        result
    }

    fn expand_text(&self, text: &str, disabled: &mut Vec<String>) -> Result<String, ExpandError> {
        let mut out = String::new();
        // Newlines inside a macro call, written at the end of its line so
        // that later lines keep their numbers.
        let mut pending_newlines = 0;
        // A function-like macro name that ended the previous expansion: its
        // arguments may follow in `text` (`#define G F` then `G(1)`).
        let mut carried: Option<String> = None;
        let mut i = 0;
        while i < text.len() || carried.is_some() {
            let start = i;
            let carried_name = carried.take();
            let token = match &carried_name {
                Some(name) => name.as_str(),
                None => {
                    let token = next_token(&text[i..]);
                    i += token.len();
                    token
                }
            };
            let Token::Identifier(name) = Token::of(token) else {
                if pending_newlines > 0 && token.contains('\n') {
                    out.push_str(&"\n".repeat(pending_newlines));
                    pending_newlines = 0;
                }
                out.push_str(token);
                continue;
            };
            let Some(definition) = self
                .macros
                .get(name)
                .filter(|_| !disabled.iter().any(|d| d == name))
            else {
                out.push_str(name);
                continue;
            };
            let replacement = match &definition.params {
                None => definition.body.clone(),
                Some(params) => {
                    let rest = &text[i..];
                    let skipped = rest.len() - rest.trim_start().len();
                    if !rest[skipped..].starts_with('(') {
                        out.push_str(name);
                        continue;
                    }
                    let (args, used) = split_arguments(&rest[skipped + 1..])
                        .ok_or_else(|| (start, format!("unterminated call to macro `{name}`")))?;
                    pending_newlines += rest[..skipped + 1 + used].matches('\n').count();
                    i += skipped + 1 + used;
                    // Newlines in arguments are already counted as pending.
                    self.substitute(name, definition, params, args, disabled)
                        .map_err(|message| (start, message))?
                        .replace('\n', " ")
                }
            };
            self.expansions.set(self.expansions.get() + 1);
            if self.expansions.get() > MAX_EXPANSIONS {
                return Err((
                    start,
                    "too many macro expansions (recursive macros?)".into(),
                ));
            }
            disabled.push(name.to_owned());
            let expanded = self.expand_in(&replacement, disabled);
            disabled.pop();
            let mut expanded = expanded.map_err(|(_, message)| (start, message))?;
            if let Some(last) = tokens(&expanded).last() {
                let calls_on = self.macros.get(last).is_some_and(|m| m.params.is_some())
                    && !disabled.iter().any(|d| d == last)
                    && text[i..].trim_start().starts_with('(');
                if calls_on {
                    let last = last.to_owned();
                    expanded.truncate(expanded.len() - last.len());
                    carried = Some(last);
                }
            }
            out.push_str(&expanded);
            if out.len() > MAX_OUTPUT {
                return Err((
                    start,
                    "macro expansion is too large (recursive macros?)".into(),
                ));
            }
        }
        out.push_str(&"\n".repeat(pending_newlines));
        Ok(out)
    }

    /// The body of a function-like macro with its arguments in place.
    fn substitute(
        &self,
        name: &str,
        definition: &Macro,
        params: &[String],
        args: Vec<&str>,
        disabled: &mut Vec<String>,
    ) -> Result<String, String> {
        let mut args: Vec<String> = args.into_iter().map(str::to_owned).collect();
        if params.is_empty() && args.len() == 1 && args[0].trim().is_empty() {
            args.clear();
        }
        if definition.variadic && args.len() >= params.len() {
            let rest = args.split_off(params.len() - 1).join(",");
            args.push(rest);
        } else if definition.variadic && args.len() + 1 == params.len() {
            args.push(String::new());
        }
        if args.len() != params.len() {
            return Err(format!(
                "macro `{name}` takes {} argument(s), got {}",
                params.len(),
                args.len()
            ));
        }
        let arg = |token: &str| {
            params
                .iter()
                .position(|p| p == token)
                .map(|k| args[k].trim())
        };

        // Split the body into tokens, so `#` and `##` can see their operands.
        let tokens: Vec<&str> = tokens(&definition.body).collect();
        let is_space = |t: &&str| t.chars().all(char::is_whitespace);
        // Indices of the nearest non-space tokens after and before `k`.
        let next = |k: usize| {
            tokens[k + 1..]
                .iter()
                .position(|t| !is_space(t))
                .map(|j| k + 1 + j)
        };
        let prev = |k: usize| tokens[..k].iter().rposition(|t| !is_space(t));

        let mut out = String::new();
        let mut k = 0;
        while k < tokens.len() {
            let token = tokens[k];
            if token == "##" {
                // Paste: drop whitespace on both sides.
                out.truncate(out.trim_end().len());
                k = next(k).unwrap_or(tokens.len());
                if let Some(&next) = tokens.get(k) {
                    out.push_str(arg(next).unwrap_or(next));
                    k += 1;
                }
                continue;
            }
            if token == "#" {
                if let Some(param) = next(k).and_then(|j| arg(tokens[j]).map(|a| (j, a))) {
                    out.push_str(&stringify(param.1));
                    k = param.0 + 1;
                    continue;
                }
            }
            match arg(token) {
                // Operands of `##` are not expanded.
                Some(raw)
                    if next(k).is_some_and(|j| tokens[j] == "##")
                        || prev(k).is_some_and(|j| tokens[j] == "##") =>
                {
                    out.push_str(raw)
                }
                Some(raw) => out.push_str(
                    &self
                        .expand_in(raw, disabled)
                        .map_err(|(_, message)| message)?,
                ),
                None => out.push_str(token),
            }
            k += 1;
        }
        Ok(out)
    }
}

/// The innermost open `#if`, for `#elif`, `#else` and `#endif`.
fn innermost<'a>(
    conditions: &'a mut [Condition],
    directive: &str,
) -> Result<&'a mut Condition, String> {
    conditions
        .last_mut()
        .ok_or_else(|| format!("`#{directive}` without `#if`"))
}

enum IncludeTarget {
    /// `"file"`: looked up next to the including file first.
    Quoted(String),
    /// `<file>`: looked up in the include directories only.
    Angle(String),
}

fn parse_include_target(text: &str) -> Option<IncludeTarget> {
    if let Some(name) = quoted(text) {
        return Some(IncludeTarget::Quoted(name.to_owned()));
    }
    let name = text.strip_prefix('<')?;
    Some(IncludeTarget::Angle(name[..name.find('>')?].to_owned()))
}

/// The content of a leading `"..."`.
fn quoted(text: &str) -> Option<&str> {
    let name = text.strip_prefix('"')?;
    Some(&name[..name.find('"')?])
}

/// The directive name and the rest of a `#directive ...` line.
fn directive(text: &str) -> Option<(&'static str, &str)> {
    let rest = text.trim_start().strip_prefix('#')?.trim_start();
    let name = identifier(rest);
    let directive = DIRECTIVES.iter().find(|d| **d == name)?;
    Some((*directive, &rest[name.len()..]))
}

/// The C identifier at the start of `text` (after leading whitespace).
fn identifier(text: &str) -> &str {
    let text = text.trim_start();
    let len = text
        .char_indices()
        .find(|&(k, c)| !(c == '_' || c.is_ascii_alphabetic() || (k > 0 && c.is_ascii_digit())))
        .map_or(text.len(), |(k, _)| k);
    &text[..len]
}

/// Replaces `defined X` and `defined(X)` with 1 or 0.
fn replace_defined(expression: &str, macros: &HashMap<String, Macro>) -> String {
    let mut out = String::new();
    let mut rest = expression;
    while !rest.is_empty() {
        let token = next_token(rest);
        rest = &rest[token.len()..];
        if token != "defined" {
            out.push_str(token);
            continue;
        }
        let mut after = rest.trim_start();
        let parenthesized = after.starts_with('(');
        if parenthesized {
            after = after[1..].trim_start();
        }
        let name = identifier(after);
        after = &after[name.len()..];
        if parenthesized {
            after = after.trim_start().strip_prefix(')').unwrap_or(after);
        }
        out.push_str(if macros.contains_key(name) { "1" } else { "0" });
        rest = after;
    }
    out
}

enum Token<'a> {
    Identifier(&'a str),
    Other(&'a str),
}

impl<'a> Token<'a> {
    fn of(text: &'a str) -> Self {
        if text.starts_with(|c: char| c == '_' || c.is_ascii_alphabetic()) {
            Token::Identifier(text)
        } else {
            Token::Other(text)
        }
    }
}

/// The preprocessing tokens of `text`, see [`next_token`].
fn tokens(text: &str) -> impl Iterator<Item = &str> {
    let mut rest = text;
    std::iter::from_fn(move || {
        (!rest.is_empty()).then(|| {
            let token = next_token(rest);
            rest = &rest[token.len()..];
            token
        })
    })
}

/// The preprocessing token at the start of `text`: an identifier, a number,
/// a string or character literal, `##`, a run of whitespace, or one character.
fn next_token(text: &str) -> &str {
    let bytes = text.as_bytes();
    let len = match bytes[0] {
        b'_' | b'a'..=b'z' | b'A'..=b'Z' => bytes
            .iter()
            .position(|&b| !(b == b'_' || b.is_ascii_alphanumeric()))
            .unwrap_or(bytes.len()),
        b'0'..=b'9' => {
            let mut k = 1;
            while k < bytes.len() {
                let b = bytes[k];
                let exponent_sign =
                    matches!(b, b'+' | b'-') && matches!(bytes[k - 1], b'e' | b'E' | b'p' | b'P');
                if !(b == b'_' || b == b'.' || b.is_ascii_alphanumeric() || exponent_sign) {
                    break;
                }
                k += 1;
            }
            k
        }
        quote @ (b'"' | b'\'') => {
            let mut k = 1;
            while k < bytes.len() && bytes[k] != quote && bytes[k] != b'\n' {
                k += if bytes[k] == b'\\' { 2 } else { 1 };
            }
            // A quote not closed on its line is just a character, as in
            // cpp's assembler mode (`#error don't`).
            if bytes.get(k) == Some(&quote) {
                k + 1
            } else {
                1
            }
        }
        b'#' if bytes.get(1) == Some(&b'#') => 2,
        b if b.is_ascii_whitespace() => bytes
            .iter()
            .position(|b| !b.is_ascii_whitespace())
            .unwrap_or(bytes.len()),
        _ => text.chars().next().map_or(1, char::len_utf8),
    };
    &text[..len]
}

/// Splits macro call arguments, starting after `(`. Returns the arguments
/// and the bytes used up to and including the closing `)`.
fn split_arguments(text: &str) -> Option<(Vec<&str>, usize)> {
    let mut args = Vec::new();
    let mut depth = 0;
    let mut start = 0;
    let mut i = 0;
    for token in tokens(text) {
        match token {
            "(" => depth += 1,
            ")" if depth == 0 => {
                args.push(&text[start..i]);
                return Some((args, i + 1));
            }
            ")" => depth -= 1,
            "," if depth == 0 => {
                args.push(&text[start..i]);
                start = i + 1;
            }
            _ => {}
        }
        i += token.len();
    }
    None
}

/// `#arg`: the argument as a string literal.
fn stringify(arg: &str) -> String {
    let collapsed = arg.split_whitespace().collect::<Vec<_>>().join(" ");
    quote(&collapsed)
}

/// Splits source into logical lines: comments become a space, and
/// `\`-newline continuations join lines.
fn logical_lines(source: &str) -> Vec<Line> {
    let bytes = source.as_bytes();
    let mut lines = Vec::new();
    let mut text = String::new();
    let mut number = 1;
    let mut span = 1;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\n' => {
                lines.push(Line {
                    number,
                    text: std::mem::take(&mut text),
                    span,
                });
                number += span;
                span = 1;
                i += 1;
            }
            b'\r' => i += 1,
            b'\\' if bytes.get(i + 1) == Some(&b'\n') => {
                span += 1;
                i += 2;
            }
            b'\\' if bytes[i + 1..].starts_with(b"\r\n") => {
                span += 1;
                i += 3;
            }
            b'/' if bytes.get(i + 1) == Some(&b'/') => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i += 2;
                while i < bytes.len() && !bytes[i..].starts_with(b"*/") {
                    if bytes[i] == b'\n' {
                        span += 1;
                    }
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
                text.push(' ');
            }
            b'"' | b'\'' => {
                let literal = next_token(&source[i..]);
                text.push_str(literal);
                i += literal.len();
            }
            _ => {
                let c = source[i..].chars().next().expect("inside the source");
                text.push(c);
                i += c.len_utf8();
            }
        }
    }
    if !text.is_empty() || span > 1 {
        lines.push(Line { number, text, span });
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(files: &[(&str, &str)], options: &ImportOptions) -> Result<String, ImportError> {
        let map: HashMap<PathBuf, String> = files
            .iter()
            .map(|(name, text)| (PathBuf::from(name), text.to_string()))
            .collect();
        let read = |path: &Path| {
            map.get(path)
                .cloned()
                .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
        };
        preprocess(files[0].1, Path::new(files[0].0), options, &read).map(|p| p.text)
    }

    /// Output lines without line markers, blank lines and whitespace.
    fn text(files: &[(&str, &str)]) -> String {
        let out = run(files, &ImportOptions::default()).unwrap_or_else(|e| panic!("{e}"));
        out.lines()
            .filter(|l| !l.starts_with("# ") && !l.trim().is_empty())
            .map(|l| l.split_whitespace().collect::<String>())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn expands_like_cpp() {
        assert_eq!(
            text(&[(
                "b.dts",
                "#define cells 5\n\
                 #define F(a, b) a##b x#b\n\
                 #define G(...) [__VA_ARGS__]\n\
                 #define H(x, rest...) x:rest\n\
                 \t#address-cells = <cells>;\n\
                 foo = <cells F(ab,\n cd) G(1,2) H(1, 2, 3)>; /* c\n d */ x = \"cells\";\n\
                 linux,code = <__DTS__>;\n"
            )]),
            "#address-5=<5>;\n\
             foo=<5abcdx\"cd\"[1,2]1:2,3>;x=\"cells\";\n\
             linux,code=<1>;"
        );
    }

    #[test]
    fn matches_cpp_corner_cases() {
        assert_eq!(
            text(&[(
                "b.dts",
                "#define F(x) <x>\n\
                 #define G F\n\
                 #define CALL(f) f\n\
                 a = G(5) CALL(F)(6);\n\
                 #if 0\nthis doesn't count\n#endif\n\
                 #if -1 < 0 && !(0 && 1 / 0) && -7 / 2 == -3 && -8 >> 1 == -4\nb;\n#else\nc;\n#endif\n\
                 #ifdef __ASSEMBLER__\nd;\n#endif\n"
            )]),
            "a=<5><6>;\nb;\nd;"
        );
    }

    #[test]
    fn nested_and_recursive_macros() {
        assert_eq!(
            text(&[(
                "b.dts",
                "#define GIC_SPI 0\n\
                 #define IRQ_TYPE_LEVEL_HIGH 4\n\
                 #define IRQ(n) GIC_SPI n IRQ_TYPE_LEVEL_HIGH\n\
                 #define PIN(port, line) (((port - 'A') * 0x10 + line) << 8)\n\
                 #define self self + 1\n\
                 a = <IRQ(IRQ(1))>, <PIN('B', 3)>, <self>;\n"
            )]),
            "a=<0014 4>,<((('B'-'A')*0x10+3)<<8)>,<self+1>;".replace(' ', "")
        );
    }

    #[test]
    fn conditionals() {
        assert_eq!(
            text(&[(
                "b.dts",
                "#define A 2\n\
                 #if defined(A) && A > 1\n a;\n#elif 1\n b;\n#else\n c;\n#endif\n\
                 #ifdef B\n d;\n#elif defined B || !defined(A) || UNKNOWN\n e;\n#else\n f;\n\
                 #ifndef A\n g;\n#endif\n#endif\n\
                 #if 0\n#error not reached\n#if 1\n h;\n#endif\n#endif\n\
                 #undef A\n#ifdef A\n i;\n#endif\n"
            )]),
            "a;\nf;"
        );
    }

    #[test]
    fn includes_with_line_markers() {
        let options = ImportOptions {
            include_dirs: vec![PathBuf::from("inc")],
        };
        let out = run(
            &[
                (
                    "dir/b.dts",
                    "#include <dt-bindings/x.h>\n#include \"soc.dtsi\"\n/include/ \"pins.dtsi\"\nval = <X>;\n",
                ),
                ("inc/dt-bindings/x.h", "#ifndef X_H\n#define X_H\n#define X 7\n#endif\n"),
                ("dir/soc.dtsi", "#include <dt-bindings/x.h>\n\n/ { x = <X>; };\n"),
                ("dir/pins.dtsi", "p;\n"),
            ],
            &options,
        )
        .unwrap();
        assert_eq!(
            out,
            "# 2 \"dir/soc.dtsi\"\n\n/ { x = <7>; };\n\
             # 1 \"dir/pins.dtsi\"\np;\n\
             # 4 \"dir/b.dts\"\nval = <7>;\n"
        );
    }

    #[test]
    fn keeps_line_numbers_across_comments_and_calls() {
        let out = run(
            &[(
                "b.dts",
                "#define F(a, b) a b\n/* one\n two */ x = <F(1,\n 2)>;\\\n y;\nz;\n",
            )],
            &ImportOptions::default(),
        )
        .unwrap();
        // The marker says line 2; `z;` is on line 6 in the source.
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines[0], "# 2 \"b.dts\"");
        assert_eq!(lines[5], "z;");
    }

    #[test]
    fn reports_errors_where_they_happen() {
        let err = |files: &[(&str, &str)]| {
            run(files, &ImportOptions::default())
                .unwrap_err()
                .to_string()
        };
        assert_eq!(
            err(&[("b.dts", "\n#include \"missing.h\"\n")]),
            "b.dts:2:1: cannot find include file `missing.h`"
        );
        assert_eq!(
            err(&[
                ("b.dts", "#include \"a.h\"\n"),
                ("a.h", "\n\n#error stop here\n")
            ]),
            "a.h:3:1: #error stop here"
        );
        assert_eq!(
            err(&[("b.dts", "#if 1\nx;\n")]),
            "b.dts:1:1: `#if` without `#endif`"
        );
        assert_eq!(
            err(&[("b.dts", "#define F(a) a\n\nx = F(1, 2);\n")]),
            "b.dts:3:1: macro `F` takes 1 argument(s), got 2"
        );
        assert_eq!(
            err(&[("b.dts", "#include \"b.dts\"\n")]),
            "b.dts:1:1: `#include` nested too deeply (recursive include?)"
        );
    }

    #[test]
    fn stops_hostile_sources() {
        let err = |files: Vec<(String, String)>| {
            let files: Vec<(&str, &str)> = files
                .iter()
                .map(|(n, t)| (n.as_str(), t.as_str()))
                .collect();
            run(&files, &ImportOptions::default()).unwrap_err().message
        };
        // Each header includes the next one twice: 2^40 includes.
        let mut fan_out = vec![("b.dts".to_owned(), "#include \"l0.h\"\n".to_owned())];
        for k in 0..40 {
            let next = format!("#include \"l{}.h\"\n", k + 1);
            fan_out.push((format!("l{k}.h"), next.repeat(2)));
        }
        fan_out.push(("l40.h".to_owned(), String::new()));
        assert_eq!(err(fan_out), "too many or too large included files");

        // Each macro doubles the previous one: 2^40 expansions.
        let mut bomb = String::from("#define A0 x\n");
        for k in 1..=40 {
            bomb += &format!("#define A{k} A{} A{}\n", k - 1, k - 1);
        }
        bomb += "a = <A40>;\n";
        assert_eq!(
            err(vec![("b.dts".to_owned(), bomb)]),
            "too many macro expansions (recursive macros?)"
        );

        // Deeply nested macro arguments.
        let nested = format!(
            "#define F(x) x\na = <{}1{}>;\n",
            "F(".repeat(30_000),
            ")".repeat(30_000)
        );
        assert_eq!(
            err(vec![("b.dts".to_owned(), nested)]),
            "macro expansion nested too deeply"
        );
    }
}
