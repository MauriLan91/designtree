//! Connector pins of the board view (US-14.3): which devices claim the SoC
//! pad behind each pin, and the pins claimed twice.
//!
//! A device claims a pad by using its GPIO line (a `*-gpios` property or a
//! `gpio-hog`), or by selecting a `pinctrl` group that muxes the pad to a
//! function. The pads a group muxes are not read from the group itself,
//! whose format differs on every SoC: the connector pin lists them.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{
    Connector, ConnectorPin, EdgeKind, GpioLine, Graph, Node, NodeId, PinKind, PropertyValue,
};

/// What claims one connector pin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PinState {
    pub connector: String,
    pub number: u32,
    /// Enabled devices that claim the pad, in design order.
    pub claimed_by: Vec<NodeId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PinProblem {
    pub connector: String,
    pub number: u32,
    pub message: String,
    /// The devices involved, to select on the canvas.
    pub nodes: Vec<NodeId>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PinCheck {
    pub pins: Vec<PinState>,
    pub problems: Vec<PinProblem>,
}

/// Checks the connector pins of `graph` against the devices that use them.
pub fn pin_check(graph: &Graph) -> PinCheck {
    let Some(board) = &graph.board else {
        return PinCheck::default();
    };
    let tree = Tree::new(graph);
    let gpio_users = gpio_users(graph, &tree);
    let pinctrl_users = pinctrl_users(graph, &tree);

    let mut check = PinCheck::default();
    let mut problem =
        |connector: &Connector, pin: &ConnectorPin, message: String, nodes: Vec<NodeId>| {
            check.problems.push(PinProblem {
                connector: connector.id.clone(),
                number: pin.number,
                message,
                nodes,
            })
        };
    // Power and ground pins have no pad, whatever they were mapped to before.
    let signals = || {
        board.connectors.iter().flat_map(|c| {
            c.pins
                .iter()
                .filter(|p| p.kind == PinKind::Signal)
                .map(move |p| (c, p))
        })
    };
    let mut wired: HashMap<&GpioLine, Vec<(&Connector, &ConnectorPin)>> = HashMap::new();
    for (connector, pin) in signals() {
        if let Some(line) = &pin.gpio {
            wired.entry(line).or_default().push((connector, pin));
        }
    }

    let mut pins = Vec::new();
    for (connector, pin) in signals() {
        let mut claimed_by: Vec<&NodeId> = Vec::new();
        if let Some(line) = &pin.gpio {
            match tree.node(&line.controller) {
                None => problem(
                    connector,
                    pin,
                    format!(
                        "the GPIO controller `{}` is not in the design",
                        line.controller.0
                    ),
                    Vec::new(),
                ),
                Some(controller) => {
                    // Reported on every pin of the pair, so both show.
                    for (other, other_pin) in &wired[line] {
                        if !std::ptr::eq(*other_pin, pin) {
                            let message = format!(
                                "{} pin {} is wired to the same GPIO line ({})",
                                other.title,
                                other_pin.number,
                                line_name(controller, &line.cells)
                            );
                            problem(connector, pin, message, Vec::new());
                        }
                    }
                    claimed_by.extend(gpio_users.get(line).into_iter().flatten());
                }
            }
        }
        for group in &pin.pinctrl {
            if tree.node(group).is_none() {
                problem(
                    connector,
                    pin,
                    format!("the pinctrl group `{}` is not in the design", group.0),
                    Vec::new(),
                );
            }
            claimed_by.extend(pinctrl_users.get(group).into_iter().flatten());
        }

        let claimed_by = tree.in_design_order(claimed_by);
        let claimants: Vec<&NodeId> = claimed_by
            .iter()
            .copied()
            .filter(|id| !claimed_by.iter().any(|c| tree.is_part_of(id, c)))
            .collect();
        if claimants.len() > 1 {
            let names: Vec<String> = claimants
                .iter()
                .filter_map(|id| tree.node(id))
                .map(|n| format!("`{}`", n.label.clone().unwrap_or_else(|| n.full_name())))
                .collect();
            problem(
                connector,
                pin,
                format!("claimed by {}", names.join(" and ")),
                claimants.iter().map(|&id| id.clone()).collect(),
            );
        }
        pins.push(PinState {
            connector: connector.id.clone(),
            number: pin.number,
            claimed_by: claimants.into_iter().cloned().collect(),
        });
    }
    check.pins = pins;
    check
}

/// `gpio1 5`: a GPIO line as a person reads it.
fn line_name(controller: &Node, cells: &[u32]) -> String {
    let name = controller
        .label
        .clone()
        .unwrap_or_else(|| controller.full_name());
    let cells: Vec<String> = cells.iter().map(u32::to_string).collect();
    format!("{name} {}", cells.join(" "))
}

/// The enabled devices that use each GPIO line.
fn gpio_users<'a>(graph: &'a Graph, tree: &Tree<'a>) -> HashMap<GpioLine, Vec<&'a NodeId>> {
    let mut users: HashMap<GpioLine, Vec<&NodeId>> = HashMap::new();
    for edge in &graph.edges {
        let EdgeKind::Reference { property, args } = &edge.kind else {
            continue;
        };
        if !is_gpio_property(property) || tree.is_disabled(&edge.from) {
            continue;
        }
        let Some(controller) = tree.node(&edge.to) else {
            continue;
        };
        let line = GpioLine {
            controller: edge.to.clone(),
            cells: without_flags(controller, args).to_vec(),
        };
        users.entry(line).or_default().push(&edge.from);
    }
    // A hog is a child of its controller with the specifiers in `gpios`,
    // and no phandle.
    for hog in graph.nodes.iter().filter(|n| has_property(n, "gpio-hog")) {
        let Some(controller) = tree.parent(&hog.id).and_then(|p| tree.node(p)) else {
            continue;
        };
        if tree.is_disabled(&hog.id) {
            continue;
        }
        let Some(cells) = cells_of(hog, "gpios") else {
            continue;
        };
        let per = gpio_cells(controller).max(1);
        for spec in cells.chunks(per) {
            let line = GpioLine {
                controller: controller.id.clone(),
                cells: without_flags(controller, spec).to_vec(),
            };
            users.entry(line).or_default().push(&hog.id);
        }
    }
    users
}

/// The enabled devices that select each pinctrl group, in any state.
fn pinctrl_users<'a>(graph: &'a Graph, tree: &Tree<'a>) -> HashMap<&'a NodeId, Vec<&'a NodeId>> {
    let mut users: HashMap<&NodeId, Vec<&NodeId>> = HashMap::new();
    for edge in &graph.edges {
        let EdgeKind::Reference { property, .. } = &edge.kind else {
            continue;
        };
        let is_state = property
            .strip_prefix("pinctrl-")
            .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
        if is_state && !tree.is_disabled(&edge.from) {
            users.entry(&edge.to).or_default().push(&edge.from);
        }
    }
    users
}

