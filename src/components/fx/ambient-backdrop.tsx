/**
 * "Pokédex OS" atmosphere behind the entire app: drifting energy auroras, a
 * faint HUD grid, a slow scanline sweep, floating data sparks and two distant
 * orbiting pokeball motifs. Pure CSS, pointer-safe, silenced by reduced motion.
 */
export function AmbientBackdrop() {
  return (
    <div className="ambient-backdrop" aria-hidden="true">
      <span className="ambient-aurora ambient-aurora--a" />
      <span className="ambient-aurora ambient-aurora--b" />
      <span className="ambient-aurora ambient-aurora--c" />
      <span className="ambient-grid" />
      <span className="ambient-scanline" />
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
