# Website Route Scanner

A lightweight, dependency-free website crawler for discovering internal URLs. Built with native Node.js APIs to keep installation simple and minimize external dependencies.

## Features

- Internal link discovery — finds links within the target website.
- Configurable crawling — set page limits and maximum crawl depth.
- URL normalization — resolves relative URLs and removes fragments.
- Request timeouts — prevents requests from hanging indefinitely.
- Response size limits — restricts HTML downloaded per page.
- Error handling — allows failed requests to be handled through a callback.
- CommonJS support — easy integration with existing Node.js projects.

## Requirements

- Node.js 20 or later.
- Network access to the target website.
- Permission to crawl the target website.

## Installation

Install the package using npm:
```bash
npm install website-route-scanner
```

No additional runtime dependencies are required.

#### Quick Start
```js
const scanWebsiteURLs = require('website-route-scanner');

async function main() {
  try {
    const urls = await scanWebsiteURLs('https://example.com');

    console.log(urls);
  } catch (error) {
    console.error('Crawler failed:', error.message);
  }
}

main();
```

Example Output
```bash
[
  'https://example.com/',
  'https://example.com/about',
  'https://example.com/contact'
]
```

The returned URLs depend on the links available on the target website.

## Configuration

You can customize the crawling behavior by passing an options object.
```js
const scanWebsiteURLs = require('website-route-scanner');

async function main() {
  const urls = await scanWebsiteURLs('https://example.com', {
    maxPages: 50,
    maxDepth: 3,
    timeout: 5000,
    maxBytes: 500000,

    onError(error, url) {
      console.error(`Failed to scan ${url}: ${error.message}`);
    }
  });

  console.log(`Discovered ${urls.length} pages`);
}

main().catch(console.error);
```
## Available Options

| Option | Default | Description |
| -- | -- | -- |
|"maxPages"| "100"| Maximum number of pages visited.|
|"maxDepth"| "3"| Maximum link depth from the starting URL.|
|"timeout"| "5000"| Request timeout in milliseconds.|
|"maxBytes"| "1000000"| Maximum HTML response size in bytes.|
|"userAgent"| "LightweightCrawler/1.0"| User-Agent sent with requests.|
|"onError"| None| Optional callback receiving "(error, url)" for failed pages.|

### API Reference

"scanWebsiteURLs(url, options?)`

Scans a website and returns the URLs of successfully fetched HTML pages.

#### Parameters

- "url" ("string"): Starting website URL, such as "https://example.com".
- "options" ("object", optional): Configuration options for the crawler.

#### Returns

"Promise<string[]>" — a promise resolving to an array of successfully scanned page URLs.

##### Example

const urls = await scanWebsiteURLs('example.com', {
  maxPages: 25
});

If no protocol is specified, the crawler starts with HTTPS.

### Error Handling

Use "try...catch" to handle errors that prevent the crawler from starting, such as invalid input.

Individual page failures are skipped. You can monitor them using "onError".
```js
scanWebsiteURLs('https://example.com', {
  onError(error, url) {
    console.error({
      url,
      message: error.message
    });
  }
}).catch(console.error);
```
## Security and Responsible Use

- Crawl only websites you own or have permission to inspect.
- Respect the target website's "robots.txt" rules and applicable policies.
- Avoid excessive requests that could affect website availability.
- Use page limits and timeouts to control resource consumption.
- Do not treat the crawler as a substitute for a dedicated security scanner.
- For production deployments, enforce SSRF protections at the network connection level.

## Limitations

- Discovers links present in the downloaded HTML.
- Does not execute JavaScript or discover routes rendered exclusively by client-side applications.
- Does not guarantee discovery of every route.
- Does not currently provide concurrent crawling.
- URL query parameters may produce distinct entries.
- HTML extraction is lightweight and may not handle every malformed HTML document.

## Development

Clone the repository:

```bash
git clone https://github.com/caotrongtin99/route-scanner.git
cd route-scanner
```

Install dependencies if required by development tools:
```bash
npm install
```

Run the test suite:
```bash
npm test
```

# License

This project is distributed under the license specified in the repository's "LICENSE" file.


# Repository

GitHub: https://github.com/caotrongtin99/route-scanner
