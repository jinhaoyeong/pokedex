/**
 * A living Pokémon-world atmosphere behind the whole app: a warm sun glow,
 * drifting clouds, floating sparkles and big translucent Poké Balls bobbing
 * across the sky. Pure CSS, pointer-safe, silenced by reduced motion.
 */
export function AmbientBackdrop() {
  return (
    <div className="poke-sky" aria-hidden="true">
      <span className="poke-sun" />
      <span className="poke-cloud poke-cloud--1" />
      <span className="poke-cloud poke-cloud--2" />
      <span className="poke-cloud poke-cloud--3" />
      <span className="poke-orb poke-orb--1" />
      <span className="poke-orb poke-orb--2" />
      <span className="poke-orb poke-orb--3" />
      <span className="poke-spark poke-spark--1" />
      <span className="poke-spark poke-spark--2" />
      <span className="poke-spark poke-spark--3" />
      <span className="poke-spark poke-spark--4" />
      <span className="poke-spark poke-spark--5" />
      <span className="poke-spark poke-spark--6" />
    </div>
  );
}
