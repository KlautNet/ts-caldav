import { AuthOptions } from "./models";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

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

class HttpClient {
  private authHeader: string;

  constructor(
    private baseUrl: string,
    auth: AuthOptions,
    private rejectUnauthorized: boolean = true,
    private extraHeaders: Record<string, string> = {},
  ) {
    this.authHeader =
      auth.type === "basic"
        ? `Basic ${btoa(`${auth.username}:${auth.password}`)}`
        : `Bearer ${auth.accessToken}`;
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
    const response = await fetch(requestUrl, {
      method,
      redirect,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Authorization: this.authHeader,
        ...this.extraHeaders,
        ...headers,
      },
      body: data,
    });

    const text = await response.text();
    const headersObj: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersObj[key] = value;
    });

    const effectiveValidate =
      validateStatus ?? ((s: number) => s >= 200 && s < 300);
    if (!effectiveValidate(response.status)) {
      throw new HttpError(response.status, `HTTP ${response.status}`);
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
