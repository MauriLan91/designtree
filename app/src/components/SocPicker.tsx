import { useEffect, useMemo, useState } from "react";
import { backend } from "../backend";
import type { SocDtsi } from "../model";

interface Props {
  /** Starts a board from the SoC at `path` (relative to the kernel tree). */
  onPick: (soc: SocDtsi) => void;
  onClose: () => void;
}

const MAX_SHOWN = 200;

/** Modal list of the SoC .dtsi files of the loaded kernel tree. */
export function SocPicker({ onPick, onClose }: Props) {
  const [socs, setSocs] = useState<SocDtsi[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arch, setArch] = useState("");
  const [vendor, setVendor] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    backend.listSocs().then(setSocs, (e) => setError(String(e)));
  }, []);

  const archs = useMemo(() => [...new Set((socs ?? []).map((s) => s.arch))], [socs]);
  const vendors = useMemo(
    () => [...new Set((socs ?? []).filter((s) => !arch || s.arch === arch).map((s) => s.vendor))].sort(),
    [socs, arch],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (socs ?? []).filter(
      (s) => (!arch || s.arch === arch) && (!vendor || s.vendor === vendor) && (!q || s.name.toLowerCase().includes(q)),
    );
  }, [socs, arch, vendor, query]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="New board from a SoC" onClick={(e) => e.stopPropagation()}>
        <h2>New board from a SoC</h2>
        {error && <p className="error">{error}</p>}
        {!error && !socs && <p className="hint">Scanning the kernel tree…</p>}
        {socs && (
          <>
            <div className="soc-filters">
              <select
                value={arch}
                onChange={(e) => {
                  setArch(e.target.value);
                  setVendor("");
                }}
                aria-label="Architecture"
              >
                <option value="">All architectures</option>
                {archs.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
              <select value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor">
                <option value="">All vendors</option>
                {vendors.map((v) => (
                  <option key={v} value={v}>
                    {v || "(none)"}
                  </option>
                ))}
              </select>
              <input autoFocus placeholder="Filter SoCs…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <ul className="soc-list">
              {shown.slice(0, MAX_SHOWN).map((s) => (
                <li key={s.path}>
                  <button onClick={() => onPick(s)} title={s.path}>
                    <b>{s.name}</b>
                    <span>
                      {s.arch}
                      {s.vendor && ` / ${s.vendor}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="hint">
              {shown.length === 0 && "No SoC matches. "}
              {shown.length > MAX_SHOWN && `Showing ${MAX_SHOWN} of ${shown.length}; narrow the filter. `}
              The board starts with the SoC included, so it only holds what you add.
            </p>
          </>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
