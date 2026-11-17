import { expect, it, vi } from 'vitest'
import { Config, type Machine } from '../src/deployment.ts'
import { apply } from '../src/index.ts'

// Stub Runtime to capture the resolved Machine settings and restart callback.
type RuntimeProbe = {
  machine: Machine
  restart: () => void
  ready: Promise<void>
  settleReady: () => void
  failReady: (error: Error) => void
}
const runtimes = vi.hoisted(() => [] as RuntimeProbe[])
vi.mock('../src/app/runtime.ts', () => ({ Runtime: class {
  ready: Promise<void>
  private settle!: () => void
  private fail!: (error: Error) => void
  constructor(_ctx: unknown, readonly machine: Machine, readonly restart: () => void) {
    this.ready = new Promise<void>((resolve, reject) => { this.settle = resolve; this.fail = reject })
    runtimes.push(this as RuntimeProbe)
  }
  configured() { return true }
  async stop() {}
  settleReady() { this.settle() }
  failReady(error: Error) { this.fail(error) }
} }))
/** Simulate the Cordis loader updating a volatile configuration reference in place. */
const commit = (reference: unknown, value: unknown) => { (reference as Record<symbol, (value: unknown) => void>)[Symbol.for('cosmokit.volatile.write')]!(value) }

function context() {
  const handlers = new Map<string, () => void>()
  const configure = vi.fn(() => () => {})
  const describe = vi.fn(() => [])
  const ctx = {
    on: vi.fn((name: string, handler: () => void) => { handlers.set(name, handler) }),
    inject: vi.fn((_services: string[], callback: (child: unknown) => void) => { callback({ effect: (effect: () => unknown) => effect(), settings: { configure } }) }),
    effect: vi.fn(),
    fiber: { restart: vi.fn(async () => {}) },
    get: vi.fn((name: string) => name === 'settings' ? { describe } : undefined),
    logger: { info: vi.fn(), error: vi.fn() },
    provide: vi.fn(() => () => {}),
  }
  return { ctx, handlers, configure, describe }
}

it('reads a limit DSH commits a new value of without a restart, and asks DSH to generate no settings page', async () => {
  const { ctx, handlers, configure } = context()
  const config = Config({ stateDir: '/srv/state', promptMaxChars: 5000 })
  await apply(ctx as never, config)
  expect(configure).toHaveBeenCalledExactlyOnceWith({ auto: false }, ctx.fiber)
  const { machine } = runtimes.at(-1)!
  expect(machine.promptMaxChars.get()).toBe(5000)
  commit(config.promptMaxChars, 8000)
  expect(machine.promptMaxChars.get()).toBe(8000)
  expect(handlers.has('loader/volatile-update')).toBe(false)
  expect(ctx.fiber.restart).not.toHaveBeenCalled()
})

it('asks DSH to read its settings entry again once a restart it started finished', async () => {
  const { ctx, describe } = context()
  let finish = () => {}
  ctx.fiber.restart.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  await apply(ctx as never, Config({ stateDir: '/srv/state' }))
  // Saving a Source account change restarts dsh-superagent, which re-runs setup and refreshes the settings descriptor.
  runtimes.at(-1)!.restart()
  await Promise.resolve()
  expect(describe).not.toHaveBeenCalled()
  finish()
  await vi.waitFor(() => { expect(describe).toHaveBeenCalledTimes(1) })
})

it('does not block Host row activation while runtime startup settles', async () => {
  const { ctx } = context()
  await expect(apply(ctx as never, Config({ stateDir: '/srv/state' }))).resolves.toBeUndefined()
  const probe = runtimes.at(-1)!
  probe.settleReady()
  await vi.waitFor(() => { expect(ctx.logger.info).toHaveBeenCalledTimes(1) })
})

it('records a rejected runtime startup without failing Host row activation', async () => {
  const { ctx } = context()
  await expect(apply(ctx as never, Config({ stateDir: '/srv/state' }))).resolves.toBeUndefined()
  runtimes.at(-1)!.failReady(new Error('boom'))
  await vi.waitFor(() => {
    expect(ctx.logger.error).toHaveBeenCalledWith('dsh-superagent failed to start: %s', 'Error: boom')
  })
})

it('refuses keys of the previous configuration before registering anything', async () => {
  const { ctx } = context()
  await expect(apply(ctx as never, Config({ stateDir: '/srv/state', github: { cli: 'gh' } } as never))).rejects.toThrow('github (now on the GitHub Source)')
  expect(ctx.on).not.toHaveBeenCalled()
  expect(ctx.inject).not.toHaveBeenCalled()
})
