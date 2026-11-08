//! Ranked search of the element library.
//!
//! The query is split into words; every word has to match somewhere in the
//! compatible strings, the title or the schema path of a binding. A word
//! scores by how well it matches (whole text, start, word start, anywhere,
//! scattered letters), and the words' scores add up, so `st stm32 uart`
//! finds `st,stm32-uart` before a schema that merely mentions them.
//!
//! A schema often documents many compatibles (`arm/cpus.yaml` has over a
//! hundred), so the library has one entry per compatible: each is scored on
//! its own compatible and its schema's title and path, and is what a new
//! node gets.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{Binding, Catalog};

fn is_boundary(c: char) -> bool {
    matches!(c, ',' | '-' | '_' | ' ' | '/' | '.' | '@' | '+')
}

fn is_subsequence(word: &str, text: &str) -> bool {
    let mut letters = word.chars();
    let mut next = letters.next();
    for c in text.chars() {
        match next {
            Some(n) if n == c => next = letters.next(),
            Some(_) => {}
            None => break,
        }
    }
    next.is_none()
}

/// How well `word` matches the lowercase `text`: 0 for no match.
fn score_word(word: &str, text: &str) -> u32 {
    if text == word {
        100
    } else if text.starts_with(word) {
        80
    } else if text
        .match_indices(word)
        .any(|(i, _)| text[..i].chars().next_back().is_some_and(is_boundary))
    {
        60
    } else if text.contains(word) {
        40
    } else if is_subsequence(word, text) {
        10
    } else {
        0
    }
}

/// Compatible strings count fully, titles and paths less: the compatible is
/// what ends up in the devicetree.
const COMPATIBLE_WEIGHT: u32 = 100;
const TITLE_WEIGHT: u32 = 80;
const PATH_WEIGHT: u32 = 60;

/// How well each word matches a schema's title and path, which every
/// compatible of the schema shares.
fn schema_scores(words: &[String], binding: &Binding) -> Vec<u32> {
    let title = binding.title.as_ref().map(|t| t.to_lowercase());
    let path = binding.path.to_lowercase();
    words
        .iter()
        .map(|word| {
            let title = title
                .as_deref()
                .map_or(0, |t| score_word(word, t) * TITLE_WEIGHT / 100);
            title.max(score_word(word, &path) * PATH_WEIGHT / 100)
        })
        .collect()
}

/// The score of one library entry: each word's best match in the
/// compatible or in the schema (`schema`, from [`schema_scores`]); `None`
/// when a word matches nowhere.
fn score_entry(words: &[String], compatible: Option<&str>, schema: &[u32]) -> Option<u32> {
    let mut total = 0;
    for (word, &fixed) in words.iter().zip(schema) {
        let best = compatible
            .map_or(0, |c| score_word(word, c) * COMPATIBLE_WEIGHT / 100)
            .max(fixed);
        if best == 0 {
            return None;
        }
        total += best;
    }
    Some(total)
}

/// One library entry: a compatible and the schema that documents it. A
/// schema without compatibles is one entry of its own.
#[derive(Debug, Clone, Copy)]
pub struct Hit<'a> {
    pub binding: &'a Binding,
    /// `None` for a schema that lists no compatible.
    pub compatible: Option<&'a str>,
}

impl Hit<'_> {
    /// A copy of the binding with the entry's compatible first, where a new
    /// node takes it from.
    pub fn to_binding(&self) -> Binding {
        let mut binding = self.binding.clone();
        if let Some(c) = self.compatible {
            if let Some(i) = binding.compatibles.iter().position(|x| x == c) {
                let matched = binding.compatibles.remove(i);
                binding.compatibles.insert(0, matched);
            }
        }
        binding
    }

    /// The entry without the schema's properties, as the library lists it.
    pub fn to_entry(&self) -> LibraryEntry {
        LibraryEntry {
            path: self.binding.path.clone(),
            category: self.binding.category.clone(),
            title: self.binding.title.clone(),
            compatible: self.compatible.map(str::to_string),
        }
    }
}

/// A row of the element library (US-18.1): one per compatible, so that
/// `arm,cortex-a7` is found and added as itself, not as the first of the
/// 150 compatibles of `arm/cpus.yaml`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct LibraryEntry {
    /// Schema path, which the full binding is fetched by.
    pub path: String,
    pub category: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compatible: Option<String>,
}

