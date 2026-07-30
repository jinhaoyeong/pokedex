/**
 * Premium ambient layer: a slow-drifting soft glow, a faint film grain and a
 * subtle vignette. It adds depth without decoration and never intercepts input.
 */
export function AmbientBackdrop() {
  return (
    <div className="ambient" aria-hidden="true">
      <span className="ambient-glow ambient-glow--a" />
      <span className="ambient-glow ambient-glow--b" />
      <span className="ambient-grain" />
      <span className="ambient-vignette" />
    </div>
  );
}
