// Mirror of apps/mobile/src/clients/api-client.interface.ts.
// When the API client contract stabilises, move this to @chatofy/sdk (YAGNI — not yet).
export interface IApiClient {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}
