/**
 * Where the browser (or the SSR server) should reach a backend service.
 *
 * - Explicit `NEXT_PUBLIC_*_URL` wins (inlined at build time).
 * - In the browser otherwise: the host the dashboard itself was opened at, on
 *   the service's port — so it works when browsing from another machine and
 *   not only when the browser runs on the same host as the services.
 * - On the server: `*_INTERNAL_URL` (container-to-container in docker compose),
 *   falling back to localhost.
 */
export function serviceUrl(opts: {
  explicit: string | undefined;
  port: string | undefined;
  defaultPort: number;
  internal: string | undefined;
}): string {
  const port = opts.port || String(opts.defaultPort);
  if (typeof window === "undefined") {
    return opts.internal || opts.explicit || `http://localhost:${port}`;
  }
  if (opts.explicit) return opts.explicit;
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
}
