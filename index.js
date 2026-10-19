'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

const DEFAULTS = {
  maxPages: 100,
  maxDepth: 3,
  timeout: 5000,
  maxBytes: 1_000_000,
  userAgent: 'LightweightCrawler/1.0',
};

function normalizeURL(input) {
  const url = new URL(input);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported');
  }

  if (url.username || url.password) {
    throw new Error('URLs containing credentials are not allowed');
  }

  url.hash = '';

  return url;
}

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);

  if (parts.length !== 4) return true;

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0)
  );
}

function isPrivateIPv6(ip) {
  const address = ip.toLowerCase();

  return (
    address === '::' ||
    address === '::1' ||
    address.startsWith('fc') ||
    address.startsWith('fd') ||
    /^fe[89ab]/.test(address) ||
    address.startsWith('ff') ||
    address.startsWith('::ffff:')
  );
}

async function assertPublicHost(hostname) {
  // Reject local hostnames and common internal naming patterns.
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('Local hostnames are not allowed');
  }

  const ipVersion = net.isIP(hostname);

  if (ipVersion === 4) {
    if (isPrivateIPv4(hostname)) {
      throw new Error('Private IPv4 addresses are not allowed');
    }

    return;
  }

  if (ipVersion === 6) {
    if (isPrivateIPv6(hostname)) {
      throw new Error('Private IPv6 addresses are not allowed');
    }

    return;
  }

  const addresses = await dns.lookup(hostname, {
    all: true,
    verbatim: true,
  });

  if (!addresses.length) {
    throw new Error('Hostname did not resolve');
  }

  // Reject mixed public/private DNS results as well.
  for (const entry of addresses) {
    if (
      entry.family === 4
        ? isPrivateIPv4(entry.address)
        : isPrivateIPv6(entry.address)
    ) {
      throw new Error('Hostname resolves to a restricted IP address');
    }
  }
}

function extractLinks(html, pageURL) {
  const links = new Set();

  // Lightweight HTML href extraction without an HTML parser.
  // Handles ordinary quoted href attributes.
  const pattern =
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

  for (const match of html.matchAll(pattern)) {
    const href = match[1] ?? match[2] ?? match[3];

    if (!href) continue;

    try {
      const target = new URL(href, pageURL);

      if (!['http:', 'https:'].includes(target.protocol)) {
        continue;
      }

      if (target.origin !== pageURL.origin) {
        continue;
      }

      target.hash = '';

      // Ignore common non-page resources.
      if (
        /\.(?:png|jpe?g|gif|svg|webp|ico|css|js|pdf|zip|mp[34])$/i
          .test(target.pathname)
      ) {
        continue;
      }

      links.add(target.href);
    } catch {
      // Ignore malformed links.
    }
  }

  return [...links];
}

async function fetchHTML(url, options) {
  await assertPublicHost(url.hostname);

  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(options.timeout),
    headers: {
      'user-agent': options.userAgent,
      accept: 'text/html,application/xhtml+xml',
    },
  });

  // Redirects are handled manually so every destination is validated.
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');

    if (!location) {
      throw new Error('Redirect has no Location header');
    }

    const nextURL = normalizeURL(new URL(location, url).href);

    if (nextURL.origin !== url.origin) {
      throw new Error('Cross-origin redirects are not allowed');
    }

    await response.body?.cancel();

    // Follow at most five redirects.
    return fetchRedirect(nextURL, options, 1);
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';

  if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
    await response.body?.cancel();
    throw new Error('Response is not HTML');
  }

  const declaredSize = Number(
    response.headers.get('content-length') || 0
  );

  if (declaredSize > options.maxBytes) {
    await response.body?.cancel();
    throw new Error('Response exceeds the configured size limit');
  }

  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      total += value.byteLength;

      if (total > options.maxBytes) {
        throw new Error('Response exceeds the configured size limit');
      }

      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }

  const buffer = Buffer.concat(chunks, total);

  return new TextDecoder('utf-8').decode(buffer);
}

async function fetchRedirect(url, options, redirects) {
  if (redirects > 5) {
    throw new Error('Too many redirects');
  }

  await assertPublicHost(url.hostname);

  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(options.timeout),
    headers: {
      'user-agent': options.userAgent,
      accept: 'text/html,application/xhtml+xml',
    },
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');

    if (!location) {
      await response.body?.cancel();
      throw new Error('Redirect has no Location header');
    }

    const nextURL = normalizeURL(new URL(location, url).href);

    if (nextURL.origin !== url.origin) {
      await response.body?.cancel();
      throw new Error('Cross-origin redirects are not allowed');
    }

    await response.body?.cancel();

    return fetchRedirect(nextURL, options, redirects + 1);
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';

  if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
    await response.body?.cancel();
    throw new Error('Response is not HTML');
  }

  const declaredSize = Number(
    response.headers.get('content-length') || 0
  );

  if (declaredSize > options.maxBytes) {
    await response.body?.cancel();
    throw new Error('Response exceeds the configured size limit');
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      total += value.byteLength;

      if (total > options.maxBytes) {
        throw new Error('Response exceeds the configured size limit');
      }

      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }

  return new TextDecoder('utf-8').decode(
    Buffer.concat(chunks, total)
  );
}

async function scanWebsiteURLs(input, config = {}) {
  const options = { ...DEFAULTS, ...config };

  for (const key of ['maxPages', 'maxDepth', 'timeout', 'maxBytes']) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1) {
      throw new TypeError(`${key} must be a positive integer`);
    }
  }

  const startURL = normalizeURL(
    /^[a-z][a-z\d+.-]*:\/\//i.test(input)
      ? input
      : `https://${input}`
  );

  const origin = startURL.origin;
  const visited = new Set();
  const results = [];
  const queue = [{ url: startURL.href, depth: 0 }];

  while (queue.length && visited.size < options.maxPages) {
    const current = queue.shift();

    if (visited.has(current.url)) continue;

    visited.add(current.url);

    try {
      const url = normalizeURL(current.url);

      if (url.origin !== origin) continue;

      const html = await fetchHTML(url, options);
      results.push(url.href);

      if (current.depth >= options.maxDepth) continue;

      for (const link of extractLinks(html, url)) {
        if (!visited.has(link)) {
          queue.push({
            url: link,
            depth: current.depth + 1,
          });
        }
      }
    } catch (error) {
      // Failed pages do not terminate the entire crawl.
      if (options.onError) {
        options.onError(error, current.url);
      }
    }
  }

  return results;
}

module.exports = scanWebsiteURLs;
