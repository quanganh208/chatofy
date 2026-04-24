// FetchApiClient — default IApiClient backed by the global fetch API.
// Throws ApiError on non-2xx responses; always sends/expects JSON.
import type { IApiClient } from './api-client.interface';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class FetchApiClient implements IApiClient {
  constructor(private readonly baseUrl: string) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers);

    if (!headers.has('Content-Type') && init.body) {
      headers.set('Content-Type', 'application/json');
    }
    headers.set('Accept', 'application/json');

    const response = await fetch(url, { ...init, headers });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new ApiError(response.status, text);
    }

    // 204 No Content — return empty object typed as T
    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }
}
