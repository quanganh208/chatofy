import { env } from '@/config/env';
import { API_TIMEOUT_MS } from '@/config/constants';
import type { IApiClient } from './api-client.interface';

// Thrown on any non-2xx response
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Default fetch-based API client; swap for axios/ky by implementing IApiClient
export class FetchApiClient implements IApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = env.EXPO_PUBLIC_API_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...init.headers,
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new ApiError(response.status, text);
    }

    // 204 No Content — return empty object cast to T
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
