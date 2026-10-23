export type CalDAVErrorOptions = ErrorOptions & {
  responseBody?: string;
  /** Local name of the precondition element in a `DAV:error` body. */
  precondition?: string;
};

export class CalDAVError extends Error {
  public readonly responseBody?: string;
  public readonly precondition?: string;

  constructor(
    message: string,
    public readonly status?: number,
    options?: CalDAVErrorOptions,
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CalDAVError";
    if (options?.responseBody !== undefined) this.responseBody = options.responseBody;
    if (options?.precondition !== undefined) this.precondition = options.precondition;
  }

  /** Wraps `cause`, keeping its status, response body and precondition. */
  static wrap(message: string, cause: unknown, status?: number): CalDAVError {
    const inner = cause instanceof CalDAVError ? cause : undefined;
    return new CalDAVError(message, status ?? inner?.status, {
      cause,
      responseBody: inner?.responseBody,
      precondition: inner?.precondition,
    });
  }
}
