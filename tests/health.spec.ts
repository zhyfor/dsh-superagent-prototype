/** Runtime health reporting: per-component error states and recovery on subsequent success. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Commands } from '../src/infra/commands.ts'
import { feishu, startRuntime, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startRuntime() })
afterEach(async () => { await h.stop() })

/** The Thread whose assessment Session every effect in this file targets. */
const THREAD = 'test:main'
/** Advance fake `Date.now()` by `ms` and pump due runtime work. */
async function at(ms: number) {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + ms })
  try { await h.runtime.pump(); await h.runtime.idle() } finally { vi.useRealTimers() }
}
/** Retry a failed effect until it failed three times, after which its kind reports an error. */
async function failThrice() { await at(2000); await at(6000) }

it('reports a relay in error once it failed three times, clears it once the relay reached its Thread\'s assessment Session, and leaves the runtime ready', async () => {
  const steer = h.agents.get(h.runtime.masterId)!.steer
  for (let count = 0; count < 3; count++) steer.mockImplementationOnce(() => { throw new Error('session busy') })
  h.runtime.sessions.relay('r1', JSON.stringify({ kind: 'note' }), THREAD)
  await h.runtime.idle()
  expect(h.runtime.health.relay).toMatchObject({ state: 'ready', detail: expect.stringContaining('1 waiting') })
  await failThrice()
  expect(h.runtime.health.relay).toMatchObject({ state: 'error', detail: expect.stringContaining('session busy') })
  await at(14_000)
  expect(h.runtime.health).toMatchObject({ relay: { state: 'ready', detail: 'Nothing waiting' }, runtime: { state: 'ready' } })
})

it('keeps a failing relay\'s error while replies recover, and a failing reply\'s error while relays recover', async () => {
  const assessor = h.agents.get(h.runtime.masterId)!
  const lark = vi.mocked(Commands.prototype.lark)
  const reply = (id: string) => { h.runtime.outbox.send({ id, channel: feishu('9', 'x').channel!, text: '已合并。', kind: 'notice' }) }
  assessor.steer.mockImplementation(() => { throw new Error('assessor gone') })
  h.runtime.sessions.relay('r2', JSON.stringify({ kind: 'note' }), THREAD)
  lark.mockRejectedValue(new Error('internal error (2200)'))
  reply('stuck')
  // Each fails three times in a row: the relay after 0, 2 and 6 seconds, the reply after 0, 5 and 15.
  await h.runtime.idle(); await at(5000); await at(15_000)
  expect(h.runtime.health).toMatchObject({ relay: { state: 'error' }, reply: { state: 'error', detail: expect.stringContaining('2200') } })
  lark.mockResolvedValue({})
  await at(35_000)
  expect(h.runtime.health).toMatchObject({ relay: { state: 'error' }, reply: { state: 'ready' } })
  lark.mockRejectedValue(new Error('internal error (2200)'))
  reply('stuck-2')
  assessor.steer.mockImplementation(() => {})
  await h.runtime.idle(); await at(50_000); await at(70_000)
  expect(h.runtime.health).toMatchObject({ relay: { state: 'ready' }, reply: { state: 'error' }, runtime: { state: 'ready' } })
})

it('reports a notice an assessment Session did not receive three times, until one reaches it, and injects each notice once', async () => {
  const inject = h.agents.get(h.runtime.masterId)!.inject
  const notice = (paused: boolean) => ({ settings_saved: 'pause', changed: ['paused'], paused, read: 'settings/pause' })
  for (let count = 0; count < 3; count++) inject.mockImplementationOnce(() => { throw new Error('session busy') })
  h.runtime.sessions.notify('settings:pause', notice(true), 'Settings saved: pause', THREAD)
  await h.runtime.idle()
  await failThrice()
  expect(h.runtime.health.notice).toMatchObject({ state: 'error', detail: expect.stringContaining('session busy') })
  inject.mockClear()
  // The waiting pause notice is updated in place by the resume value and injected once.
  h.runtime.sessions.notify('settings:pause', notice(false), 'Settings saved: pause', THREAD)
  await h.runtime.idle()
  expect(h.runtime.health).toMatchObject({ notice: { state: 'ready' }, runtime: { state: 'ready' } })
  expect(inject).toHaveBeenCalledOnce()
})