/// `gpios`, `reset-gpios`, and the deprecated `gpio` and `*-gpio`.
fn is_gpio_property(name: &str) -> bool {
    name == "gpios" || name == "gpio" || name.ends_with("-gpios") || name.ends_with("-gpio")
}

/// `#gpio-cells` of a controller; 2 (line and flags) when it does not say.
fn gpio_cells(controller: &Node) -> usize {
    cells_of(controller, "#gpio-cells")
        .and_then(|c| c.first().copied())
        .map_or(2, |c| c as usize)
}

/// The cells that name the line: all but the last, which holds the flags.
fn without_flags<'s>(controller: &Node, spec: &'s [u32]) -> &'s [u32] {
    if gpio_cells(controller) >= 2 && !spec.is_empty() {
        &spec[..spec.len() - 1]
    } else {
        spec
    }
}

fn has_property(node: &Node, name: &str) -> bool {
    node.properties.iter().any(|p| p.name == name)
}

fn cells_of<'n>(node: &'n Node, name: &str) -> Option<&'n [u32]> {
    node.properties
        .iter()
        .find(|p| p.name == name)
        .and_then(|p| match &p.value {
            PropertyValue::Cells(cells) => Some(cells.as_slice()),
            _ => None,
        })
}

/// The node hierarchy, for status and ancestry lookups.
struct Tree<'a> {
    nodes: HashMap<&'a NodeId, &'a Node>,
    parent: HashMap<&'a NodeId, &'a NodeId>,
    order: HashMap<&'a NodeId, usize>,
}

