// Failures the suite knows about (US-4.5): each is a bug filed on GitHub.
// A known failure does not fail the run, and is listed with its issue; once
// it passes, the run fails until its line here is removed, so that fixed
// bugs do not stay on this list.
//
// Keys are `kind:id` for a whole element or `kind:id:way` for one way in.
export const KNOWN = {
  "element:key-ctrl-tab": 252, // Ctrl+Shift+Tab: WebKitGTK sends key "Unidentified"
  "element:status-bar": 253, // Escape on a pick opened from a menu
  "element:soc-picker": 254, // Escape does not close the SoC picker
};
