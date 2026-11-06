import { useEffect, useState } from "react";
import { backend, dialogs, type KernelInfo } from "../backend";

interface Props {
  /** Path of the kernel the library is built from. */
  active: string | null;
  /** Makes the library use the kernel at `path`. */
  onUse: (path: string) => void;
}

/** The registered kernel checkouts, for Settings › Kernel. */
export function KernelCheckouts({ active, onUse }: Props) {
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
    <div className="kernel-checkouts">
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
            {k.path === active ? <em>in use</em> : <button onClick={() => onUse(k.path)}>Use</button>}
            <button onClick={() => remove(k.path)} title="Forget this checkout (its files stay)">
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button onClick={add} disabled={!kernels}>
        Add checkout…
      </button>
    </div>
  );
}
