// Portable API client contract — matches apps/mobile/src/clients/api-client.interface.ts shape.
// When this pattern stabilizes, move to @chatofy/ui or a new @chatofy/sdk package.
// YAGNI — do not move yet; keep in sync manually until mobile client is finalized.

export interface IApiClient {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}
