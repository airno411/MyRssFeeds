import express from "express";
import fetch from "node-fetch";
import pkg from "fast-xml-parser";
import { create } from "xmlbuilder2";

const { XMLParser } = pkg;

const app = express();
const cache = new Map();
const CACHE_DURATION = 60 * 60 * 1000; // 1小时缓存

app.get("/", (req, res) => {
  res.send("YouTube RSS Proxy is running. Use /api/rss?channel_id=...");
});

app.get("/api/rss", async (req, res) => {
  const channelId = req.query.channel_id;
  if (!channelId) {
    return res.status(400).send("Missing channel_id parameter");
  }

  const cached = cache.get(channelId);
  const now = Date.now();
  if (cached && now - cached.timestamp < CACHE_DURATION) {
    res.type("application/rss+xml; charset=utf-8").send(cached.data);
    return;
  }

  try {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const response = await fetch(feedUrl);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

    const text = await response.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(text);

    const feed = parsed.feed;
    const channelTitle = feed.title || "YouTube Channel";
    const entries = Array.isArray(feed.entry) ? feed.entry : [feed.entry];

    const rss = create({ version: "1.0", encoding: "UTF-8" })
      .ele("rss", {
        version: "2.0",
        "xmlns:media": "http://search.yahoo.com/mrss/",
        "xmlns:atom": "http://www.w3.org/2005/Atom"
      })
      .ele("channel")
      .ele("title").txt(channelTitle).up()
      .ele("link").txt(`https://www.youtube.com/channel/${channelId}`).up()
      .ele("description").txt(`YouTube RSS feed for ${channelTitle}`).up();

    entries.forEach((video) => {
      if (!video) return;
      const videoId = video["yt:videoId"];
      const title = video.title;
      const link = video.link?.["@_href"];
      const published = video.published;
      const author = video.author?.name || feed.author?.name || "YouTube Channel";
      const description = video["media:group"]?.["media:description"] || "";
      const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      const item = rss.ele("item");
      item.ele("title").txt(title).up();
      item.ele("link").txt(link).up();
      item.ele("guid").txt(link).up();
      item.ele("author").txt(author).up();
      item.ele("pubDate").txt(new Date(published).toUTCString()).up();
      item.ele("description").dat(description).up();
      item.ele("media:thumbnail", { url: thumbnail }).up();
      item.up();
    });

    const xmlOutput = rss.end({ prettyPrint: true });
    cache.set(channelId, { data: xmlOutput, timestamp: now });

    res
      .set("Content-Type", "application/rss+xml; charset=utf-8")
      .send(xmlOutput);
  } catch (err) {
    console.error("Error generating feed:", err);
    res.status(500).send("Failed to fetch or parse feed");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