impl<'a> Tree<'a> {
    fn new(graph: &'a Graph) -> Self {
        let parent = graph
            .edges
            .iter()
            .filter(|e| e.kind == EdgeKind::Child)
            .map(|e| (&e.to, &e.from))
            .collect();
        let order = graph
            .nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (&n.id, i))
            .collect();
        let nodes = graph.nodes.iter().map(|n| (&n.id, n)).collect();
        Tree {
            nodes,
            parent,
            order,
        }
    }

    fn parent(&self, id: &NodeId) -> Option<&'a NodeId> {
        self.parent.get(id).copied()
    }

    /// `id` and its ancestors, nearest first; stops at a cycle.
    fn ancestry(&self, id: &'a NodeId) -> impl Iterator<Item = &'a NodeId> + '_ {
        let mut at = Some(id);
        std::iter::from_fn(move || {
            let current = at?;
            at = self.parent(current);
            Some(current)
        })
        .take(self.parent.len() + 1)
    }

    fn node(&self, id: &NodeId) -> Option<&'a Node> {
        self.nodes.get(id).copied()
    }

    /// `id` is a part of the device `device`, not a device of its own: a
    /// subnode with no `reg` on the way up, such as a `gpio-keys` button.
    /// A device on a bus has a `reg`, so an I2C sensor is not part of its
    /// controller.
    fn is_part_of(&self, id: &'a NodeId, device: &NodeId) -> bool {
        for at in self.ancestry(id) {
            if at == device {
                return at != id;
            }
            if self.node(at).is_some_and(|n| has_property(n, "reg")) {
                return false;
            }
        }
        false
    }

    /// A node, or one of its ancestors, has a `status` other than `okay`.
    fn is_disabled(&self, id: &'a NodeId) -> bool {
        self.ancestry(id).filter_map(|id| self.node(id)).any(|n| {
            n.properties.iter().any(|p| {
                p.name == "status"
                    && matches!(&p.value, PropertyValue::Strings(s)
                            if s.first().is_some_and(|s| s != "okay" && s != "ok"))
            })
        })
    }

    /// The ids sorted in design order, without duplicates.
    fn in_design_order(&self, ids: Vec<&'a NodeId>) -> Vec<&'a NodeId> {
        let mut seen = HashSet::new();
        let mut ids: Vec<&NodeId> = ids.into_iter().filter(|id| seen.insert(*id)).collect();
        ids.sort_by_key(|id| self.order.get(id).copied().unwrap_or(usize::MAX));
        ids
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::import_dts;
    use crate::model::Board;
    use crate::preprocess::ImportOptions;

    fn import(dts: &str) -> Graph {
        import_dts(
            dts,
            std::path::Path::new("board.dts"),
            &ImportOptions::default(),
        )
        .unwrap()
    }

    const DTS: &str = "/dts-v1/;
/ {
	soc {
		gpio1: gpio@1000 {
			gpio-controller;
			#gpio-cells = <2>;
			hog {
				gpio-hog;
				gpios = <9 0>;
				output-high;
			};
		};
		pio: pinctrl@2000 {
			i2c1_pins: i2c1-pins { pins = \"PA2\", \"PA3\"; };
			uart2_pins: uart2-pins { pins = \"PA2\", \"PA3\"; };
		};
		i2c1: i2c@3000 {
			pinctrl-names = \"default\";
			pinctrl-0 = <&i2c1_pins>;
			#address-cells = <1>;
			#size-cells = <0>;
			codec@1a { reg = <0x1a>; reset-gpios = <&gpio1 3 0>; };
		};
		uart2: serial@4000 {
			pinctrl-names = \"default\";
			pinctrl-0 = <&uart2_pins>;
			status = \"disabled\";
		};
	};
	leds {
		pinctrl-0 = <&led_pins>;
		led_pins: led-pins { };
		led { gpios = <&gpio1 4 0>; };
	};
	reset: reset { reset-gpios = <&gpio1 4 1>; };
	sensor { irq-gpios = <&gpio1 2 0>; };
};
";

    fn graph(pins: Vec<ConnectorPin>) -> Graph {
        let mut graph = import(DTS);
        graph.board = Some(Board {
            background: None,
            connectors: vec![Connector {
                id: "j8".into(),
                title: "J8".into(),
                template: None,
                position: Default::default(),
                pins,
            }],
        });
        graph
    }

    fn id(graph: &Graph, name: &str) -> NodeId {
        graph
            .nodes
            .iter()
            .find(|n| n.full_name() == name)
            .unwrap_or_else(|| panic!("no node {name}"))
            .id
            .clone()
    }

    fn pin(number: u32, gpio: Option<(&NodeId, u32)>, pinctrl: Vec<NodeId>) -> ConnectorPin {
        ConnectorPin {
            number,
            name: format!("P{number}"),
            kind: PinKind::Signal,
            gpio: gpio.map(|(controller, line)| GpioLine {
                controller: controller.clone(),
                cells: vec![line],
            }),
            pinctrl,
        }
    }

    fn claimed(check: &PinCheck, number: u32, graph: &Graph) -> Vec<String> {
        let state = check.pins.iter().find(|p| p.number == number).unwrap();
        state
            .claimed_by
            .iter()
            .map(|id| graph.node(id).unwrap().full_name())
            .collect()
    }

    #[test]
    fn devices_claim_pins_through_gpios_hogs_and_pinctrl_groups() {
        let g = graph(Vec::new());
        let gpio1 = id(&g, "gpio@1000");
        let (i2c, uart) = (id(&g, "i2c1-pins"), id(&g, "uart2-pins"));
        let g = graph(vec![
            pin(3, Some((&gpio1, 2)), vec![i2c.clone(), uart.clone()]),
            pin(5, Some((&gpio1, 9)), Vec::new()),
            pin(7, Some((&gpio1, 30)), Vec::new()),
        ]);
        let check = pin_check(&g);

        // The disabled UART does not count; the I2C controller and the
        // sensor's interrupt line do.
        assert_eq!(claimed(&check, 3, &g), ["i2c@3000", "sensor"]);
        assert_eq!(claimed(&check, 5, &g), ["hog"]);
        assert!(claimed(&check, 7, &g).is_empty());
        assert_eq!(check.problems.len(), 1, "{:?}", check.problems);
        let problem = &check.problems[0];
        assert_eq!(problem.number, 3);
        assert_eq!(problem.message, "claimed by `i2c1` and `sensor`");
        assert_eq!(problem.nodes.len(), 2);
    }

    #[test]
    fn a_device_and_its_subnodes_are_one_claimant() {
        let g = graph(Vec::new());
        let gpio1 = id(&g, "gpio@1000");
        let led_pins = id(&g, "led-pins");
        let g = graph(vec![pin(11, Some((&gpio1, 4)), vec![led_pins])]);
        let check = pin_check(&g);

        // `leds` muxes the pad for its `led`: one claimant. `reset` uses
        // the same line (with other flags): a second one.
        assert_eq!(claimed(&check, 11, &g), ["leds", "reset"]);
        assert_eq!(check.problems.len(), 1);
    }

    #[test]
    fn a_device_on_a_bus_is_not_part_of_its_controller() {
        let g = graph(Vec::new());
        let gpio1 = id(&g, "gpio@1000");
        let i2c = id(&g, "i2c1-pins");
        let g = graph(vec![pin(5, Some((&gpio1, 3)), vec![i2c])]);
        let check = pin_check(&g);

        // The codec's reset line on the pad the controller muxes to I2C.
        assert_eq!(claimed(&check, 5, &g), ["i2c@3000", "codec@1a"]);
        assert_eq!(check.problems.len(), 1);
    }

    #[test]
    fn subnodes_merge_into_their_device_in_any_order() {
        let g = graph(Vec::new());
        let gpio1 = id(&g, "gpio@1000");
        let led_pins = id(&g, "led-pins");
        let mut g = graph(vec![pin(11, Some((&gpio1, 4)), vec![led_pins])]);
        let leds = g.nodes.iter().position(|n| n.name == "leds").unwrap();
        let led = g
            .nodes
            .remove(g.nodes.iter().position(|n| n.name == "led").unwrap());
        g.nodes.insert(leds, led);

        assert_eq!(claimed(&pin_check(&g), 11, &g), ["leds", "reset"]);
    }

    #[test]
    fn power_and_ground_pins_have_no_pad() {
        let g = graph(Vec::new());
        let gpio1 = id(&g, "gpio@1000");
        let mut power = pin(1, Some((&gpio1, 4)), vec![NodeId::from("gone")]);
        power.kind = PinKind::Power;
        let g = graph(vec![power, pin(2, Some((&gpio1, 4)), Vec::new())]);
        let check = pin_check(&g);

        assert_eq!(check.pins.len(), 1);
        assert_eq!(check.pins[0].number, 2);
        assert_eq!(
            check.problems.len(),
            1,
            "only the claim on pin 2: {:?}",
            check.problems
        );
    }

    #[test]
    fn missing_targets_and_doubly_wired_lines_are_flagged() {
        let g = graph(Vec::new());
        let gpio1 = id(&g, "gpio@1000");
        let gone = NodeId::from("gone");
        let g = graph(vec![
            pin(1, Some((&gone, 1)), vec![NodeId::from("gone-pins")]),
            pin(2, Some((&gpio1, 30)), Vec::new()),
            pin(4, Some((&gpio1, 30)), Vec::new()),
        ]);
        let messages: Vec<(u32, String)> = pin_check(&g)
            .problems
            .into_iter()
            .map(|p| (p.number, p.message))
            .collect();
        assert_eq!(
            messages,
            [
                (
                    1,
                    "the GPIO controller `gone` is not in the design".to_string()
                ),
                (
                    1,
                    "the pinctrl group `gone-pins` is not in the design".to_string()
                ),
                (
                    2,
                    "J8 pin 4 is wired to the same GPIO line (gpio1 30)".to_string()
                ),
                (
                    4,
                    "J8 pin 2 is wired to the same GPIO line (gpio1 30)".to_string()
                ),
            ]
        );
    }

    #[test]
    fn a_design_without_a_board_has_nothing_to_check() {
        assert_eq!(pin_check(&import(DTS)), PinCheck::default());
    }
}
