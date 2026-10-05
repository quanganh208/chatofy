# System Architecture

The architecture is split by topic into [`docs/architecture/`](./architecture/). This
page is the index: code comments and other docs cite `docs/system-architecture.md` by
name, so every section they mention is listed below with the file it now lives in.

| Topic                                                                          | Sections                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Contracts, Envelope and Languages](./architecture/contracts-and-languages.md) | Type Contract Standard · Response Envelope Architecture · Languages (what a turn decides, LID and audio-based detection, sidecar language reporting, legacy wire fields, deferred seams, the add-a-language checklist) |
| [AI Provider Abstraction](./architecture/ai-providers.md)                      | Speech backend routing · Speech gate · Per-turn speaker attribution · Meeting minutes · History search · Where conversation text lives · Conversation recordings                                                       |
| [Authentication](./architecture/authentication.md)                             | Tokens (access/refresh lifetimes, cookie session) · Guard registration · WebSocket auth · Google account linking · Registration · Mail · Test substrate · Avatar storage (and the R2 bucket layout)                    |
| [Data Flow](./architecture/data-flow.md)                                       | `POST /translate` pipeline · Streaming turn (`/ws/translate`) · Live mode on the same socket · AI context and hints · Standard request/response                                                                        |
| [Modules, Browser Extension and CI/CD](./architecture/modules-extension-ci.md) | API module organization · Browser extension path · CI/CD                                                                                                                                                               |

Planned work that is **not implemented** — video meetings — is described separately in
[`video-conferencing-architecture.md`](./video-conferencing-architecture.md) and tracked
in [`project-roadmap.md`](./project-roadmap.md).

## Browser extension path

Moved to [Modules, Browser Extension and CI/CD → Browser extension path](./architecture/modules-extension-ci.md#browser-extension-path).

### Checklist: adding a language to the registry

Moved to [Contracts, Envelope and Languages → Checklist](./architecture/contracts-and-languages.md#checklist-adding-a-language-to-the-registry).
