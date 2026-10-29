import { Video } from '@gravity-ui/icons'
import { HomeActions } from '@/components/home-actions'

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 overflow-hidden px-4 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 size-[32rem] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl"
      />
      <span className="relative flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-lg">
        <Video className="size-7" />
      </span>
      <h1 className="relative text-4xl font-semibold tracking-tight">Video Meetings</h1>
      <p className="relative max-w-md text-muted">
        Видеовстречи для вашей команды — просто и быстро.
      </p>
      <div className="relative">
        <HomeActions />
      </div>
    </main>
  )
}
