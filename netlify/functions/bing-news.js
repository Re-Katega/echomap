const allowedFreshnessWindows = new Set([
  'interval="7"',
  'interval="30"',
  'interval="365"'
]);

exports.handler = async event => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { Allow: "GET", "Content-Type": "text/plain; charset=utf-8" },
      body: "Method not allowed."
    };
  }

  const query = event.queryStringParameters || {};
  const searchTerm = typeof query.q === "string" ? query.q.trim() : "";
  const freshness = query.qft;
  if (!searchTerm || searchTerm.length > 300 || (freshness && !allowedFreshnessWindows.has(freshness))) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Invalid news search request."
    };
  }

  const upstreamUrl = new URL("https://www.bing.com/news/search");
  upstreamUrl.searchParams.set("q", searchTerm);
  upstreamUrl.searchParams.set("format", "rss");
  upstreamUrl.searchParams.set("mkt", "en-US");
  if (freshness) upstreamUrl.searchParams.set("qft", freshness);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(upstreamUrl, {
      headers: { Accept: "application/rss+xml, application/xml;q=0.9" },
      signal: controller.signal
    });
    const body = await response.text();

    return {
      statusCode: response.ok ? 200 : 502,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": response.headers.get("content-type") || "application/xml; charset=utf-8"
      },
      body: response.ok ? body : `Bing News search returned HTTP ${response.status}.`
    };
  } catch (error) {
    console.error("Bing News proxy request failed:", error);
    return {
      statusCode: 502,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      body: error.name === "AbortError"
        ? "Bing News request timed out. Please try again."
        : "Could not reach Bing News. Please try again."
    };
  } finally {
    clearTimeout(timeout);
  }
};
