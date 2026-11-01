//! Edits made to a design's devicetree source, applied back to the design:
//! the text is imported again and the result keeps what the text does not
//! carry (node ids, canvas positions, groups).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::dts::NodeSpan;
use crate::import::{import_dts_mapped, ImportError};
use crate::model::{Graph, Group, NodeId, Position};
use crate::preprocess::{find_kernel_tree, ImportOptions};
use crate::validate::node_paths;

/// Imports `source`, the edited text of `previous`, as the new design.
///
/// Includes resolve as they did for `previous`: next to the board, which
/// sits where its first include points, and in the directories of its
/// included files and their kernel tree, else in `kernel`. Since a design
/// file may come from anyone, only directories inside a kernel tree count.
/// Errors in the edited text name no file; others name the included file.
///
/// Nodes keep the id and position they had in `previous` when their path
/// did not change; new nodes are placed below their parent.
pub fn apply_source(
    source: &str,
    previous: &Graph,
    kernel: Option<&Path>,
) -> Result<(Graph, Vec<NodeSpan>), ImportError> {
    if previous.overlay.is_some() {
        return Err(ImportError::new(
            "overlay",
            1,
            "overlay source cannot be edited as text yet; edit it on the canvas",
        ));
    }
    let mut included: Vec<&str> = previous
        .nodes
        .iter()
        .filter_map(|n| Some(n.inherited.as_ref()?.file.as_str()))
        .collect();
    included.sort_unstable();
    included.dedup();
    included.retain(|f| find_kernel_tree(Path::new(f)).is_some());
    // `#include "x/y.dtsi"` and the included file `/k/arch/z/x/y.dtsi` put
    // the board in `/k/arch/z`.
    let board_dir = previous
        .includes
        .iter()
        .filter_map(|d| d.strip_prefix("#include \"")?.strip_suffix('"'))
        .find_map(|name| {
            included.iter().find_map(|f| {
                let dir = f.strip_suffix(name)?.strip_suffix('/')?;
                Some(PathBuf::from(dir))
            })
        })
        .or_else(|| {
            included
                .first()
                .and_then(|f| Some(Path::new(f).parent()?.to_path_buf()))
        });
    // Without one, includes can only come from the kernel tree.
    let file = board_dir
        .unwrap_or_else(|| std::env::temp_dir().join("designtree-edit"))
        .join("board.dts");
    let mut options = ImportOptions::detect_or(&file, kernel);
    let dirs: HashSet<PathBuf> = included
        .iter()
        .filter_map(|f| Some(Path::new(f).parent()?.to_path_buf()))
        .collect();
    options.include_dirs.extend(dirs);

    let shown = file.display().to_string();
    let (mut graph, mut spans) = import_dts_mapped(source, &file, &options).map_err(|mut e| {
        if e.file == shown {
            e.file.clear();
        }
        e
    })?;
    keep_identity(previous, &mut graph, &mut spans);
    graph.groups = kept_groups(&previous.groups, &graph);
    graph.kernel.clone_from(&previous.kernel);
    graph.board.clone_from(&previous.board);
    Ok((graph, spans))
}

