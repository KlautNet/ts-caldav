import { CalDAVError } from "./errors";

/** Local name of the first child of a `DAV:error` root (RFC 4918 §16). */
const extractPrecondition = (body: string): string | undefined => {
  if (!body.includes("error")) return undefined;
  const match =
    /<(?:[\w.-]+:)?error(?:\s[^>]*)?>\s*<(?:[\w.-]+:)?([A-Za-z][\w.-]*)/.exec(
      body,
    );
  return match?.[1];
};
import { AuthOptions } from "./models";

type RequestOptions = {
  method: string;
  url: string;
  validateStatus?: (status: number) => boolean;
  data?: string;
  headers?: Record<string, string>;
  redirect?: RequestRedirect;
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  data: string;
  url: string;
};

// Emitted at most once per process so a broken TLS-bypass setup is loud but
// not spammy.
let tlsBypassWarningShown = false;

class HttpClient {
  private authHeader: string;
  // Lazily-built, cached undici dispatcher used to disable TLS verification
  // when `rejectUnauthorized` is false. `undefined` once resolved means the
  // current runtime can't provide one.
  private insecureDispatcher?: Promise<unknown>;

  constructor(
    private baseUrl: string,
    auth: AuthOptions,
    private rejectUnauthorized: boolean = true,
    private extraHeaders: Record<string, string> = {},
    private requestTimeout: number = 0,
    private logRequests: boolean = false,
  ) {
    this.authHeader =
      auth.type === "basic"
        ? `Basic ${btoa(`${auth.username}:${auth.password}`)}`
        : `Bearer ${auth.accessToken}`;
  }

  /**
   * Resolves an undici dispatcher that disables TLS certificate verification,
   * or `undefined` when verification should stay on or the runtime can't
   * provide one. Native `fetch` (undici) has no per-request TLS toggle, so we
   * fall back to an undici `Agent`. On runtimes without undici (browsers,
   * React Native) this warns once instead of silently ignoring the option.
   */
  private getInsecureDispatcher(): Promise<unknown> {
    if (this.rejectUnauthorized) return Promise.resolve(undefined);
    if (!this.insecureDispatcher) {
      this.insecureDispatcher = (async () => {
        try {
          // Indirect specifier so bundlers (Metro, webpack) don't try to
          // resolve undici in builds where it isn't available.
          const specifier = "undici";
          const undici = (await import(specifier)) as {
            Agent: new (opts: unknown) => unknown;
          };
          return new undici.Agent({ connect: { rejectUnauthorized: false } });
        } catch {
          if (!tlsBypassWarningShown) {
            tlsBypassWarningShown = true;
            console.warn(
              "[ts-caldav] `rejectUnauthorized: false` was set but TLS " +
                "verification could not be disabled for this runtime. Native " +
                "fetch only supports this in Node.js with the `undici` package " +
                "installed, or by setting NODE_TLS_REJECT_UNAUTHORIZED=0. " +
                "Requests to servers with self-signed certificates may fail.",
            );
          }
          return undefined;
        }
      })();
    }
    return this.insecureDispatcher;
  }

  async request({
    method,
    url,
    validateStatus,
    data,
    headers,
    redirect,
  }: RequestOptions): Promise<HttpResponse> {
    const requestUrl = new URL(url, this.baseUrl).toString();
    const controller =
      this.requestTimeout > 0 ? new AbortController() : undefined;
    const timeout =
      controller && this.requestTimeout > 0
        ? setTimeout(() => controller.abort(), this.requestTimeout)
        : undefined;

    if (this.logRequests) {
      console.debug(`[ts-caldav] ${method} ${requestUrl}`);
    }

    const dispatcher = await this.getInsecureDispatcher();

    let response: Response;
    try {
      response = await fetch(requestUrl, {
        method,
        redirect,
        signal: controller?.signal,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          Authorization: this.authHeader,
          ...this.extraHeaders,
          ...headers,
        },
        body: data,
        // `dispatcher` is an undici-specific extension not present in the
        // standard RequestInit type; only set when disabling TLS verification.
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit);
    } catch (error) {
      if (controller?.signal.aborted) {
        throw new CalDAVError(
          `Request timed out after ${this.requestTimeout}ms: ${method} ${requestUrl}`,
        );
      }
      throw new CalDAVError(
        `Request failed: ${method} ${requestUrl}`,
        undefined,
        { cause: error },
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const text = await response.text();
    const headersObj: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersObj[key] = value;
    });

    if (this.logRequests) {
      console.debug(`[ts-caldav] ${method} ${requestUrl} -> ${response.status}`);
    }

    const effectiveValidate =
      validateStatus ?? ((s: number) => s >= 200 && s < 300);
    if (!effectiveValidate(response.status)) {
      throw new CalDAVError(`HTTP ${response.status}`, response.status, {
        responseBody: text,
        precondition: extractPrecondition(text),
      });
    }

    return {
      status: response.status,
      headers: headersObj,
      data: text,
      url: response.url,
    };
  }

  async put(
    url: string,
    data: string,
    options: Omit<RequestOptions, "method" | "url" | "data">,
  ): Promise<HttpResponse> {
    return this.request({ method: "PUT", url, data, ...options });
  }

  async delete(
    url: string,
    options: Omit<RequestOptions, "method" | "url">,
  ): Promise<HttpResponse> {
    return this.request({ method: "DELETE", url, ...options });
  }
}

export default HttpClient;
