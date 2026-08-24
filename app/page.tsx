import Image from "next/image"
import { MarketHeader } from "@/components/nepse/market-header"
import { MarketStatusPill } from "@/components/nepse/market-status"
import { TickerTape } from "@/components/nepse/ticker-tape"
import { MarketBoard } from "@/components/nepse/market-board"
import { LiveTable } from "@/components/nepse/live-table"
import { DisclosuresFab } from "@/components/nepse/disclosures-fab"

export default function Page() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Command bar */}
      <div className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-3 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground"
            >
              Sк
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-bold tracking-tight text-foreground">
                Share <span className="text-primary">का कुरा</span> VIP
              </span>
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground sm:block">
                AI Powered · NEPSE Terminal
              </span>
            </div>
          </div>
          <MarketStatusPill />
        </header>
        <TickerTape />
      </div>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-3 py-5 sm:px-5">
        {/* Hero: brand banner fused with the live index strip */}
        <section aria-label="NEPSE index overview" className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="relative">
            <Image
              src="/images/share-ka-kura-vip-banner.jpg"
              alt="Share का कुरा VIP — AI Powered stock market analysis"
              width={851}
              height={315}
              priority
              className="h-32 w-full object-cover object-[center_65%] sm:h-40 lg:h-48"
            />
            {/* Fade the banner bottom into the stats strip — kept short so it
                doesn't wash over the brand name in the lower-left */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card to-transparent"
            />
          </div>
          <MarketHeader />
        </section>

        <main className="flex flex-col gap-6">
          {/* Chart + indices inline, then the full-width Top Movers row */}
          <MarketBoard />

          <LiveTable />
        </main>

        <footer className="flex flex-col items-center gap-1 border-t border-border/60 pt-4 pb-2 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Share का कुरा VIP · Live NEPSE Data
          </p>
          <p className="text-[11px] text-muted-foreground/70 text-pretty">
            Data is provided for information only and is not investment advice. Trading hours 11:00–15:00 NPT, Mon–Fri.
          </p>
        </footer>
      </div>

      {/* Corporate disclosures live behind a floating button, off the board */}
      <DisclosuresFab />
    </div>
  )
}
