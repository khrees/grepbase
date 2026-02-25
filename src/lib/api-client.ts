/**
 * API client for communicating with the backend API
 *
 * In monolithic mode (default), calls Next.js API routes on the same origin.
 * For separate backend deployment, set NEXT_PUBLIC_API_URL environment variable.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
const CSRF_HEADER_NAME = 'x-grepbase-csrf';
const CSRF_HEADER_VALUE = '1';

export interface APIError {
  error: string;
  details?: unknown;
}

export class APIClient {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  private async request<T>(
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.baseURL}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({
        error: `HTTP ${response.status}: ${response.statusText}`,
      })) as Record<string, unknown>;
      const err = body?.error;
      const errorMessage =
        (typeof err === 'string' && err) ||
        (typeof err === 'object' && err !== null && 'message' in err && typeof (err as Record<string, unknown>).message === 'string' && (err as Record<string, unknown>).message) ||
        (typeof body?.message === 'string' && body.message) ||
        `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(errorMessage as string);
    }

    return response.json();
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: {
        [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      headers: {
        [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, {
      method: 'DELETE',
      headers: {
        [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE,
      },
    });
  }

  /**
   * POST request that returns a streaming response
   */
  async postStream(path: string, body?: unknown, options?: RequestInit): Promise<Response> {
    const url = `${this.baseURL}${path}`;
    const { headers: optionHeaders, ...restOptions } = options || {};

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE,
        ...optionHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
      ...restOptions,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({
        error: `HTTP ${response.status}: ${response.statusText}`,
      })) as Record<string, unknown>;
      const err = body?.error;
      const errorMessage =
        (typeof err === 'string' && err) ||
        (typeof err === 'object' && err !== null && 'message' in err && typeof (err as Record<string, unknown>).message === 'string' && (err as Record<string, unknown>).message) ||
        (typeof body?.message === 'string' && body.message) ||
        `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(errorMessage as string);
    }

    return response;
  }
}

// Export singleton instance
export const apiClient = new APIClient();

// Export convenience methods
export const api = {
  get: <T>(path: string) => apiClient.get<T>(path),
  post: <T>(path: string, body?: unknown) => apiClient.post<T>(path, body),
  put: <T>(path: string, body?: unknown) => apiClient.put<T>(path, body),
  delete: <T>(path: string) => apiClient.delete<T>(path),
  postStream: (path: string, body?: unknown, options?: RequestInit) => apiClient.postStream(path, body, options),
};
