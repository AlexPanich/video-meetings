import { Video } from '@gravity-ui/icons'
import { Card } from '@heroui/react'
import Link from 'next/link'
import type { ReactNode } from 'react'

interface AuthShellProps {
  title: string
  description: string
  children: ReactNode
  footer: ReactNode
}

export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 size-[28rem] rounded-full bg-accent/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -bottom-40 size-[28rem] rounded-full bg-purple-500/20 blur-3xl"
      />

      <div className="relative flex w-full max-w-md flex-col items-center gap-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-lg">
            <Video className="size-6" />
          </span>
          <span className="text-xl font-semibold tracking-tight">Video Meetings</span>
        </Link>

        <Card className="w-full gap-6 border border-border p-6 shadow-xl sm:p-8">
          <Card.Header className="gap-1.5">
            <Card.Title className="text-2xl">{title}</Card.Title>
            <Card.Description>{description}</Card.Description>
          </Card.Header>
          <Card.Content>{children}</Card.Content>
          <Card.Footer className="justify-center pt-2 text-sm text-muted">{footer}</Card.Footer>
        </Card>
      </div>
    </main>
  )
}
