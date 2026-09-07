interface PagesContext {
  request: Request;
  params: { path?: string | string[] };
}

// Proxy through a same-origin path so the site's existing CSP remains valid.
export const onRequest = async ({ request, params }: PagesContext) => {
  const pathValue = Array.isArray(params.path) ? params.path.join("/") : params.path;
  const incoming = new URL(request.url);
  const requestedPath = pathValue ?? "";
  const apiPath = requestedPath.startsWith("api/")
    ? requestedPath
    : `api/${requestedPath}`;
  const upstream = new URL(`https://modeladmin.tokenixs.com/${apiPath}`);
  upstream.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  const response = await fetch(new Request(upstream, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  }));
  const outputHeaders = new Headers(response.headers);
  outputHeaders.delete("content-encoding");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outputHeaders });
};
