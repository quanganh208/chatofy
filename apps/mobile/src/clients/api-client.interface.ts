// Interface for all HTTP API clients — swap fetch for axios/ky without touching call sites
export interface IApiClient {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}
