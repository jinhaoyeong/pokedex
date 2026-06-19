/**
 * Decorative, non-interactive layer that adds a living atmosphere behind the
 * whole app: slow-drifting energy auroras, a faint dot grid, floating sparkles
 * and two distant orbiting pokeball motifs. Pure CSS animation, pointer-safe,
 * and silenced by prefers-reduced-motion via globals.css.
 */
export function AmbientBackdrop() {
  return (
    <div className="ambient-backdrop" aria-hidden="true">
      <span className="ambient-aurora ambient-aurora--a" />
      <span className="ambient-aurora ambient-aurora--b" />
      <span className="ambient-aurora ambient-aurora--c" />
      <span className="ambient-grid" />
      <span className="ambient-spark ambient-spark--1" />
      <span className="ambient-spark ambient-spark--2" />
      <span className="ambient-spark ambient-spark--3" />
      <span className="ambient-spark ambient-spark--4" />
      <span className="ambient-spark ambient-spark--5" />
      <span className="ambient-spark ambient-spark--6" />
      <span className="ambient-ball ambient-ball--1" />
      <span className="ambient-ball ambient-ball--2" />
    </div>
  );
}
