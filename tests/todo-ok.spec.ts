import { describe, expect, it, vi } from 'vitest'
import { assessSessionId } from '../src/app/session-policy.ts'
import { handleFeishuOk, isFeishuOk, receiveFeishu } from '../src/sources/feishu-loops.ts'
import type { Ticket, Trigger } from '../src/core/index.ts'
import type { SourceContext } from '../src/sources/host.ts'

const thread = { source: 'feishu', id: 'topic-1' }
const trigger = (text: string, human = true) => ({
  id: `trigger-${text}`,
  source: 'feishu',
  threads: [thread],
  actor: { id: 'ou_alice', name: 'Alice' },
  human,
  at: new Date().toISOString(),
  text,
  channel: { source: 'feishu', thread: 'feishu:topic-1', address: { chatId: 'oc_team' } },
  meta: {},
}) as unknown as Trigger
const ticket = (id: string, title: string, triggerId: string) => ({ id, title, origin: { triggerId } }) as unknown as Ticket

function context(tickets: Ticket[] = [], origins: Record<string, Trigger> = {}) {
  const ctx = {
    receive: vi.fn(async () => ({})),
    notify: vi.fn(),
    state: { get: () => undefined, set: () => {} },
    threads: { describe: vi.fn() },
    tickets: { open: () => tickets, stop: vi.fn() },
    triggers: { get: (id: string) => origins[id] },
    sessions: { rename: vi.fn(async () => {}), archive: vi.fn(async () => {}) },
  }
  return ctx as unknown as SourceContext & typeof ctx
}

describe('Feishu /ok', () => {
  it('recognizes only a human, standalone, case-insensitive /ok', () => {
    expect(isFeishuOk(trigger('/ok'))).toBe(true)
    expect(isFeishuOk(trigger('  /OK  '))).toBe(true)
    expect(isFeishuOk(trigger('/ok', false))).toBe(false)
    expect(isFeishuOk(trigger('/ok please'))).toBe(false)
  })

  it('stops matching tickets, restores worker titles, archives worker and assess sessions, then replies', async () => {
    const first = ticket('ticket-1', '修复登录', 'trigger-1')
    const second = ticket('ticket-2', '补充测试', 'trigger-2')
    const ctx = context([first, second], {
      'trigger-1': trigger('需求一'),
      'trigger-2': trigger('需求二'),
    })

    await handleFeishuOk(ctx, trigger('/ok'))

    expect(ctx.tickets.stop.mock.calls).toEqual([['ticket-1', 'humanOk'], ['ticket-2', 'humanOk']])
    expect(ctx.sessions.rename.mock.calls).toEqual([['worker-ticket-1', '修复登录'], ['worker-ticket-2', '补充测试']])
    expect(ctx.sessions.archive.mock.calls).toEqual([
      ['worker-ticket-1'], ['worker-ticket-2'], [assessSessionId('feishu:topic-1')],
    ])
    expect(ctx.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'reply', text: expect.stringContaining('2 个') }))
    expect(ctx.receive).not.toHaveBeenCalled()
  })

  it('replies without stopping anything when no ticket matches the thread', async () => {
    const ctx = context([ticket('ticket-1', '其它话题', 'trigger-other')], {
      'trigger-other': { ...trigger('其它'), threads: [{ source: 'feishu', id: 'topic-other' }] },
    })

    await handleFeishuOk(ctx, trigger('/ok'))

    expect(ctx.tickets.stop).not.toHaveBeenCalled()
    expect(ctx.sessions.rename).not.toHaveBeenCalled()
    expect(ctx.sessions.archive.mock.calls).toEqual([[assessSessionId('feishu:topic-1')]])
    expect(ctx.notify).toHaveBeenCalledWith(expect.objectContaining({ text: '当前没有进行中的任务。' }))
  })

  it('never forwards /ok to Engine intake but forwards ordinary text', async () => {
    const ctx = context()
    await receiveFeishu(ctx, trigger('/ok'))
    expect(ctx.receive).not.toHaveBeenCalled()
    await receiveFeishu(ctx, trigger('帮我修一下'))
    expect(ctx.receive).toHaveBeenCalledTimes(1)
  })
})
