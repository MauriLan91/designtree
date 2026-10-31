//! Kernel checkouts: their version, and a cache of the index built from
//! one so that a restart does not read thousands of schemas again.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::{index_kernel_tree, Catalog, IndexError, BINDINGS_DIR};

/// The version a kernel tree says it is, from the top of its `Makefile`:
/// `7.3`, `6.12.4`, `7.4-rc2`. `None` when there is no such `Makefile`.
pub fn kernel_version(linux: &Path) -> Option<String> {
    // The variables sit in the first lines; the rest of the file is big.
    let mut head = String::new();
    fs::File::open(linux.join("Makefile"))
        .ok()?
        .take(4096)
        .read_to_string(&mut head)
        .ok()?;
    let var = |name: &str| {
        head.lines().find_map(|line| {
            let (key, value) = line.split_once('=')?;
            (key.trim() == name).then(|| value.trim().to_string())
        })
    };
    let major = var("VERSION")?;
    let minor = var("PATCHLEVEL")?;
    let sub = var("SUBLEVEL").filter(|s| !s.is_empty() && s != "0");
    let extra = var("EXTRAVERSION").unwrap_or_default();
    let mut version = format!("{major}.{minor}");
    if let Some(sub) = sub {
        version.push('.');
        version.push_str(&sub);
    }
    version.push_str(&extra);
    Some(version)
}

/// Bumped when the cached catalog's shape changes.
const CACHE_FORMAT: u32 = 2;

/// Bigger cache files are not read: a catalog of the whole kernel, with
/// the processed schemas, is about 20 megabytes.
const MAX_CACHE_BYTES: u64 = 256 * 1024 * 1024;

/// How [`index_kernel_tree_cached`] got its catalog.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheStatus {
    /// Read from the cache; no schema was parsed.
    Hit,
    /// Indexed (first use, or the bindings changed) and cached.
    Rebuilt,
}

#[derive(Serialize, Deserialize)]
struct CacheFile {
    format: u32,
    fingerprint: u64,
    catalog: Catalog,
}

/// FNV-1a, so that cache names and fingerprints do not depend on the Rust
/// version (the std hashers may change).
fn fnv(parts: impl IntoIterator<Item = impl AsRef<[u8]>>) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for part in parts {
        for byte in part.as_ref().iter().chain(&[0u8]) {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    hash
}

/// A hash of the names, sizes and modification times of the binding
/// schemas: it changes when a schema is added, removed or edited.
fn fingerprint(root: &Path) -> u64 {
    let mut entries: Vec<(String, u64, u128)> = WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "yaml"))
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_nanos());
            let rel = e
                .path()
                .strip_prefix(root)
                .ok()?
                .to_string_lossy()
                .into_owned();
            Some((rel, meta.len(), modified))
        })
        .collect();
    entries.sort();
    fnv(entries
        .iter()
        .flat_map(|(path, len, modified)| [path.clone(), len.to_string(), modified.to_string()]))
}

fn cache_path(cache_dir: &Path, linux: &Path) -> PathBuf {
    let key = fnv([linux.to_string_lossy().as_bytes()]);
    cache_dir.join(format!("catalog-{key:016x}.json"))
}

fn read_cache(path: &Path, fingerprint: u64) -> Option<Catalog> {
    if fs::metadata(path).ok()?.len() > MAX_CACHE_BYTES {
        return None;
    }
    let file: CacheFile = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    (file.format == CACHE_FORMAT && file.fingerprint == fingerprint).then_some(file.catalog)
}

/// Writes through a temporary file, so that a crash leaves the old cache
/// rather than half a new one.
fn write_cache(path: &Path, fingerprint: u64, catalog: Catalog) -> Catalog {
    let file = CacheFile {
        format: CACHE_FORMAT,
        fingerprint,
        catalog,
    };
    let write = || -> std::io::Result<()> {
        fs::create_dir_all(path.parent().unwrap_or(Path::new(".")))?;
        let mut tmp = path.as_os_str().to_owned();
        tmp.push(".tmp");
        let tmp = PathBuf::from(tmp);
        fs::write(&tmp, serde_json::to_vec(&file)?)?;
        fs::rename(&tmp, path).inspect_err(|_| {
            let _ = fs::remove_file(&tmp);
        })
    };
    // A cache that cannot be written only costs the next start its time.
    let _ = write();
    file.catalog
}

