export default function SettingsLoading() {
  return (
    <main className="app-main settings-page-main app-frame flex min-h-screen w-full flex-col" aria-hidden="true">
      <section className="settings-hero route-hero relative overflow-hidden p-5 sm:p-8">
        <div className="relative z-10 mx-auto max-w-3xl space-y-3 text-left sm:text-center">
          <div className="h-4 w-36 animate-pulse rounded-full bg-white/10 sm:mx-auto" />
          <div className="h-10 w-48 animate-pulse rounded-sm bg-white/12 sm:mx-auto sm:h-12" />
          <div className="h-12 w-full max-w-xl animate-pulse rounded-md bg-white/8 sm:mx-auto" />
        </div>
      </section>
      <div className="settings-layout">
        <div className="glass-card h-40 animate-pulse rounded-3xl bg-white/6" />
        <div className="glass-card h-80 animate-pulse rounded-3xl bg-white/6" />
      </div>
    </main>
  );
}
