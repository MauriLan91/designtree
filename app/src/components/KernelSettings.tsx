import { useEffect, useState } from "react";
import { backend, dialogs, type KernelInfo } from "../backend";

interface Props {
  /** Path of the kernel the library is built from. */
  active: string | null;
  /** Makes the library use the kernel at `path`. */
  onUse: (path: string) => void;
  onClose: () => void;
}

/** Modal list of the registered kernel checkouts. */
export function KernelSettings({ active, onUse, onClose }: Props) {
  const [kernels, setKernels] = useState<KernelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend.listKernels().then(setKernels, (e) => setError(String(e)));
  }, []);

  const add = async () => {
    const dir = await dialogs.pickKernelTree();
    if (!dir) return;
    try {
      setError(null);
      await backend.addKernel(dir);
      setKernels(await backend.listKernels());
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async (path: string) => {
    try {
      setKernels(await backend.removeKernel(path));
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Kernel checkouts" onClick={(e) => e.stopPropagation()}>
        <h2>Kernel checkouts</h2>
        {error && <p className="error">{error}</p>}
        {kernels && kernels.length === 0 && (
          <p className="hint">No kernel registered yet. Add a Linux source tree to build the library from it.</p>
        )}
        <ul className="kernel-list">
          {(kernels ?? []).map((k) => (
            <li key={k.path} className={k.path === active ? "active" : undefined}>
              <div className="kernel-text">
                <b>{k.version ? `Linux ${k.version}` : "Unknown version"}</b>
                <span title={k.path}>{k.path}</span>
              </div>
              {k.path === active ? (
                <em>in use</em>
              ) : (
                <button onClick={() => onUse(k.path)}>Use</button>
              )}
              <button onClick={() => remove(k.path)} title="Forget this checkout (its files stay)">
                Remove
              </button>
            </li>
          ))}
        </ul>
        <p className="hint">
          The design records the kernel version it is saved with, and warns when it is opened against another one.
        </p>
        <div className="modal-actions">
          <button onClick={add} disabled={!kernels}>Add checkout…</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
