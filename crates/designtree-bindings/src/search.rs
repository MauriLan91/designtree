//! Ranked search of the element library.
//!
//! The query is split into words; every word has to match somewhere in the
//! compatible strings, the title or the schema path of a binding. A word
//! scores by how well it matches (whole text, start, word start, anywhere,
//! scattered letters), and the words' scores add up, so `st stm32 uart`
//! finds `st,stm32-uart` before a schema that merely mentions them.

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

fn score_binding(words: &[String], binding: &Binding, title: Option<&str>) -> Option<u32> {
    let path = binding.path.to_lowercase();
    let mut total = 0;
    for word in words {
        let mut best = 0;
        for compatible in &binding.compatibles {
            best = best.max(score_word(word, compatible) * COMPATIBLE_WEIGHT / 100);
        }
        if let Some(title) = title {
            best = best.max(score_word(word, title) * TITLE_WEIGHT / 100);
        }
        best = best.max(score_word(word, &path) * PATH_WEIGHT / 100);
        if best == 0 {
            return None;
        }
        total += best;
    }
    Some(total)
}

impl Catalog {
    /// The bindings that match `query`, best first, at most `limit`;
    /// restricted to `category` when given. An empty query lists the
    /// category in catalog order.
    pub fn search(&self, query: &str, category: Option<&str>, limit: usize) -> Vec<&Binding> {
        let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        let in_category = |b: &&Binding| category.is_none_or(|c| b.category == c);
        if words.is_empty() {
            return self
                .bindings
                .iter()
                .filter(in_category)
                .take(limit)
                .collect();
        }
        let mut scored: Vec<(u32, &Binding)> = self
            .bindings
            .iter()
            .filter(in_category)
            .filter_map(|b| {
                let title = b.title.as_ref().map(|t| t.to_lowercase());
                score_binding(&words, b, title.as_deref()).map(|s| (s, b))
            })
            .collect();
        // Shorter compatibles first among equals: `st,stm32-uart` before
        // `st,stm32-uart-variant`.
        let shortest = |b: &Binding| {
            b.compatibles
                .iter()
                .map(String::len)
                .min()
                .unwrap_or(usize::MAX)
        };
        scored.sort_by(|(sa, a), (sb, b)| {
            sb.cmp(sa)
                .then_with(|| shortest(a).cmp(&shortest(b)))
                .then_with(|| a.path.cmp(&b.path))
        });
        scored.into_iter().take(limit).map(|(_, b)| b).collect()
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
            skipped: Vec::new(),
        }
    }

    fn paths(found: Vec<&Binding>) -> Vec<&str> {
        found.into_iter().map(|b| b.path.as_str()).collect()
    }

    #[test]
    fn ranks_by_match_quality() {
        let c = catalog();
        // Exact compatible, then prefix, then word start.
        assert_eq!(paths(c.search("ns16550a", None, 10)), ["serial/8250.yaml"]);
        let found = paths(c.search("st,stm32", None, 10));
        assert_eq!(found[0], "serial/st,stm32-uart.yaml");
        assert!(found.contains(&"i2c/st,stm32-i2c.yaml"));
    }

    #[test]
    fn words_match_across_fields() {
        let c = catalog();
        // Vendor from the compatible, kind from the title.
        assert_eq!(
            paths(c.search("st usart", None, 10)),
            ["serial/st,stm32-uart.yaml"]
        );
        assert!(c.search("st nothere", None, 10).is_empty());
    }

    #[test]
    fn scattered_letters_still_match() {
        let c = catalog();
        assert_eq!(paths(c.search("imx6fec", None, 10)), ["net/fsl,fec.yaml"]);
    }

    #[test]
    fn category_and_limit_apply() {
        let c = catalog();
        assert_eq!(
            paths(c.search("stm32", Some("i2c"), 10)),
            ["i2c/st,stm32-i2c.yaml"]
        );
        assert_eq!(c.search("", Some("serial"), 1).len(), 1);
        assert_eq!(c.search("", None, 10).len(), 4);
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
            paths(c.by_paths(&wanted)),
            ["net/fsl,fec.yaml", "serial/8250.yaml"]
        );
    }

    /// The library holds some 26,000 compatibles in 5,000 schemas; the
    /// backlog asks for results in under 50 ms.
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
            skipped: Vec::new(),
        };
        let start = std::time::Instant::now();
        let found = c.search("vendor7 chip12 blk", None, 200);
        let took = start.elapsed();
        assert!(!found.is_empty());
        assert!(took.as_millis() < 50, "took {took:?}");
    }
}
