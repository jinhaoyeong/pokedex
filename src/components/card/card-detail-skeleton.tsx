/**
 * The route-level fallback, shown while the card record resolves. It states
 * the same shapes the page settles into — a record sheet, then the three
 * market instruments — rather than three pulsing rounded boxes in the old
 * glass-card style the page itself no longer uses.
 */
export function CardDetailSkeleton() {
  return (
    <main
      className="app-main app-frame flex w-full flex-col gap-8 pb-8 sm:gap-10 sm:pb-10"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 text-sm font-bold text-slate-400">
        <span className="mx-skeleton-bar w-24" />
        <span>/</span>
        <span className="mx-skeleton-bar w-40 max-w-[55vw]" />
      </div>

      <section className="sheet cd-sheet">
        <header className="sheet-band">
          <h2 className="sheet-band-title">Card record</h2>
        </header>
        <div className="cd-body">
          <div className="cd-art-col">
            <div className="cd-art mx-skeleton-plate" />
          </div>
          <div className="cd-main">
            <span className="mx-skeleton-bar w-32" />
            <span className="mx-skeleton-bar mx-skeleton-bar--lg mt-4 w-2/3" />
            <span className="mx-skeleton-bar mt-6 w-full" />
          </div>
        </div>
      </section>

      <div className="mx-grid">
        <section className="sheet mx-sheet mx-grades">
          <header className="sheet-band">
            <h2 className="sheet-band-title">Grade values</h2>
          </header>
          <div className="mx-table-head">
            <span>Grade</span>
            <span>Value</span>
          </div>
          <div className="mx-table">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="mx-row">
                <span className="mx-skeleton-bar w-28" />
                <span className="mx-skeleton-bar w-16" />
              </div>
            ))}
          </div>
        </section>

        <div className="mx-col">
          <section className="sheet mx-sheet mx-chart">
            <header className="sheet-band">
              <h2 className="sheet-band-title">Price chart</h2>
            </header>
            <div className="mx-chart-body">
              <div className="mx-plot h-44 sm:h-52" />
            </div>
          </section>

          <section className="sheet mx-sheet mx-pop">
            <header className="sheet-band">
              <h2 className="sheet-band-title">Population</h2>
            </header>
            <div className="mx-pop-grades">
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <div key={row} className="mx-pop-cell">
                  <span className="mx-skeleton-bar w-12" />
                  <span className="mx-skeleton-bar w-10" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