/// Gives the nodes of `graph` (whose ids are paths) the ids and positions,
/// on the canvas and on the board, of the nodes at the same path in
/// `previous`.
fn keep_identity(previous: &Graph, graph: &mut Graph, spans: &mut [NodeSpan]) {
    let old_paths = node_paths(previous);
    let by_path: HashMap<&str, &NodeId> = old_paths
        .iter()
        .map(|(id, path)| (path.as_str(), id))
        .collect();
    let old: HashMap<&NodeId, Position> =
        previous.nodes.iter().map(|n| (&n.id, n.position)).collect();
    let on_board: HashMap<&NodeId, Position> = previous
        .nodes
        .iter()
        .filter_map(|n| Some((&n.id, n.board_position?)))
        .collect();

    // New paths to ids: a node that existed keeps its id.
    let mut ids: HashMap<NodeId, NodeId> = HashMap::new();
    for node in &graph.nodes {
        if let Some(id) = by_path.get(node.id.0.as_str()) {
            ids.insert(node.id.clone(), (*id).clone());
        }
    }
    // A new node whose path is the id of an old node (ids of imported
    // designs are paths) must not take it over.
    let clashing: Vec<NodeId> = graph
        .nodes
        .iter()
        .filter(|n| !ids.contains_key(&n.id) && old.contains_key(&n.id))
        .map(|n| n.id.clone())
        .collect();
    for id in clashing {
        let mut n = 1;
        let fresh = loop {
            let candidate = NodeId(format!("{}#{n}", id.0));
            if !old.contains_key(&candidate) {
                break candidate;
            }
            n += 1;
        };
        ids.insert(id, fresh);
    }
    let rename = |id: &mut NodeId| {
        if let Some(new) = ids.get(id) {
            *id = new.clone();
        }
    };

    let parents: HashMap<NodeId, NodeId> = graph
        .edges
        .iter()
        .filter(|e| e.kind == crate::model::EdgeKind::Child)
        .map(|e| (e.to.clone(), e.from.clone()))
        .collect();
    let mut placed_below: HashMap<NodeId, u32> = HashMap::new();
    let mut positions = HashMap::new();
    // Parents come before their children in an import.
    for node in &graph.nodes {
        let id = ids.get(&node.id).unwrap_or(&node.id);
        let position = match old.get(id) {
            Some(p) => *p,
            None => match parents.get(&node.id).and_then(|p| positions.get(p)) {
                Some(&Position { x, y }) => {
                    let k = placed_below.entry(parents[&node.id].clone()).or_insert(0);
                    *k += 1;
                    Position {
                        x: x + 40.0 * (*k - 1) as f32,
                        y: y + 160.0,
                    }
                }
                None => node.position,
            },
        };
        positions.insert(node.id.clone(), position);
    }
    for node in &mut graph.nodes {
        node.position = positions[&node.id];
        rename(&mut node.id);
        node.board_position = on_board.get(&node.id).copied();
    }
    for edge in &mut graph.edges {
        rename(&mut edge.from);
        rename(&mut edge.to);
    }
    for span in spans {
        rename(&mut span.node);
    }
}

