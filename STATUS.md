# STATUS — dsh-superagent

- Updated: 2026-11-21 (panel back in the main Host)
- One line: a proactive coding agent for one GitHub repository, packaged as a DeepSeek Harness bundle. The panel at
  `/orchestrator` now loads in the profile this machine works in (`web`), not only in a separate `superagent` Host.
- Location: `dsh-superagent/`; package `dsh-superagent`; default branch `main`.
- Plan: [PLAN-sa-back-into-main-web.md](/home/zh/www/doc/archive/plans/PLAN-sa-back-into-main-web.md)

## How this machine runs it

| Item | Value |
| --- | --- |
| Host | `dsh-web.service` (`dsh web --host 127.0.0.1 --port 3080`, profile `web`) |
| Panel | `/orchestrator` on the same origin; reachable from the tailnet at `https://zh-gem-r7.tailb6e152.ts.net:8443/` with the Host's login |
| State | `stateDir: /home/zh/.dsh/state/superagent` (`orchestrator.sqlite`, lock, `worker-bin`, `worker-gitconfig`) |
| Sources | GitHub `zhyfor/dshSuperagentRepo` through `/home/zh/.local/bin/gh-agent`; Feishu through `/home/zh/www/personalCloud/task/superagent-feishu/bin/lark-bot` |
| Idle-time gate | `/home/zh/www/personalCloud/task/superagent-offpeak` pauses processing in the working hours and resumes after, calling `http://127.0.0.1:3080/orchestrator/api` |

The separate `dsh-superagent.service` (`superagent` profile, port 3082) is stopped and disabled. It stays as the rollback
path: its profile is unchanged, and only one Host may hold the `stateDir` lock, so it must not run while `dsh-web.service`
loads the bundle.

## Deployment notes

- The bundle is in `~/.dsh/profiles/web/package.json` both as a dependency (`link:`) and in `dsh.profile.bundles`.
  `dsh plugin add` writes only the dependency; a bundle missing from the list is skipped and the panel disappears
  silently (see [006 Deployment](docs/006-deployment.md)).
- `dsh-superagent-feishu` is disabled at the bundle layer and enabled in that profile's `cordis.patch.yml`.
- The Host runs with `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY`, because Node's built-in `fetch` ignores the proxy
  variables otherwise and the Feishu and GitHub CLIs cannot reach their APIs.
- Requests from `127.0.0.1` need no browser session, so local jobs such as the idle-time gate work while the Host also
  serves a public origin; the `x-orchestrator-request: 1` header is still required.

## Verification

- `pnpm check` (typecheck, 1221 tests, build) passes.
- Panel tabs 概览 / 来源 / 触发 / 评估 / 执行 / 设置 render; Sources resolves the GitHub account and the Feishu bot.
- `superagent-offpeak status` reaches the management API after the Host restart that loads the loopback exemption.

## Open items

- The Eval and Execution models are unset in the panel, so both roles inherit the Host default
  (`deepseek-account` / `deepseek-flash`, reasoning effort `low`). Before the move they ran on
  `deepseek-official` / `deepseek-flash` with reasoning effort off. Set them explicitly if background work must keep
  using no reasoning tokens or a specific billing channel.
- `package.json` declares `engines.dsh ^0.2.1-alpha.2` while this machine runs a newer release; installs work, and
  widening the range is a separate decision.
