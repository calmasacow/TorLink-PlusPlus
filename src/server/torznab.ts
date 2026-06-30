import type { SourceId, TorrentResult } from "../sources/types";

const CAPS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server version="1.0" title="torlink" />
  <searching>
    <search available="yes" supportedParams="q" />
    <tv-search available="yes" supportedParams="q,season,ep" />
    <movie-search available="yes" supportedParams="q" />
  </searching>
  <categories>
    <category id="2000" name="Movies">
      <subcat id="2030" name="SD"/>
      <subcat id="2040" name="HD"/>
      <subcat id="2045" name="UHD"/>
    </category>
    <category id="5000" name="TV">
      <subcat id="5030" name="SD"/>
      <subcat id="5040" name="HD"/>
      <subcat id="5045" name="UHD"/>
      <subcat id="5070" name="Anime"/>
    </category>
  </categories>
</caps>`;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface DownloadIdData {
  source: SourceId;
  infoHash: string;
  magnet: string;
}

function encodeId(result: TorrentResult): string {
  const data: DownloadIdData = {
    source: result.source,
    infoHash: result.infoHash,
    magnet: result.magnet,
  };
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

function decodeId(id: string): DownloadIdData | null {
  try {
    const decoded = Buffer.from(id, "base64url").toString("utf8");
    const data = JSON.parse(decoded) as unknown;
    if (
      !data ||
      typeof data !== "object" ||
      !('source' in data) ||
      !('infoHash' in data) ||
      !('magnet' in data) ||
      typeof data.source !== 'string' ||
      typeof data.infoHash !== 'string' ||
      typeof data.magnet !== 'string'
    ) {
      return null;
    }
    return data as DownloadIdData;
  } catch {
    return null;
  }
}

function resultToXmlItem(result: TorrentResult, searchType: string, baseUrl: string): string {
  let catId = 2000; // Default category
  
  // Anime sources
  if (result.source === "subsplease" || result.source === "nyaa") {
    catId = 5070;
  }
  // TV searches
  else if (searchType === "tvsearch") {
    catId = result.sizeBytes > 8_589_934_592 ? 5045 : // >8GB = UHD
            result.sizeBytes > 3_221_225_472 ? 5040 : // >3GB = HD
            5000; // Default TV
  }
  // Movie searches
  else if (searchType === "movie") {
    catId = result.sizeBytes > 8_589_934_592 ? 2045 : // >8GB = UHD
            result.sizeBytes > 3_221_225_472 ? 2040 : // >3GB = HD
            2030; // Default movie
  }

  return `
    <item>
      <title>${escapeXml(result.name)}</title>
      <category>${catId}</category>
      <size>${result.sizeBytes}</size>
      <pubDate>${new Date((result.added ?? 0) * 1000).toUTCString()}</pubDate>
      <link>${escapeXml(`${baseUrl}/api?t=download&id=${encodeId(result)}`)}</link>
      <guid isPermaLink="false">urn:btih:${result.infoHash.toLowerCase()}</guid>
      <torznab:attr name="seeders" value="${result.seeders}"/>
      <torznab:attr name="peers" value="${result.leechers}"/>
      <torznab:attr name="infohash" value="${result.infoHash.toLowerCase()}"/>
      <torznab:attr name="magneturl" value="${escapeXml(result.magnet)}"/>
    </item>`.trim();
}

function resultsToXml(
  query: string,
  results: TorrentResult[],
  t: "search" | "movie" | "tvsearch" = "search",
  baseUrl = "http://localhost:9117"
): string {
  const selfUrl = `${baseUrl}/api?t=${t}&q=${encodeURIComponent(query)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:torznab="http://torznab.com/schemas/2015/feed" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
  <channel>
    <title>torlink ${t} results for "${escapeXml(query)}"</title>
    <description>torlink ${t} results</description>
    <link>${escapeXml(baseUrl)}</link>
    <language>en-us</language>
    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/> 
    <newznab:response offset="0" total="${results.length}"/>
    ${results.map(r => resultToXmlItem(r, t, baseUrl)).join("\n")}
  </channel>
</rss>`;
}

export { CAPS_XML, encodeId, decodeId, resultsToXml, escapeXml };
