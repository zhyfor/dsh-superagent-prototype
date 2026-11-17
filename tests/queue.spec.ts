/** Effect queue migration and notice deduplication on the Runtime. */
import { afterEach, expect, it, vi } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })
const text = (message: unknown) => JSON.parse((message as { content: { text: string }[] }).content[0]!.text) as Record<string, unknown>
const notices = (host: Host) => host.agents.get(host.runtime.masterId)!.inject.mock.calls.map(([message]) => text(message))

it('migrates a version before the effect queue without waking a Session for records that name no Thread', async () => {
  h = await startRuntime(store => {
    // A schema 10 database, which the schema 11 migration brings up to date when the Runtime opens it.
    store.set('schema', 10)
    store.set('relay-queue', [{ id: 'report:old', text: JSON.stringify({ kind: 'worker_report', ticket_id: 't1', state: 'ready' }) }])
    store.set('subscription-results', ['github:7'])
    store.set('prompt-notification', 3)
    store.set('settings-notification', 5)
  })
  await h.runtime.idle()
  // Legacy records carry no Thread, so they are recorded and cleared, never injected into or steered to a guessed Session.
  expect(h.agents.get(h.runtime.masterId)!.steer.mock.calls).toEqual([])
  expect(notices(h)).toEqual([])
  for (const name of ['relay-queue', 'subscription-results', 'prompt-notification', 'settings-notification']) expect(h.runtime.store.get(name)).toBeUndefined()
  expect(h.runtime.effects.pending('relay') || h.runtime.effects.pending('notice')).toBe(false)
})

it('keeps only the latest targeted notice while an assessment Session cannot take one', async () => {
  h = await startRuntime()
  const inject = h.agents.get(h.runtime.masterId)!.inject
  inject.mockImplementation(() => { throw new Error('session busy') })
  h.runtime.sessions.notify('settings:pause', { settings_saved: 'pause', changed: ['paused'], paused: true, read: 'settings/pause' },
    'Settings saved: pause', 'test:main')
  h.runtime.sessions.notify('settings:pause', { settings_saved: 'pause', changed: ['paused'], paused: false, read: 'settings/pause' },
    'Settings saved: pause', 'test:main')
  await h.runtime.idle()
  expect(h.runtime.effects.pending('notice', 'settings:pause')).toBe(true)
  inject.mockReset()
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 2000 })
  try { await h.runtime.pump(); await h.runtime.idle() } finally { vi.useRealTimers() }
  expect(notices(h)).toEqual([{ settings_saved: 'pause', changed: ['paused'], paused: false, read: 'settings/pause' }])
})