/// `groups` without the members `graph` no longer has, and without groups
/// left empty.
fn kept_groups(groups: &[Group], graph: &Graph) -> Vec<Group> {
    let ids: HashSet<&NodeId> = graph.nodes.iter().map(|n| &n.id).collect();
    groups
        .iter()
        .filter_map(|g| {
            let mut group = g.clone();
            group.members.retain(|m| ids.contains(m));
            group.subgroups = kept_groups(&g.subgroups, graph);
            (!group.members.is_empty() || !group.subgroups.is_empty()).then_some(group)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{import_dts, to_dts_mapped};

    const BOARD: &str = r#"/dts-v1/;

/ {
	model = "Test";

	soc {
		uart0: serial@1000 {
			reg = <0x1000 0x100>;
		};
	};
};
"#;

    /// A design as the app makes it: ids that are not paths.
    fn design() -> Graph {
        let mut graph =
            import_dts(BOARD, Path::new("board.dts"), &ImportOptions::default()).unwrap();
        let ids: HashMap<NodeId, NodeId> = graph
            .nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id.clone(), NodeId(format!("n{i}"))))
            .collect();
        for node in &mut graph.nodes {
            node.id = ids[&node.id].clone();
            node.position = Position { x: 7.0, y: 9.0 };
        }
        for edge in &mut graph.edges {
            edge.from = ids[&edge.from].clone();
            edge.to = ids[&edge.to].clone();
        }
        graph.groups = vec![Group {
            id: "g".into(),
            title: "SoC".into(),
            members: vec![NodeId("n1".into()), NodeId("n2".into())],
            subgroups: vec![],
            position: Position::default(),
            size: None,
            collapsed: false,
        }];
        graph
    }

    #[test]
    fn edited_text_keeps_ids_positions_and_groups() {
        let mut previous = design();
        let serial_at = previous
            .nodes
            .iter()
            .position(|n| n.name == "serial")
            .unwrap();
        previous.nodes[serial_at].board_position = Some(Position { x: 3.0, y: 4.0 });
        previous.board = Some(crate::model::Board {
            background: Some("board.png".into()),
        });
        let (text, _) = to_dts_mapped(&previous).unwrap();
        assert!(
            !text.contains("board"),
            "the board view is not exported: {text}"
        );
        let edited = text.replace(
            "reg = <0x1000 0x100>;",
            "reg = <0x1000 0x100>;\n\t\t\tstatus = \"okay\";\n\n\t\t\tdevice@1 {\n\t\t\t\treg = <1>;\n\t\t\t};",
        );
        let (graph, spans) = apply_source(&edited, &previous, None).unwrap();

        let serial = graph.nodes.iter().find(|n| n.name == "serial").unwrap();
        assert_eq!(serial.id, NodeId("n2".into()));
        assert_eq!(serial.position, Position { x: 7.0, y: 9.0 });
        assert_eq!(serial.board_position, Some(Position { x: 3.0, y: 4.0 }));
        assert_eq!(graph.board, previous.board);
        assert!(serial.properties.iter().any(|p| p.name == "status"));
        let device = graph.nodes.iter().find(|n| n.name == "device").unwrap();
        assert_eq!(device.id.0, "/soc/serial@1000/device@1");
        assert_eq!(device.position, Position { x: 7.0, y: 169.0 });
        assert_eq!(device.board_position, None);
        assert_eq!(graph.groups[0].members.len(), 2);

        // The serial block spans its lines in the edited text.
        let span = spans.iter().find(|s| s.node == serial.id).unwrap();
        let lines: Vec<&str> = edited.lines().collect();
        assert!(lines[span.first_line as usize - 1].contains("serial@1000 {"));
        assert_eq!(lines[span.last_line as usize - 1].trim(), "};");
    }

    #[test]
    fn removed_nodes_leave_their_groups() {
        let previous = design();
        let (text, _) = to_dts_mapped(&previous).unwrap();
        let start = text.find("\t\tuart0:").unwrap();
        let end = text[start..].find("\t\t};\n").unwrap() + start + 5;
        let edited = format!("{}{}", &text[..start], &text[end..]);
        let (graph, _) = apply_source(&edited, &previous, None).unwrap();
        assert!(graph.nodes.iter().all(|n| n.name != "serial"));
        assert_eq!(graph.groups[0].members, vec![NodeId("n1".into())]);
    }

    #[test]
    fn syntax_errors_are_located() {
        let previous = design();
        let err = apply_source("/dts-v1/;\n/ {\n\tmodel = ;\n};\n", &previous, None).unwrap_err();
        assert_eq!(err.line, 3, "{err}");
    }

    /// A board in `arch/` of a fake kernel tree that includes
    /// `common/soc.dtsi`; with `kernel` false, the tree has no kernel marker.
    fn board_in_tree(name: &str, kernel: bool) -> (PathBuf, Graph) {
        let root = std::env::temp_dir().join(format!("designtree-{name}-{}", std::process::id()));
        if kernel {
            std::fs::create_dir_all(root.join("scripts/dtc/include-prefixes")).unwrap();
        }
        let dir = root.join("arch");
        std::fs::create_dir_all(dir.join("common")).unwrap();
        std::fs::write(
            dir.join("common/soc.dtsi"),
            "/ {\n\tsoc {\n\t\tuart0: serial@1000 {\n\t\t\tstatus = \"disabled\";\n\t\t};\n\t};\n};\n",
        )
        .unwrap();
        let board =
            "/dts-v1/;\n#include \"common/soc.dtsi\"\n\n&uart0 {\n\tstatus = \"okay\";\n};\n";
        std::fs::write(dir.join("board.dts"), board).unwrap();
        let graph =
            crate::import_dts_file(&dir.join("board.dts"), &ImportOptions::default()).unwrap();
        (root, graph)
    }

    #[test]
    fn board_files_resolve_their_includes() {
        let (root, previous) = board_in_tree("text", true);
        let (text, map) = to_dts_mapped(&previous).unwrap();
        let line = text.lines().position(|l| l == "&uart0 {").unwrap() as u32 + 1;
        let span = map.node_at_line(line + 1).unwrap();
        assert_eq!(span.node.0, "/soc/serial@1000");

        let edited = text.replace("\"okay\"", "\"reserved\"");
        let result = apply_source(&edited, &previous, None);
        let _ = std::fs::remove_dir_all(&root);
        let (graph, spans) = result.unwrap();
        let serial = graph.nodes.iter().find(|n| n.name == "serial").unwrap();
        assert!(serial.inherited.is_some(), "the include was resolved");
        assert!(spans
            .iter()
            .any(|s| s.node == serial.id && s.first_line == line));
    }

    #[test]
    fn includes_outside_a_kernel_tree_are_not_followed() {
        // The design file names the included files, so it could point the
        // include path anywhere.
        let (root, previous) = board_in_tree("untrusted", false);
        let text = to_dts_mapped(&previous).unwrap().0;
        let result = apply_source(&text, &previous, None);
        let _ = std::fs::remove_dir_all(&root);
        let err = result.unwrap_err();
        assert!(err.message.contains("cannot find include file"), "{err}");
        assert_eq!(err.file, "", "the error is in the edited text");
    }
}