/// Like [`index_kernel_tree`], but keeps the result in `cache_dir` (one
/// file per checkout) and reuses it while no binding schema has changed.
pub fn index_kernel_tree_cached(
    linux_src: &Path,
    cache_dir: &Path,
) -> Result<(Catalog, CacheStatus), IndexError> {
    let root = linux_src.join(BINDINGS_DIR);
    if !root.is_dir() {
        return Err(IndexError::NotAKernelTree(linux_src.to_path_buf()));
    }
    let fingerprint = fingerprint(&root);
    let path = cache_path(cache_dir, linux_src);
    if let Some(catalog) = read_cache(&path, fingerprint) {
        return Ok((catalog, CacheStatus::Hit));
    }
    let catalog = index_kernel_tree(linux_src)?;
    Ok((
        write_cache(&path, fingerprint, catalog),
        CacheStatus::Rebuilt,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Dir(PathBuf);

    impl Dir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir()
                .join(format!("designtree-{name}-{}-{nonce}", std::process::id()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const SCHEMA: &str = "%YAML 1.2\n---\n$id: http://devicetree.org/schemas/test.yaml#\n$schema: http://devicetree.org/meta-schemas/core.yaml#\ntitle: Test device\nproperties:\n  compatible:\n    const: acme,test\nrequired:\n  - compatible\n";

    fn kernel(makefile: &str) -> Dir {
        let dir = Dir::new("kernel");
        fs::create_dir_all(dir.0.join(BINDINGS_DIR)).unwrap();
        fs::write(dir.0.join(BINDINGS_DIR).join("test.yaml"), SCHEMA).unwrap();
        fs::write(dir.0.join("Makefile"), makefile).unwrap();
        dir
    }

    #[test]
    fn reads_the_version_from_the_makefile() {
        let head = |sub: &str, extra: &str| {
            format!("# SPDX\nVERSION = 7\nPATCHLEVEL = 3\nSUBLEVEL = {sub}\nEXTRAVERSION ={extra}\nNAME = Test\n")
        };
        assert_eq!(
            kernel_version(&kernel(&head("0", "")).0).as_deref(),
            Some("7.3")
        );
        assert_eq!(
            kernel_version(&kernel(&head("4", "")).0).as_deref(),
            Some("7.3.4")
        );
        assert_eq!(
            kernel_version(&kernel(&head("0", " -rc2")).0).as_deref(),
            Some("7.3-rc2")
        );
        assert_eq!(kernel_version(&kernel("all:\n").0), None);
        assert_eq!(kernel_version(Path::new("/nonexistent")), None);
    }

    #[test]
    fn caches_until_a_schema_changes() {
        let linux = kernel("VERSION = 7\nPATCHLEVEL = 3\n");
        let cache = Dir::new("cache");
        let (first, status) = index_kernel_tree_cached(&linux.0, &cache.0).unwrap();
        assert_eq!(status, CacheStatus::Rebuilt);
        assert_eq!(first.bindings.len(), 1);

        let (second, status) = index_kernel_tree_cached(&linux.0, &cache.0).unwrap();
        assert_eq!(status, CacheStatus::Hit);
        assert_eq!(second.bindings, first.bindings);

        // A new schema (and a different size) invalidates the cache.
        fs::write(
            linux.0.join(BINDINGS_DIR).join("other.yaml"),
            SCHEMA.replace("acme,test", "acme,other"),
        )
        .unwrap();
        let (third, status) = index_kernel_tree_cached(&linux.0, &cache.0).unwrap();
        assert_eq!(status, CacheStatus::Rebuilt);
        assert_eq!(third.bindings.len(), 2);
    }

    #[test]
    fn a_damaged_cache_is_rebuilt() {
        let linux = kernel("VERSION = 7\nPATCHLEVEL = 3\n");
        let cache = Dir::new("cache");
        index_kernel_tree_cached(&linux.0, &cache.0).unwrap();
        let file = fs::read_dir(&cache.0)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        fs::write(&file, "{ not json").unwrap();
        let (catalog, status) = index_kernel_tree_cached(&linux.0, &cache.0).unwrap();
        assert_eq!(status, CacheStatus::Rebuilt);
        assert_eq!(catalog.bindings.len(), 1);
    }

    #[test]
    fn a_tree_without_bindings_is_refused() {
        let empty = Dir::new("empty");
        let cache = Dir::new("cache");
        assert!(index_kernel_tree_cached(&empty.0, &cache.0).is_err());
    }
}
