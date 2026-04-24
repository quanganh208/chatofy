// IApiClient — contract for all HTTP interactions.
// Swap FetchApiClient for axios/ky adapter without touching callers.
export interface IApiClient {
  /** Low-level request — callers prefer get/post helpers */
  request<T>(path: string, init?: RequestInit): Promise<T>;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}