/// The library entries of one schema: one per compatible, or the schema
/// alone when it lists none.
fn entries_of(binding: &Binding) -> impl Iterator<Item = Hit<'_>> {
    let alone = binding.compatibles.is_empty().then_some(Hit {
        binding,
        compatible: None,
    });
    binding
        .compatibles
        .iter()
        .map(move |c| Hit {
            binding,
            compatible: Some(c.as_str()),
        })
        .chain(alone)
}

impl Catalog {
    /// The schemas of the catalog in order, restricted to `category`.
    fn in_category(&self, category: Option<&str>) -> impl Iterator<Item = &Binding> + '_ {
        let category = category.map(str::to_string);
        self.bindings
            .iter()
            .filter(move |b| category.as_ref().is_none_or(|c| &b.category == c))
    }

    /// The library entries that match `query`, best first, at most `limit`;
    /// restricted to `category` when given. An empty query lists them all
    /// in catalog order.
    pub fn search(&self, query: &str, category: Option<&str>, limit: usize) -> Vec<Hit<'_>> {
        let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        if words.is_empty() {
            return self
                .in_category(category)
                .flat_map(entries_of)
                .take(limit)
                .collect();
        }
        let mut scored: Vec<(u32, Hit)> = Vec::new();
        for binding in self.in_category(category) {
            let schema = schema_scores(&words, binding);
            for hit in entries_of(binding) {
                if let Some(score) = score_entry(&words, hit.compatible, &schema) {
                    scored.push((score, hit));
                }
            }
        }
        // Shorter compatibles first among equals: `arm,cortex-a7` before
        // `arm,cortex-a710`.
        let len = |h: &Hit| h.compatible.map_or(usize::MAX, str::len);
        scored.sort_by(|(sa, a), (sb, b)| {
            sb.cmp(sa)
                .then_with(|| len(a).cmp(&len(b)))
                .then_with(|| a.compatible.cmp(&b.compatible))
                .then_with(|| a.binding.path.cmp(&b.binding.path))
        });
        scored.into_iter().take(limit).map(|(_, hit)| hit).collect()
    }

    /// The bindings whose schema path is in `paths`, in that order; paths
    /// the catalog does not have are left out.
    pub fn by_paths(&self, paths: &[String]) -> Vec<&Binding> {
        paths
            .iter()
            .filter_map(|p| self.bindings.iter().find(|b| &b.path == p))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(path: &str, title: &str, compatibles: &[&str]) -> Binding {
        Binding {
            path: path.to_string(),
            category: path.split('/').next().unwrap().to_string(),
            title: Some(title.to_string()),
            compatibles: compatibles.iter().map(|c| c.to_string()).collect(),
            properties: Vec::new(),
        }
    }

    fn catalog() -> Catalog {
        Catalog {
            bindings: vec![
                binding(
                    "serial/st,stm32-uart.yaml",
                    "STM32 USART",
                    &["st,stm32-uart", "st,stm32h7-uart"],
                ),
                binding("serial/8250.yaml", "16550 UART", &["ns16550a", "ns16550"]),
                binding("i2c/st,stm32-i2c.yaml", "STM32 I2C", &["st,stm32f7-i2c"]),
                binding(
                    "net/fsl,fec.yaml",
                    "Freescale FEC ethernet",
                    &["fsl,imx6q-fec"],
                ),
            ],
            ..Catalog::default()
        }
    }

    fn compatibles(found: Vec<Hit<'_>>) -> Vec<&str> {
        found
            .into_iter()
            .map(|h| h.compatible.unwrap_or("-"))
            .collect()
    }

    #[test]
    fn ranks_by_match_quality() {
        let c = catalog();
        // Exact compatible, then prefix, then word start.
        assert_eq!(compatibles(c.search("ns16550a", None, 10)), ["ns16550a"]);
        assert_eq!(
            compatibles(c.search("st,stm32", None, 10)),
            ["st,stm32-uart", "st,stm32f7-i2c", "st,stm32h7-uart"]
        );
    }

    #[test]
    fn words_match_across_fields() {
        let c = catalog();
        // Vendor from the compatible, kind from the title.
        assert_eq!(
            compatibles(c.search("st usart", None, 10)),
            ["st,stm32-uart", "st,stm32h7-uart"]
        );
        assert!(c.search("st nothere", None, 10).is_empty());
    }

    #[test]
    fn scattered_letters_still_match() {
        let c = catalog();
        assert_eq!(
            compatibles(c.search("imx6fec", None, 10)),
            ["fsl,imx6q-fec"]
        );
    }

    #[test]
    fn category_and_limit_apply() {
        let c = catalog();
        assert_eq!(
            compatibles(c.search("stm32", Some("i2c"), 10)),
            ["st,stm32f7-i2c"]
        );
        assert_eq!(c.search("", Some("serial"), 1).len(), 1);
        // One entry per compatible, in catalog order.
        assert_eq!(
            compatibles(c.search("", None, 10)),
            [
                "st,stm32-uart",
                "st,stm32h7-uart",
                "ns16550a",
                "ns16550",
                "st,stm32f7-i2c",
                "fsl,imx6q-fec"
            ]
        );
    }

    #[test]
    fn lists_each_compatible_as_its_own_entry() {
        let c = Catalog {
            bindings: vec![binding(
                "arm/cpus.yaml",
                "ARM CPUs",
                &[
                    "apm,potenza",
                    "arm,cortex-a710",
                    "arm,cortex-a7",
                    "arm,cortex-a9",
                ],
            )],
            ..Catalog::default()
        };
        let found = c.search("cortex-a7", None, 10);
        assert_eq!(
            compatibles(found.clone()),
            ["arm,cortex-a7", "arm,cortex-a710"]
        );
        let added = found[0].to_binding();
        assert_eq!(added.compatibles[0], "arm,cortex-a7");
        assert_eq!(added.compatibles.len(), 4);
        let entry = found[0].to_entry();
        assert_eq!(entry.compatible.as_deref(), Some("arm,cortex-a7"));
        assert_eq!(entry.title.as_deref(), Some("ARM CPUs"));
        // A match on the title lists every compatible of the schema.
        assert_eq!(c.search("cpus", None, 10).len(), 4);
        // A schema without compatibles is one entry.
        let bare = Catalog {
            bindings: vec![binding("misc/bare.yaml", "Bare", &[])],
            ..Catalog::default()
        };
        assert_eq!(compatibles(bare.search("bare", None, 10)), ["-"]);
    }

    #[test]
    fn looks_up_paths_in_order() {
        let c = catalog();
        let wanted = [
            "net/fsl,fec.yaml".to_string(),
            "gone.yaml".to_string(),
            "serial/8250.yaml".to_string(),
        ];
        assert_eq!(
            c.by_paths(&wanted)
                .iter()
                .map(|b| b.path.as_str())
                .collect::<Vec<_>>(),
            ["net/fsl,fec.yaml", "serial/8250.yaml"]
        );
    }

    /// The library holds some 26,000 compatibles in 5,000 schemas, one
    /// entry each; the backlog asks for results in under 50 ms.
    #[test]
    #[cfg(not(debug_assertions))]
    fn searches_a_kernel_sized_catalog_quickly() {
        let bindings = (0..5000)
            .map(|i| {
                let compatibles: Vec<String> = (0..5)
                    .map(|j| format!("vendor{},chip{i}-block{j}", i % 90))
                    .collect();
                let refs: Vec<&str> = compatibles.iter().map(String::as_str).collect();
                binding(
                    &format!("cat{}/vendor{},chip{i}.yaml", i % 40, i % 90),
                    &format!("Chip {i} block"),
                    &refs,
                )
            })
            .collect();
        let c = Catalog {
            bindings,
            ..Catalog::default()
        };
        let start = std::time::Instant::now();
        let found = c.search("vendor7 chip12 blk", None, 200);
        let took = start.elapsed();
        assert!(!found.is_empty());
        assert!(took.as_millis() < 50, "took {took:?}");
        // The whole library, as the list shows it before a query is typed.
        let start = std::time::Instant::now();
        let all: Vec<LibraryEntry> = c
            .search("", None, usize::MAX)
            .iter()
            .map(Hit::to_entry)
            .collect();
        let took = start.elapsed();
        assert_eq!(all.len(), 25_000);
        assert!(took.as_millis() < 50, "took {took:?}");
    }
}
