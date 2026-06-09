// [bot.mjs] MoaReview trend collector.
// Cafe, community, and media feeds use each site's own official hot list order,
// then rank candidates by engagement.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(SCRIPT_DIR, ".env"));

const DEFAULT_FIREBASE_DB_URL =
  "https://chosanghee00001-default-rtdb.firebaseio.com/categories.json";

const MAX_ITEMS = toPositiveInt(process.env.MAX_ITEMS_PER_CATEGORY, 10);
const SOURCE_ITEM_LIMIT = toPositiveInt(process.env.SOURCE_ITEM_LIMIT, 20);
const TWITCH_SOURCE_ITEM_LIMIT = toPositiveInt(process.env.TWITCH_SOURCE_ITEM_LIMIT, 100);
const TWITCH_MIN_ITEMS_PER_MEDIA_FEED = toPositiveInt(process.env.TWITCH_MIN_ITEMS_PER_MEDIA_FEED, 3);
const YOUTUBE_SOURCE_ITEM_LIMIT = toPositiveInt(process.env.YOUTUBE_SOURCE_ITEM_LIMIT, 50);
const YOUTUBE_MIN_ITEMS_PER_MEDIA_FEED = toPositiveInt(process.env.YOUTUBE_MIN_ITEMS_PER_MEDIA_FEED, 2);
const REQUIRE_MEDIA_API_SOURCES = process.env.REQUIRE_MEDIA_API_SOURCES !== "0";
const HTTP_TIMEOUT_MS = toPositiveInt(process.env.HTTP_TIMEOUT_MS, 12000);
const ARTICLE_TIMEOUT_MS = toPositiveInt(process.env.ARTICLE_TIMEOUT_MS, 9000);
const ARTICLE_CONCURRENCY = toPositiveInt(process.env.ARTICLE_CONCURRENCY, 5);
const SOURCE_CONCURRENCY = toPositiveInt(process.env.SOURCE_CONCURRENCY, 3);
const RECENCY_HOURS = toPositiveInt(process.env.RECENCY_HOURS, 48);
const EMBED_IMAGE_MAX_BYTES = toPositiveInt(process.env.EMBED_IMAGE_MAX_BYTES, 700000);
const DRY_RUN = process.env.DRY_RUN === "1";

const NAVER_CAFE_API_BASE =
  "https://apis.naver.com/cafe-home-web/cafe-home/v1/popular";
const NAVER_CAFE_ARTICLE_API_BASE = "https://article.cafe.naver.com/gw/v4/cafes";
const DAUM_CAFE_TOP_URL = "https://m.cafe.daum.net/";
const CHZZK_LIVES_API_URL = "https://api.chzzk.naver.com/service/v1/lives?size=20&sortType=POPULAR";
const CHZZK_LIVE_PAGE_BASE = "https://chzzk.naver.com/live";
const SOOP_LIVES_API_URL =
  "https://live.sooplive.co.kr/api/main_broad_list_api.php?selectType=action&selectValue=all&orderType=view_cnt&pageNo=1&lang=ko_KR";
const SOOP_PLAY_PAGE_BASE = "https://play.sooplive.com";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_STREAMS_API_URL = "https://api.twitch.tv/helix/streams";
const TWITCH_PAGE_BASE = "https://www.twitch.tv";
const YOUTUBE_SEARCH_API_URL = "https://www.googleapis.com/youtube/v3/search";
const YOUTUBE_VIDEOS_API_URL = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_WATCH_BASE = "https://www.youtube.com/watch";
const YOUTUBE_LIVE_QUERIES = parseListEnv(process.env.YOUTUBE_LIVE_QUERIES, [
  "라이브",
  "게임 라이브",
  "음악 라이브",
]);

const MEDIA_FEEDS = [
  { key: "mediaChat", label: "채팅", category: "chat" },
  { key: "mediaGame", label: "게임", category: "game" },
  { key: "mediaMusic", label: "음악", category: "music" },
];

const MEDIA_CATEGORY_RULES = {
  music: [
    "음악",
    "노래",
    "뮤직",
    "music",
    "singing",
    "karaoke",
    "cover",
    "concert",
    "dj",
    "버스킹",
    "피아노",
    "기타",
  ],
  game: [
    "game",
    "게임",
    "스타크래프트",
    "리그 오브 레전드",
    "league of legends",
    "lol",
    "발로란트",
    "valorant",
    "배틀그라운드",
    "pubg",
    "마인크래프트",
    "minecraft",
    "메이플",
    "로스트아크",
    "오버워치",
    "피파",
    "fc online",
    "이터널 리턴",
    "서든",
    "fps",
    "rpg",
    "스팀",
  ],
  chat: [
    "just chatting",
    "talk",
    "토크",
    "캠방",
    "소통",
    "먹방",
    "일상",
    "보이는라디오",
    "라디오",
    "잡담",
    "버튜버",
    "주식",
    "뉴스",
    "youtube",
    "유튜브",
  ],
};

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const USER_AGENT = process.env.TREND_USER_AGENT || BROWSER_USER_AGENT;

const CAFE_RANGES = [
  {
    key: "daily",
    label: "실시간HOT",
    endpoint: "realtime",
    description: "네이버 카페와 다음 카페 실시간 공식 인기글 랭킹입니다.",
    includeDaum: true,
  },
  {
    key: "weekly",
    label: "주간TOP",
    endpoint: "weekly",
    description: "네이버 카페 주간 TOP 공식 랭킹입니다.",
    includeDaum: false,
  },
];

const COMMUNITY_SOURCES = [
  {
    key: "dcinsideBest",
    label: "디시인사이드 실베",
    siteName: "디시인사이드",
    url: "https://gall.dcinside.com/board/lists/?id=dcbest",
    parser: parseDcinsideBest,
  },
];

const FALLBACK_IMAGES = {
  naverCafe:
    "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80",
  community:
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
  mediaTrend:
    "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=900&q=80",
};

const articleImageCache = new Map();

async function startRobot() {
  console.log("모아리뷰 실시간 트렌드 수집을 시작합니다.");

  const categoriesData = {};
  for (const range of CAFE_RANGES) {
    categoriesData[range.key] = await fetchCafeTrend(range);
  }

  categoriesData.communityPopular = await fetchAggregateTrend({
    key: "communityPopular",
    label: "커뮤니티 인기",
    type: "community",
    sources: COMMUNITY_SOURCES,
    fallbackImage: FALLBACK_IMAGES.community,
  });

  const mediaBuckets = await fetchMediaTrendBuckets();
  for (const feed of MEDIA_FEEDS) {
    categoriesData[feed.key] = mediaBuckets[feed.key] || [];
  }
  categoriesData.mediaTrends = categoriesData.mediaChat || [];

  categoriesData.updatedAt = new Date().toISOString();

  if (DRY_RUN) {
    console.log("\n[DRY_RUN] Firebase 전송 없이 수집 결과만 출력합니다.");
    if (process.env.DRY_RUN_SUMMARY === "1") {
      console.log(JSON.stringify(summarize(categoriesData), null, 2));
    } else {
      console.log(JSON.stringify(categoriesData, null, 2));
    }
    return;
  }

  const firebaseUrl = buildFirebaseUrl(
    process.env.FIREBASE_DB_URL || DEFAULT_FIREBASE_DB_URL,
    process.env.FIREBASE_AUTH_TOKEN
  );

  try {
    const response = await fetch(firebaseUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(categoriesData),
    });

    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    console.log("\n[성공] 모아리뷰 실시간 트렌드 데이터가 Firebase에 저장되었습니다.");
  } catch (error) {
    console.error("\n[실패] Firebase 전송 오류:", error.message);
    process.exitCode = 1;
  }
}

async function fetchCafeTrend(range) {
  const sourceLabel = range.includeDaum ? "네이버 카페 + 다음 카페" : "네이버 카페";
  console.log(`\n[${range.label}] ${sourceLabel} 공식 인기글 수집`);

  const sourceFetchers = [
    { label: "네이버 카페", fetcher: () => fetchNaverCafeSource(range) },
  ];
  if (range.includeDaum) {
    sourceFetchers.push({ label: "다음 카페", fetcher: () => fetchDaumCafeSource(range) });
  }

  const sourceResults = await mapLimit(sourceFetchers, SOURCE_CONCURRENCY, async (source) => {
    try {
      const items = await source.fetcher();
      console.log(`  - ${source.label}: ${items.length}개`);
      return items;
    } catch (error) {
      console.warn(`  - ${source.label} 수집 실패: ${error.message}`);
      return [];
    }
  });

  const allArticles = dedupeItems(sourceResults.flat()).filter((item) => item.title && item.link);
  const recentArticles =
    range.key === "daily"
      ? allArticles.filter((item) => ageInHours(item.publishedAt) <= RECENCY_HOURS)
      : allArticles;
  const articlePool = recentArticles.length >= MAX_ITEMS ? recentArticles : allArticles;

  const articles = articlePool
    .map((item) => ({
      ...item,
      trendScore: calculateCafeTrendScore(item),
    }))
    .sort(compareCafeArticles)
    .slice(0, Math.max(MAX_ITEMS * 2, MAX_ITEMS));

  const enrichedItems = await mapLimit(articles, ARTICLE_CONCURRENCY, enrichCafeArticle);

  const topItems = enrichedItems
    .map((item) => ({
      ...item,
      trendScore: calculateCafeTrendScore(item),
    }))
    .sort(compareCafeArticles)
    .slice(0, MAX_ITEMS)
    .map((item, index) => toPublicCafeTrendItem(item, index, range));

  console.log(
    `  - 통합 후보 ${articles.length}개, 본문첫이미지 ${
      enrichedItems.filter((item) => item.firstImage).length
    }개, 최종 ${topItems.length}/${MAX_ITEMS}개`
  );
  return topItems;
}

async function fetchAggregateTrend({ key, label, type, sources, fallbackImage }) {
  console.log(`\n[${label}] ${sources.map((source) => source.label).join(", ")} 수집`);

  const sourceResults = await mapLimit(sources, SOURCE_CONCURRENCY, async (source) => {
    try {
      const html = await fetchText(source.url, {
        encoding: source.encoding,
        referer: source.url,
      });
      const parsed = source
        .parser(html, source)
        .filter((item) => item.title && item.link)
        .slice(0, SOURCE_ITEM_LIMIT)
        .map((item, index) => ({
          ...item,
          type,
          sourceKey: source.key,
          source: source.siteName,
          siteName: source.siteName,
          boardName: source.label,
          sourceUrl: source.url,
          sourceRank: item.sourceRank || index + 1,
        }));

      console.log(`  - ${source.label}: ${parsed.length}개`);
      return parsed;
    } catch (error) {
      console.warn(`  - ${source.label} 수집 실패: ${error.message}`);
      return [];
    }
  });

  const candidates = dedupeItems(sourceResults.flat())
    .map((item) => ({
      ...item,
      trendScore: calculateTrendScore(item, type),
    }))
    .sort(compareTrendItems)
    .slice(0, Math.max(MAX_ITEMS * 2, MAX_ITEMS));

  const enrichedItems = await mapLimit(
    candidates,
    ARTICLE_CONCURRENCY,
    (item) => enrichExternalArticleImage(item, fallbackImage)
  );

  const rankedItems = enrichedItems
    .map((item) => ({
      ...item,
      trendScore: calculateTrendScore(item, type),
    }))
    .sort(compareTrendItems);
  const topItems = selectBalancedTopItems(rankedItems, MAX_ITEMS)
    .map((item, index) => toPublicTrendItem(item, index, type, fallbackImage));

  console.log(
    `  - 통합 후보 ${candidates.length}개, 이미지 ${
      topItems.filter((item) => isDisplayableImage(item.img)).length
    }개, 최종 ${topItems.length}/${MAX_ITEMS}개`
  );

  return topItems;
}

async function fetchMediaTrendBuckets() {
  console.log("\n[미디어 트렌드] 치지직, SOOP, 트위치, 유튜브 실시간 시청자수 랭킹 수집");

  const sourceFetchers = [
    { label: "치지직 LIVE", fetcher: fetchChzzkLiveRankings },
    { label: "SOOP LIVE", fetcher: fetchSoopLiveRankings },
    { label: "Twitch LIVE", fetcher: fetchTwitchLiveRankings, limit: TWITCH_SOURCE_ITEM_LIMIT },
    { label: "YouTube LIVE", fetcher: fetchYoutubeLiveRankings, limit: YOUTUBE_SOURCE_ITEM_LIMIT },
  ];

  const sourceResults = await mapLimit(sourceFetchers, SOURCE_CONCURRENCY, async (source) => {
    try {
      const items = await source.fetcher();
      console.log(`  - ${source.label}: ${items.length}개`);
      return items.slice(0, source.limit || SOURCE_ITEM_LIMIT);
    } catch (error) {
      console.warn(`  - ${source.label} 수집 실패: ${error.message}`);
      return [];
    }
  });

  const rawMediaItems = sourceResults.flat();
  enforceRequiredMediaSources(rawMediaItems);

  const rankedItems = dedupeItems(rawMediaItems)
    .map((item) => ({
      ...item,
      type: "media",
      mediaCategory: classifyMediaCategory(item),
      viewCount: toNumber(item.viewerCount || item.viewCount),
      trendScore: calculateLiveTrendScore(item),
    }))
    .sort(compareLiveTrendItems);

  const buckets = {};
  for (const feed of MEDIA_FEEDS) {
    const categoryItems = rankedItems.filter((item) => item.mediaCategory === feed.category);
    const topItems = selectMediaTopItems(categoryItems)
      .map((item, index) => toPublicTrendItem(item, index, "media", FALLBACK_IMAGES.mediaTrend));

    buckets[feed.key] = topItems;
    console.log(
      `  - ${feed.label}: 후보 ${categoryItems.length}개, 이미지 ${
        topItems.filter((item) => isDisplayableImage(item.img)).length
      }개, 최종 ${topItems.length}/${MAX_ITEMS}개`
    );
  }

  return buckets;
}

function enforceRequiredMediaSources(items) {
  if (!REQUIRE_MEDIA_API_SOURCES) return;

  const missing = [];
  if (!items.some(isTwitchItem)) missing.push("트위치");
  if (!items.some(isYoutubeItem)) missing.push("유튜브");

  if (!missing.length) return;

  throw new Error(
    `${missing.join(", ")} 수집 결과가 0개입니다. API 키 또는 할당량을 확인하세요. ` +
      "기존 Firebase 데이터를 지우지 않기 위해 저장을 중단합니다. " +
      "임시로 부분 저장을 허용하려면 REQUIRE_MEDIA_API_SOURCES=0으로 설정하세요."
  );
}

async function fetchMediaTrends() {
  const buckets = await fetchMediaTrendBuckets();
  return buckets.mediaChat || [];
}

async function fetchChzzkLiveRankings() {
  const response = await fetchJsonWithHeaders(CHZZK_LIVES_API_URL, {
    headers: {
      ...basicBrowserHeaders(),
      Referer: "https://chzzk.naver.com/",
      Origin: "https://chzzk.naver.com",
    },
  });
  const items = response?.content?.data || [];

  return items
    .filter((item) => item?.liveId && item.liveTitle && !item.adult)
    .map((item, index) => {
      const channel = item.channel || {};
      const channelId = channel.channelId || item.channelId || "";
      const thumbnail = normalizeChzzkThumbnail(
        item.liveImageUrl || item.defaultThumbnailImageUrl || channel.channelImageUrl
      );

      return {
        sourceRank: index + 1,
        title: stripHtml(item.liveTitle),
        link: channelId ? `${CHZZK_LIVE_PAGE_BASE}/${encodeURIComponent(channelId)}` : "https://chzzk.naver.com/",
        previewUrl: "",
        previewType: "image",
        img: thumbnail,
        thumbnail,
        platformName: "치지직",
        source: "치지직",
        siteName: "치지직",
        boardName: item.liveCategoryValue || "LIVE",
        sourceKey: "chzzkLive",
        sourceUrl: "https://chzzk.naver.com/lives",
        channelName: stripHtml(channel.channelName || "치지직"),
        viewerCount: toNumber(item.concurrentUserCount),
        viewCount: toNumber(item.concurrentUserCount),
        concurrentUserCount: toNumber(item.concurrentUserCount),
        recommendCount: 0,
        commentCount: 0,
        viewTime: "LIVE",
        publishedLabel: "LIVE",
        publishedAt: parseKoreanDate(item.openDate),
        openDate: item.openDate,
        rankingBasis: "치지직 실시간 라이브 시청자수 랭킹",
        liveId: item.liveId,
        channelId,
        tags: item.tags || [],
      };
    });
}

async function fetchSoopLiveRankings() {
  const response = await fetchJsonWithHeaders(SOOP_LIVES_API_URL, {
    headers: {
      ...basicBrowserHeaders(),
      Referer: "https://www.sooplive.co.kr/",
      Origin: "https://www.sooplive.co.kr",
    },
  });
  const items = response?.broad || [];

  return items
    .filter((item) => item?.broad_no && item.broad_title && item.is_password !== "Y" && item.broad_grade !== "19")
    .map((item, index) => {
      const viewerCount = toNumber(item.current_view_cnt || item.total_view_cnt || item.pc_view_cnt);
      const thumbnail = normalizeImageUrl(item.broad_thumb, "https://live.sooplive.co.kr/");
      const userId = item.user_id || "";
      const broadNo = item.broad_no || "";
      const playUrl =
        userId && broadNo
          ? `${SOOP_PLAY_PAGE_BASE}/${encodeURIComponent(userId)}/${encodeURIComponent(broadNo)}`
          : "https://www.sooplive.co.kr/";

      return {
        sourceRank: index + 1,
        title: stripHtml(item.broad_title),
        link: playUrl,
        previewUrl: "",
        previewType: "image",
        img: thumbnail,
        thumbnail,
        platformName: "SOOP",
        source: "SOOP",
        siteName: "SOOP",
        boardName: item.category_name || "LIVE",
        sourceKey: "soopLive",
        sourceUrl: "https://www.sooplive.co.kr/",
        channelName: stripHtml(item.user_nick || item.station_name || userId || "SOOP"),
        viewerCount,
        viewCount: viewerCount,
        concurrentUserCount: viewerCount,
        recommendCount: 0,
        commentCount: 0,
        viewTime: "LIVE",
        publishedLabel: "LIVE",
        publishedAt: parseKoreanDate(item.broad_start),
        openDate: item.broad_start,
        rankingBasis: "SOOP 실시간 라이브 시청자수 랭킹",
        liveId: broadNo,
        channelId: userId,
        tags: uniqueCompact([...(item.hash_tags || []), ...(item.category_tags || [])]),
      };
    });
}

async function fetchTwitchLiveRankings() {
  const clientId = process.env.TWITCH_CLIENT_ID || "";
  const clientSecret = process.env.TWITCH_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    console.warn("  - Twitch API 키가 없어 건너뜁니다. TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET을 .env에 넣으면 활성화됩니다.");
    return [];
  }

  const token = await fetchTwitchAppAccessToken(clientId, clientSecret);
  const url = new URL(TWITCH_STREAMS_API_URL);
  url.searchParams.set("first", String(Math.min(100, Math.max(SOURCE_ITEM_LIMIT * 3, 30))));
  url.searchParams.set("language", "ko");

  const response = await fetchJsonWithHeaders(url.toString(), {
    headers: {
      ...basicBrowserHeaders(),
      "Client-Id": clientId,
      Authorization: `Bearer ${token}`,
    },
  });

  return (response?.data || [])
    .filter((item) => item?.id && item.user_login && item.title)
    .map((item, index) => {
      const thumbnail = normalizeTwitchThumbnail(item.thumbnail_url);
      const viewerCount = toNumber(item.viewer_count);

      return {
        sourceRank: index + 1,
        title: stripHtml(item.title),
        link: `${TWITCH_PAGE_BASE}/${encodeURIComponent(item.user_login)}`,
        previewUrl: "",
        previewType: "image",
        img: thumbnail,
        thumbnail,
        platformName: "트위치",
        source: "트위치",
        siteName: "트위치",
        boardName: item.game_name || "LIVE",
        sourceKey: "twitchLive",
        sourceUrl: "https://www.twitch.tv/directory",
        channelName: stripHtml(item.user_name || item.user_login || "Twitch"),
        viewerCount,
        viewCount: viewerCount,
        concurrentUserCount: viewerCount,
        recommendCount: 0,
        commentCount: 0,
        viewTime: "LIVE",
        publishedLabel: "LIVE",
        publishedAt: item.started_at || new Date().toISOString(),
        openDate: item.started_at || "",
        rankingBasis: "Twitch 공식 Helix Streams API 시청자수 랭킹",
        liveId: item.id,
        channelId: item.user_id || item.user_login,
        tags: uniqueCompact([item.game_name, ...(item.tags || [])]),
      };
    });
}

async function fetchTwitchAppAccessToken(clientId, clientSecret) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  const response = await fetchJsonWithHeaders(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response?.access_token) throw new Error("Twitch app access token 발급 실패");
  return response.access_token;
}

async function fetchYoutubeLiveRankings() {
  const apiKey = process.env.YOUTUBE_API_KEY || "";
  if (!apiKey) {
    console.warn("  - YouTube API 키가 없어 건너뜁니다. YOUTUBE_API_KEY를 .env에 넣으면 활성화됩니다.");
    return [];
  }

  const perQueryLimit = Math.min(10, Math.max(3, Math.ceil(YOUTUBE_SOURCE_ITEM_LIMIT / YOUTUBE_LIVE_QUERIES.length)));
  const searchResults = await mapLimit(YOUTUBE_LIVE_QUERIES, SOURCE_CONCURRENCY, async (query) => {
    const searchUrl = new URL(YOUTUBE_SEARCH_API_URL);
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("eventType", "live");
    searchUrl.searchParams.set("order", "viewCount");
    searchUrl.searchParams.set("regionCode", "KR");
    searchUrl.searchParams.set("relevanceLanguage", "ko");
    searchUrl.searchParams.set("maxResults", String(perQueryLimit));
    searchUrl.searchParams.set("q", query);
    const videoCategoryId = getYoutubeVideoCategoryId(query);
    if (videoCategoryId) searchUrl.searchParams.set("videoCategoryId", videoCategoryId);
    searchUrl.searchParams.set("key", apiKey);

    const response = await fetchJsonWithHeaders(searchUrl.toString());
    return (response?.items || []).map((item) => ({ ...item, youtubeQuery: query }));
  });

  const searchItems = dedupeYoutubeSearchItems(searchResults.flat()).slice(0, YOUTUBE_SOURCE_ITEM_LIMIT);
  const videoIds = uniqueCompact(searchItems.map((item) => item?.id?.videoId));
  if (videoIds.length === 0) return [];
  const queryByVideoId = new Map(searchItems.map((item) => [item.id.videoId, item.youtubeQuery || ""]));

  const videosUrl = new URL(YOUTUBE_VIDEOS_API_URL);
  videosUrl.searchParams.set("part", "snippet,liveStreamingDetails,statistics");
  videosUrl.searchParams.set("id", videoIds.join(","));
  videosUrl.searchParams.set("key", apiKey);

  const videosResponse = await fetchJsonWithHeaders(videosUrl.toString());
  const videoMap = new Map((videosResponse?.items || []).map((item) => [item.id, item]));

  return videoIds
    .map((videoId, index) => {
      const item = videoMap.get(videoId);
      if (!item?.id) return null;

      const snippet = item.snippet || {};
      const viewerCount = toNumber(item.liveStreamingDetails?.concurrentViewers || item.statistics?.viewCount);
      const query = queryByVideoId.get(videoId) || "";
      const thumbnail =
        snippet.thumbnails?.maxres?.url ||
        snippet.thumbnails?.high?.url ||
        snippet.thumbnails?.medium?.url ||
        snippet.thumbnails?.default?.url ||
        "";
      const watchUrl = new URL(YOUTUBE_WATCH_BASE);
      watchUrl.searchParams.set("v", item.id);

      return {
        sourceRank: index + 1,
        title: stripHtml(snippet.title),
        link: watchUrl.toString(),
        previewUrl: "",
        previewType: "image",
        img: normalizeImageUrl(thumbnail, "https://www.youtube.com/"),
        thumbnail: normalizeImageUrl(thumbnail, "https://www.youtube.com/"),
        platformName: "유튜브",
        source: "유튜브",
        siteName: "유튜브",
        boardName: inferYoutubeBoardName(query, snippet.title, snippet.categoryId),
        sourceKey: "youtubeLive",
        sourceUrl: "https://www.youtube.com/live",
        channelName: stripHtml(snippet.channelTitle || "YouTube"),
        viewerCount,
        viewCount: viewerCount,
        concurrentUserCount: viewerCount,
        recommendCount: 0,
        commentCount: 0,
        viewTime: "LIVE",
        publishedLabel: "LIVE",
        publishedAt: snippet.publishedAt || item.liveStreamingDetails?.actualStartTime || new Date().toISOString(),
        openDate: item.liveStreamingDetails?.actualStartTime || snippet.publishedAt || "",
        rankingBasis: "YouTube Data API liveStreamingDetails 동시 시청자수 랭킹",
        liveId: item.id,
        channelId: snippet.channelId || "",
        tags: uniqueCompact([query, snippet.categoryId, snippet.channelTitle]),
      };
    })
    .filter(Boolean);
}

async function enrichCafeArticle(item) {
  if (item.sourceKey === "daumCafeTop") return enrichDaumCafeArticle(item);
  return enrichNaverCafeArticle(item);
}

async function enrichNaverCafeArticle(item) {
  const firstImage = await fetchNaverCafeFirstImage(item).catch((error) => {
    console.warn(`  - 네이버 카페 첫 이미지 추출 실패: ${item.title} (${error.message})`);
    return "";
  });

  return {
    ...item,
    firstImage,
  };
}

async function enrichDaumCafeArticle(item) {
  const detail = await fetchDaumCafeArticleDetail(item).catch((error) => {
    console.warn(`  - 다음 카페 상세 정보 추출 실패: ${item.title} (${error.message})`);
    return {};
  });

  return {
    ...item,
    ...detail,
    readCount: detail.viewCount || item.readCount || item.viewCount || 0,
    viewCount: detail.viewCount || item.viewCount || item.readCount || 0,
    commentCount: detail.commentCount ?? item.commentCount ?? 0,
    firstImage: detail.firstImage || "",
    img: detail.firstImage || item.img || FALLBACK_IMAGES.naverCafe,
    thumbnail: detail.firstImage || item.thumbnail || item.img || FALLBACK_IMAGES.naverCafe,
  };
}

async function fetchDaumCafeArticleDetail(item) {
  if (!isHttpUrl(item.link)) return {};

  const cacheKey = `daum:${item.link}`;
  if (articleImageCache.has(cacheKey)) return articleImageCache.get(cacheKey);

  const html = await fetchText(item.link, {
    timeoutMs: ARTICLE_TIMEOUT_MS,
    referer: DAUM_CAFE_TOP_URL,
  });
  const firstImage = extractFirstImageFromHtml(html, {
    baseUrl: item.link,
    allowedHostIncludes: ["daumcdn.net"],
  });
  const meta = extractDaumCafeArticleMeta(html);
  const detail = {
    firstImage,
    ...meta,
  };

  articleImageCache.set(cacheKey, detail);
  return detail;
}

async function fetchNaverCafeFirstImage(item) {
  if (!item.cafeId || !item.articleId) return "";

  const cacheKey = `naver:${item.cafeId}:${item.articleId}`;
  if (articleImageCache.has(cacheKey)) return articleImageCache.get(cacheKey);

  const url = new URL(
    `${NAVER_CAFE_ARTICLE_API_BASE}/${encodeURIComponent(item.cafeId)}/articles/${encodeURIComponent(
      item.articleId
    )}`
  );
  url.searchParams.set("useCafeId", "true");
  url.searchParams.set("fromPopular", "true");
  if (item.art) {
    url.searchParams.set("art", item.art);
  }

  const response = await fetchJson(url.toString(), {
    referer: item.link,
    origin: "https://m.cafe.naver.com",
    product: "mweb",
  });
  const contentHtml = response?.result?.article?.contentHtml || "";
  const firstImage = extractFirstImageFromHtml(contentHtml, {
    baseUrl: item.link,
    allowedHostIncludes: ["pstatic.net", "naver.net"],
  });

  articleImageCache.set(cacheKey, firstImage);
  return firstImage;
}

async function enrichExternalArticleImage(item, fallbackImage) {
  if (isHttpUrl(item.img) && !item.preferDetailImage && !needsEmbeddedImage(item.img)) {
    return { ...item, img: item.img };
  }

  const firstImage = await fetchExternalFirstImage(item).catch((error) => {
    console.warn(`  - 외부 글 첫 이미지 추출 실패: ${item.title} (${error.message})`);
    return "";
  });

  const image = firstImage || item.img || fallbackImage;
  const displayImage = await embedImageIfNeeded(image, item).catch((error) => {
    console.warn(`  - 보호 이미지 변환 실패: ${item.title} (${error.message})`);
    return image;
  });

  return {
    ...item,
    rawFirstImage: firstImage,
    firstImage: displayImage,
    img: displayImage,
  };
}

async function fetchExternalFirstImage(item) {
  if (!isHttpUrl(item.link)) return "";

  const cacheKey = `external:${item.link}`;
  if (articleImageCache.has(cacheKey)) return articleImageCache.get(cacheKey);

  const html = await fetchText(item.link, {
    timeoutMs: ARTICLE_TIMEOUT_MS,
    referer: item.sourceUrl || item.link,
  });
  const firstImage = extractFirstImageFromHtml(html, { baseUrl: item.link });

  articleImageCache.set(cacheKey, firstImage);
  return firstImage;
}

async function fetchNaverCafePopular(endpoint) {
  const url = `${NAVER_CAFE_API_BASE}/${endpoint}?ad=false&adUnit=&uuid=`;
  const response = await fetchJson(url);
  const message = response?.message;

  if (message?.status !== "200") {
    const code = message?.error?.code || "unknown";
    const msg = message?.error?.msg || "Naver Cafe API error";
    throw new Error(`${endpoint} ${code}: ${msg}`);
  }

  return message?.result?.popularArticles || [];
}

async function fetchNaverCafeSource(range) {
  const rawItems = await fetchNaverCafePopular(range.endpoint);
  return rawItems
    .filter((entry) => entry?.type === "ARTICLE" && entry.item)
    .map((entry) => normalizeCafeArticle(entry.item, range))
    .filter((item) => item.title && item.link && item.readCount > 0)
    .sort(compareCafeArticles)
    .slice(0, SOURCE_ITEM_LIMIT);
}

async function fetchDaumCafeSource(range) {
  const html = await fetchText(DAUM_CAFE_TOP_URL, {
    referer: DAUM_CAFE_TOP_URL,
  });
  return parseDaumCafePopular(html, range).slice(0, Math.max(SOURCE_ITEM_LIMIT, MAX_ITEMS));
}

function parseDaumCafePopular(html, range) {
  const rows = [...String(html || "").matchAll(/<a\b[^>]*class=["'][^"']*popular-list__link[^"']*["'][\s\S]*?<\/a>/gi)]
    .map((match) => match[0]);

  return rows
    .map((row, index) => {
      const href = row.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1] || "";
      const link = absolutizeUrl(href, DAUM_CAFE_TOP_URL);
      const title = stripHtml(
        row.match(/<strong\b[^>]*class=["'][^"']*popular-list__title[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i)?.[1] || ""
      );
      const cafeName = cleanCafeName(
        row.match(/<span\b[^>]*class=["'][^"']*popular-list__cafe-name[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
          "다음 카페"
      );
      const sourceRank =
        parseCount(
          row.match(/<em\b[^>]*class=["'][^"']*popular-list__rank[^"']*["'][^>]*>([\s\S]*?)<\/em>/i)?.[1]
        ) ||
        index + 1;
      const articleIds = extractDaumCafeArticleIds(link);

      return {
        sourceKey: "daumCafeTop",
        sourceRank,
        title,
        link,
        img: extractImageFromTag(row, DAUM_CAFE_TOP_URL),
        thumbnail: extractImageFromTag(row, DAUM_CAFE_TOP_URL),
        source: "다음 카페",
        siteName: "다음 카페",
        boardName: range.label,
        cafeName,
        viewCount: 0,
        readCount: 0,
        recommendCount: 0,
        likeCount: 0,
        commentCount: 0,
        publishedAt: new Date().toISOString(),
        rankingBasis: `${range.label} 다음 카페 공식 인기글`,
        ...articleIds,
      };
    })
    .filter((item) => item.title && item.link);
}

function parseDcinsideBest(html, source) {
  const rows = [...html.matchAll(/<tr\b[^>]*class=["'][^"']*ub-content[^"']*["'][\s\S]*?<\/tr>/gi)]
    .map((match) => match[0])
    .filter((row) => /us-post/i.test(row) && !/icon_notice|공지/.test(row));

  return rows.map((row, index) => {
    const titleCell = row.match(/<td\b[^>]*class=["'][^"']*gall_tit[^"']*["'][\s\S]*?<\/td>/i)?.[0] || "";
    const linkMatch = titleCell.match(/<a\b[^>]*href=["']([^"']*\/board\/view\/\?[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const link = absolutizeUrl(linkMatch?.[1] || "", source.url);
    const rawTitle = stripHtml(linkMatch?.[2] || "").replace(/\[[\d/]+\]\s*$/, "");
    const galleryName = rawTitle.match(/^\[([^\]]+)\]/)?.[1] || "";
    const title = rawTitle.replace(/^\[[^\]]+\]\s*/, "").trim();
    const thumb = extractImageFromTag(titleCell, source.url);
    const commentCount = parseCount(titleCell.match(/<span\b[^>]*class=["'][^"']*reply_num[^"']*["'][^>]*>\s*\[?(\d+)/i)?.[1]);
    const dateCell = row.match(/<td\b[^>]*class=["'][^"']*gall_date[^"']*["'][^>]*>[\s\S]*?<\/td>/i)?.[0] || "";

    return {
      sourceRank: index + 1,
      title,
      link,
      img: thumb,
      viewCount: parseCount(extractCellText(row, "gall_count")),
      recommendCount: parseCount(extractCellText(row, "gall_recommend")),
      commentCount,
      communityName: galleryName ? `디시 ${galleryName}` : source.siteName,
      publishedAt: parseKoreanDate(dateCell.match(/\btitle=["']([^"']+)["']/i)?.[1] || stripHtml(dateCell)),
      rankingBasis: `${source.label} 공식 목록`,
    };
  });
}

function normalizeCafeArticle(item, range) {
  return {
    sourceKey: "naverCafePopular",
    sourceRank: toNumber(item.rank),
    title: stripHtml(item.subject),
    link: buildCafeArticleUrl(item),
    img: normalizeImageUrl(item.representImage),
    thumbnail: normalizeImageUrl(item.representImage),
    source: "네이버 카페",
    siteName: "네이버 카페",
    boardName: range.label,
    naverRank: toNumber(item.rank),
    readCount: toNumber(item.readCount),
    viewCount: toNumber(item.readCount),
    commentCount: toNumber(item.commentCount),
    likeCount: toNumber(item.likeCount),
    recommendCount: toNumber(item.likeCount),
    cafeName: cleanCafeName(item.cafeName || "네이버 카페"),
    cafeId: item.cafeId,
    articleId: item.articleId,
    art: item.art || "",
    publishedAt: item.writeDateTimestamp
      ? new Date(Number(item.writeDateTimestamp)).toISOString()
      : new Date().toISOString(),
    rankingBasis: `${range.label} 네이버 카페 공식 랭킹`,
  };
}

function toPublicCafeTrendItem(item, index, range) {
  const readCount = toNumber(item.readCount || item.viewCount);
  const likeCount = toNumber(item.likeCount || item.recommendCount);
  const sourceName = item.source || item.siteName || "카페";
  const cafeName = item.cafeName || sourceName;

  return {
    rank: index + 1,
    title: item.title,
    content: `${range.label} · ${cafeName} · 조회 ${formatCountKo(readCount)} · 댓글 ${formatCountKo(
      item.commentCount
    )}${likeCount ? ` · 좋아요 ${formatCountKo(likeCount)}` : ""}`,
    link: item.link,
    img: item.firstImage || item.img || FALLBACK_IMAGES.naverCafe,
    thumbnail: item.firstImage || item.thumbnail || item.img || FALLBACK_IMAGES.naverCafe,
    source: cafeName,
    siteName: sourceName,
    boardName: item.boardName || range.label,
    sources: uniqueCompact([sourceName, cafeName]),
    sourceCount: 1,
    publishedAt: item.publishedAt || new Date().toISOString(),
    rankingBasis: item.rankingBasis || `${range.label} 카페 공식 인기글`,
    sourceRank: item.sourceRank,
    naverRank: item.naverRank,
    daumRank: item.sourceKey === "daumCafeTop" ? item.sourceRank : undefined,
    readCount,
    viewCount: readCount,
    commentCount: toNumber(item.commentCount),
    likeCount,
    recommendCount: likeCount,
    cafeName,
    cafeId: item.cafeId,
    articleId: item.articleId,
    daumCafeCode: item.daumCafeCode,
    daumBoardId: item.daumBoardId,
  };
}

function toPublicTrendItem(item, index, type, fallbackImage) {
  const base = {
    rank: index + 1,
    title: item.title,
    content: buildContentSummary(item, type),
    link: item.link,
    img: item.firstImage || item.img || fallbackImage,
    thumbnail: item.firstImage || item.img || fallbackImage,
    source: item.source || item.siteName,
    siteName: item.siteName,
    boardName: item.boardName,
    sources: uniqueCompact([item.source, item.siteName, item.boardName]),
    sourceCount: 1,
    publishedAt: item.publishedAt || new Date().toISOString(),
    rankingBasis: item.rankingBasis || "공식 인기 목록 + 반응 지표",
    sourceRank: item.sourceRank,
    viewCount: toNumber(item.viewCount),
    readCount: toNumber(item.viewCount),
    viewerCount: toNumber(item.viewerCount || item.concurrentUserCount || item.viewCount),
    concurrentUserCount: toNumber(item.concurrentUserCount || item.viewerCount || item.viewCount),
    recommendCount: toNumber(item.recommendCount),
    commentCount: toNumber(item.commentCount),
    previewUrl: item.previewUrl || item.livePreviewUrl || item.embedUrl || "",
    previewType: item.previewType || item.previewKind || "",
    mediaCategory: item.mediaCategory || classifyMediaCategory(item),
  };

  if (type === "community") {
    return {
      ...base,
      communityName: item.communityName || item.source || item.siteName,
    };
  }

  return {
    ...base,
    platformName: item.platformName || item.source || item.siteName || "",
    channelName: item.channelName || "",
    viewTime: item.viewTime || item.publishedLabel || "",
    videoThumbnail: base.img,
    contentThumbnail: base.img,
    watchUrl: item.link,
    previewUrl: base.previewUrl,
    previewType: base.previewType,
  };
}

function buildContentSummary(item, type) {
  const parts = [];
  if (item.siteName || item.source) parts.push(item.siteName || item.source);
  if (item.boardName) parts.push(item.boardName);
  if (type === "media" && toNumber(item.viewerCount || item.viewCount) > 0) {
    parts.push(`시청자 ${formatCountKo(item.viewerCount || item.viewCount)}`);
  } else if (item.viewCount > 0) {
    parts.push(`조회 ${formatCountKo(item.viewCount)}`);
  }
  if (item.recommendCount > 0) parts.push(`추천 ${formatCountKo(item.recommendCount)}`);
  if (item.commentCount > 0) parts.push(`댓글 ${formatCountKo(item.commentCount)}`);
  return parts.join(" · ");
}

function buildCafeArticleUrl(item) {
  const cafeId = encodeURIComponent(item.cafeId || "");
  const articleId = encodeURIComponent(item.articleId || "");
  const url = new URL(`https://m.cafe.naver.com/ca-fe/web/cafes/${cafeId}/articles/${articleId}`);
  url.searchParams.set("fromPopular", "true");

  if (item.art) {
    url.searchParams.set("art", item.art);
  }

  return url.toString();
}

function extractDaumCafeArticleIds(link) {
  try {
    const url = new URL(link);
    const [daumCafeCode, daumBoardId, articleId] = url.pathname.split("/").filter(Boolean);
    return {
      daumCafeCode,
      daumBoardId,
      articleId,
    };
  } catch {
    return {};
  }
}

function extractDaumCafeArticleMeta(html) {
  const text = stripHtml(html);
  const writeLabel = text.match(/작성시간\s*([^|]+?)\s*\|\s*조회수/)?.[1]?.trim() || "";
  const viewCount = parseCount(text.match(/조회수\s*([\d,만천kK.]+)/)?.[1]);
  const commentCount =
    parseCount(text.match(/댓글\s*([\d,만천kK.]+)/)?.[1]) ||
    parseCount(String(html || "").match(/commentCount:\s*["']?([\d,]+)/i)?.[1]);
  const boardName = decodeEntities(
    String(html || "").match(/boardName:\s*["']([^"']+)/i)?.[1] || ""
  ).trim();

  return {
    viewCount,
    readCount: viewCount,
    commentCount,
    publishedAt: writeLabel ? parseKoreanDate(writeLabel) : undefined,
    boardName,
  };
}

function compareCafeArticles(a, b) {
  return (
    toNumber(b.trendScore) - toNumber(a.trendScore) ||
    normalizeRank(a.naverRank) - normalizeRank(b.naverRank) ||
    normalizeRank(a.sourceRank) - normalizeRank(b.sourceRank) ||
    normalizeRank(a.rank) - normalizeRank(b.rank) ||
    toNumber(b.commentCount) - toNumber(a.commentCount) ||
    toNumber(b.likeCount) - toNumber(a.likeCount) ||
    toNumber(b.recommendCount) - toNumber(a.recommendCount) ||
    toNumber(b.readCount) - toNumber(a.readCount) ||
    toNumber(b.viewCount) - toNumber(a.viewCount) ||
    Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
  );
}

function compareTrendItems(a, b) {
  return (
    b.trendScore - a.trendScore ||
    normalizeRank(a.sourceRank) - normalizeRank(b.sourceRank) ||
    b.recommendCount - a.recommendCount ||
    b.commentCount - a.commentCount ||
    b.viewCount - a.viewCount ||
    Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)
  );
}

function compareLiveTrendItems(a, b) {
  return (
    toNumber(b.viewerCount || b.viewCount) - toNumber(a.viewerCount || a.viewCount) ||
    normalizeRank(a.sourceRank) - normalizeRank(b.sourceRank) ||
    Date.parse(a.publishedAt || 0) - Date.parse(b.publishedAt || 0)
  );
}

function selectBalancedTopItems(items, maxItems) {
  const sources = uniqueCompact(items.map((item) => item.sourceKey));
  if (sources.length <= 1) return items.slice(0, maxItems);

  const minimumPerSource = Math.max(1, Math.floor(maxItems / (sources.length + 1)));
  const selected = [];
  const selectedKeys = new Set();

  for (const sourceKey of sources) {
    const sourceItems = items.filter((item) => item.sourceKey === sourceKey);
    for (const item of sourceItems.slice(0, minimumPerSource)) {
      const key = normalizeDedupeKey(item);
      if (selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      selected.push(item);
    }
  }

  for (const item of items) {
    if (selected.length >= maxItems) break;
    const key = normalizeDedupeKey(item);
    if (selectedKeys.has(key)) continue;
    selectedKeys.add(key);
    selected.push(item);
  }

  return selected.sort(compareTrendItems).slice(0, maxItems);
}

function calculateTrendScore(item, type) {
  const sourceRank = normalizeRank(item.sourceRank);
  const rankScore = Math.max(0, SOURCE_ITEM_LIMIT + 1 - sourceRank) * 10000;
  const viewWeight = type === "community" ? 0.8 : 0.6;
  const recommendWeight = type === "community" ? 240 : 320;
  const commentWeight = type === "community" ? 110 : 90;
  const recencyWeight = type === "community" ? 650 : 420;
  const ageHours = ageInHours(item.publishedAt);
  const recencyScore = Math.max(0, 24 - ageHours) * recencyWeight;

  return (
    rankScore +
    toNumber(item.viewCount) * viewWeight +
    toNumber(item.recommendCount) * recommendWeight +
    toNumber(item.commentCount) * commentWeight +
    recencyScore
  );
}

function calculateLiveTrendScore(item) {
  const viewerCount = toNumber(item.viewerCount || item.viewCount);
  const sourceRank = normalizeRank(item.sourceRank);
  const rankScore = Math.max(0, SOURCE_ITEM_LIMIT + 1 - sourceRank) * 100;
  const ageHours = ageInHours(item.publishedAt);
  const liveFreshnessScore = Math.max(0, 12 - ageHours) * 20;
  return viewerCount * 1000 + rankScore + liveFreshnessScore;
}

function calculateCafeTrendScore(item) {
  const sourceRank = normalizeRank(item.sourceRank || item.naverRank);
  const rankLimit = Math.max(SOURCE_ITEM_LIMIT, MAX_ITEMS, 20);
  const rankScore = Math.max(0, rankLimit + 1 - sourceRank) * 10000;
  const readCount = toNumber(item.readCount || item.viewCount);
  const likeCount = toNumber(item.likeCount || item.recommendCount);
  const commentCount = toNumber(item.commentCount);
  const ageHours = ageInHours(item.publishedAt);
  const recencyScore = Math.max(0, 24 - ageHours) * 650;

  return rankScore + readCount * 0.85 + likeCount * 230 + commentCount * 120 + recencyScore;
}

function basicBrowserHeaders() {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.5",
  };
}

async function fetchJsonWithHeaders(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers || basicBrowserHeaders(),
      body: options.body,
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || HTTP_TIMEOUT_MS);
  const referer = options.referer || "https://section.cafe.naver.com/ca-fe/home/cafe-hots";
  const origin = options.origin || "https://section.cafe.naver.com";
  const product = options.product || "pc";

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.5",
        Referer: referer,
        Origin: origin,
        "X-Cafe-Product": product,
      },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.5",
        Referer: options.referer || url,
      },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return new TextDecoder(options.encoding || "utf-8").decode(bytes);
  } finally {
    clearTimeout(timer);
  }
}

function extractFirstImageFromHtml(html, options = {}) {
  const imageMatches = String(html || "").matchAll(/<img\b[^>]*>/gi);

  for (const match of imageMatches) {
    const tag = match[0];
    const rawUrl =
      tag.match(/\bdata-original=["']([^"']+)["']/i)?.[1] ||
      tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1] ||
      tag.match(/\bsrcset=["']([^"']+)["']/i)?.[1]?.split(/\s+/)[0] ||
      tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] ||
      "";
    const imageUrl = normalizeImageUrl(decodeEntities(rawUrl), options.baseUrl);

    if (isUsableArticleImage(imageUrl, options)) {
      return imageUrl;
    }
  }

  const ogImage = String(html || "").match(/<meta\b[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1];
  const normalizedOgImage = normalizeImageUrl(decodeEntities(ogImage || ""), options.baseUrl);
  return isUsableArticleImage(normalizedOgImage, options) ? normalizedOgImage : "";
}

function extractImageFromTag(html, baseUrl) {
  const rawUrl =
    String(html || "").match(/\bdata-original=["']([^"']+)["']/i)?.[1] ||
    String(html || "").match(/\bdata-src=["']([^"']+)["']/i)?.[1] ||
    String(html || "").match(/\bsrc=["']([^"']+)["']/i)?.[1] ||
    "";

  const imageUrl = normalizeImageUrl(decodeEntities(rawUrl), baseUrl);
  return isUsableArticleImage(imageUrl) ? imageUrl : "";
}

function isUsableArticleImage(value, options = {}) {
  if (!isHttpUrl(value)) return false;
  if (/\$\{|%7b|%7d/i.test(value)) return false;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const path = `${url.pathname}${url.search}`.toLowerCase();

    if (options.allowedHostIncludes?.length) {
      const allowed = options.allowedHostIncludes.some((part) => hostname.includes(part));
      if (!allowed) return false;
    }

    if (hostname.includes("nstatic.dcinside.com") && /\/(?:w|m)\/images\//i.test(path)) {
      return false;
    }
    if (/profile|avatar|emoticon|icon|sprite|blank|default|transparent|logo|loading/i.test(path)) {
      return false;
    }
    if (/tit_gallery|btn_|sp_/i.test(path)) return false;
    if (/\.(svg|ico)(?:$|\?)/i.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}

function needsEmbeddedImage(value) {
  if (!isHttpUrl(value)) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.includes("dcinside.co.kr") || hostname.includes("dcimg") || hostname.includes("dccdn");
  } catch {
    return false;
  }
}

async function embedImageIfNeeded(imageUrl, item) {
  if (!needsEmbeddedImage(imageUrl)) return imageUrl;

  const response = await fetch(imageUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.5",
      Referer: item.link || item.sourceUrl || "https://gall.dcinside.com/",
    },
    signal: AbortSignal.timeout(ARTICLE_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length <= 0 || bytes.length > EMBED_IMAGE_MAX_BYTES) {
    throw new Error(`image size ${bytes.length} bytes`);
  }

  const mimeType = detectImageMimeType(bytes, response.headers.get("content-type"));
  if (!mimeType) throw new Error("unsupported image type");
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function detectImageMimeType(bytes, contentType) {
  const normalized = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (normalized.startsWith("image/")) return normalized;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a") {
    return "image/gif";
  }
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return "";
}

function extractCellText(row, className) {
  const pattern = new RegExp(`<td\\b[^>]*class=["'][^"']*${escapeRegExp(className)}[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`, "i");
  return stripHtml(String(row || "").match(pattern)?.[1] || "");
}

function pickLargestThumbnail(thumbnails) {
  const list = Array.isArray(thumbnails) ? thumbnails : [];
  const best = list
    .filter((item) => isHttpUrl(item?.url))
    .sort((a, b) => toNumber(b.width) * toNumber(b.height) - toNumber(a.width) * toNumber(a.height))[0];
  return best?.url || "";
}

function parseKoreanDate(value) {
  const text = stripHtml(value).replace(/<!--[\s\S]*?-->/g, "").trim();
  const now = new Date();

  const relative = text.match(/(\d+)\s*(분|시간|일)\s*전/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const date = new Date(now);
    if (unit === "분") date.setMinutes(date.getMinutes() - amount);
    if (unit === "시간") date.setHours(date.getHours() - amount);
    if (unit === "일") date.setDate(date.getDate() - amount);
    return date.toISOString();
  }

  const fullDateTime = text.match(/(20\d{2})[-.](\d{1,2})[-.](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (fullDateTime) {
    return new Date(
      Number(fullDateTime[1]),
      Number(fullDateTime[2]) - 1,
      Number(fullDateTime[3]),
      Number(fullDateTime[4]),
      Number(fullDateTime[5]),
      Number(fullDateTime[6] || 0)
    ).toISOString();
  }

  const shortDate = text.match(/(\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (shortDate) {
    return new Date(2000 + Number(shortDate[1]), Number(shortDate[2]) - 1, Number(shortDate[3])).toISOString();
  }

  const fullDate = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (fullDate) {
    return new Date(Number(fullDate[1]), Number(fullDate[2]) - 1, Number(fullDate[3])).toISOString();
  }

  const time = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (time) {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Number(time[1]),
      Number(time[2]),
      Number(time[3] || 0)
    ).toISOString();
  }

  return new Date().toISOString();
}

function normalizeImageUrl(value, baseUrl) {
  const raw = String(value || "").replace(/&amp;/g, "&").trim();
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (isHttpUrl(raw)) return raw;
  if (baseUrl) {
    try {
      return new URL(raw, baseUrl).toString();
    } catch {
      return "";
    }
  }
  return "";
}

function normalizeChzzkThumbnail(value) {
  const imageUrl = normalizeImageUrl(value, "https://chzzk.naver.com/");
  if (!imageUrl) return "";
  return imageUrl.replace(/\{type\}/g, "480");
}

function normalizeTwitchThumbnail(value) {
  const imageUrl = normalizeImageUrl(value, "https://www.twitch.tv/");
  if (!imageUrl) return "";
  return imageUrl.replace(/\{width\}/g, "640").replace(/\{height\}/g, "360");
}

function dedupeYoutubeSearchItems(items) {
  const seen = new Set();
  const result = [];

  for (const item of items || []) {
    const videoId = item?.id?.videoId;
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    result.push(item);
  }

  return result;
}

function inferYoutubeBoardName(query, title, fallback) {
  const text = `${query || ""} ${title || ""}`.toLowerCase();
  if (MEDIA_CATEGORY_RULES.music.some((keyword) => text.includes(keyword.toLowerCase()))) return "음악";
  if (MEDIA_CATEGORY_RULES.game.some((keyword) => text.includes(keyword.toLowerCase()))) return "게임";
  return fallback || "LIVE";
}

function getYoutubeVideoCategoryId(query) {
  const text = String(query || "").toLowerCase();
  if (MEDIA_CATEGORY_RULES.music.some((keyword) => text.includes(keyword.toLowerCase()))) return "10";
  if (MEDIA_CATEGORY_RULES.game.some((keyword) => text.includes(keyword.toLowerCase()))) return "20";
  return "";
}

function classifyMediaCategory(item) {
  const sourceText = [
    item.mediaCategory,
    item.boardName,
    item.categoryName,
    item.liveCategoryValue,
    item.gameName,
    item.title,
    item.channelName,
    ...(Array.isArray(item.tags) ? item.tags : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const keyword of MEDIA_CATEGORY_RULES.music) {
    if (sourceText.includes(keyword.toLowerCase())) return "music";
  }

  if (item.sourceKey === "chzzkLive" && String(item.boardName || "").toUpperCase() === "GAME") return "game";
  for (const keyword of MEDIA_CATEGORY_RULES.game) {
    if (sourceText.includes(keyword.toLowerCase())) return "game";
  }

  for (const keyword of MEDIA_CATEGORY_RULES.chat) {
    if (sourceText.includes(keyword.toLowerCase())) return "chat";
  }

  return "chat";
}

function selectMediaTopItems(items) {
  const sortedItems = items.slice().sort(compareLiveTrendItems);
  const selected = [];
  for (const item of sortedItems) {
    if (isTwitchItem(item) && selected.filter(isTwitchItem).length >= TWITCH_MIN_ITEMS_PER_MEDIA_FEED) continue;
    if (isYoutubeItem(item) && selected.filter(isYoutubeItem).length >= YOUTUBE_MIN_ITEMS_PER_MEDIA_FEED) continue;
    selected.push(item);
    if (selected.length >= MAX_ITEMS) break;
  }

  const twitchItems = sortedItems.filter(isTwitchItem).slice(0, Math.min(TWITCH_MIN_ITEMS_PER_MEDIA_FEED, MAX_ITEMS));
  const youtubeItems = sortedItems.filter(isYoutubeItem).slice(0, Math.min(YOUTUBE_MIN_ITEMS_PER_MEDIA_FEED, MAX_ITEMS));

  for (const twitch of twitchItems) {
    ensureMediaPlatformItem(selected, twitch, (item) => !isTwitchItem(item) && !isYoutubeItem(item));
  }

  for (const youtube of youtubeItems) {
    ensureMediaPlatformItem(selected, youtube, (item) => !isYoutubeItem(item) && !isTwitchItem(item));
  }

  return dedupeItems(selected)
    .sort(compareLiveTrendItems)
    .filter((item, index, list) => {
      if (!isYoutubeItem(item)) return true;
      return list.slice(0, index + 1).filter(isYoutubeItem).length <= YOUTUBE_MIN_ITEMS_PER_MEDIA_FEED;
    })
    .slice(0, MAX_ITEMS);
}

function ensureMediaPlatformItem(selected, platformItem, canReplace) {
  if (selected.some((item) => normalizeDedupeKey(item) === normalizeDedupeKey(platformItem))) return;

  if (selected.length < MAX_ITEMS) {
    selected.push(platformItem);
    return;
  }

  let replaceIndex = findLastReplaceableIndex(selected, canReplace);
  if (replaceIndex < 0) replaceIndex = selected.length - 1;
  selected[replaceIndex] = platformItem;
}

function findLastReplaceableIndex(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}

function isTwitchItem(item) {
  const values = [
    item.source,
    item.platformName,
    item.siteName,
    item.sourceKey,
    item.link,
    item.sourceUrl,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return values.includes("트위치") || values.includes("twitch");
}

function isYoutubeItem(item) {
  const values = [
    item.source,
    item.platformName,
    item.siteName,
    item.sourceKey,
    item.link,
    item.sourceUrl,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return values.includes("유튜브") || values.includes("youtube") || values.includes("youtu.be");
}

function absolutizeUrl(value, baseUrl) {
  const raw = decodeEntities(String(value || "").trim());
  if (!raw || raw.startsWith("javascript:")) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (isHttpUrl(raw)) return raw;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return "";
  }
}

function dedupeItems(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = normalizeDedupeKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function normalizeDedupeKey(item) {
  if (item.link) {
    try {
      const url = new URL(item.link);
      url.hash = "";
      return url.toString();
    } catch {
      // Fall through to title-based key.
    }
  }

  return stripHtml(item.title || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .slice(0, 80);
}

function normalizeRank(value) {
  const rank = toNumber(value);
  return rank > 0 ? rank : Number.MAX_SAFE_INTEGER;
}

function stripHtml(value) {
  return decodeEntities(String(value || ""))
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCafeName(value) {
  return stripHtml(value)
    .replace(/^카페명\s*/i, "")
    .replace(/^[`'"\u2018\u2019\u201c\u201d]+|[`'"\u2018\u2019\u201c\u201d]+$/g, "");
}

function decodeEntities(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] || entity);
}

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isDataImageUrl(value) {
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/]+=*$/i.test(String(value || ""));
}

function isDisplayableImage(value) {
  return isHttpUrl(value) || isDataImageUrl(value);
}

function parseCount(value) {
  const normalized = String(value || "")
    .replace(/[^\d.,만천kK]/g, "")
    .replace(/,/g, "")
    .trim();

  if (!normalized) return 0;

  const korean = normalized.match(/^([\d.]+)(만|천)$/);
  if (korean) {
    const unit = korean[2] === "만" ? 10000 : 1000;
    return Math.round(Number(korean[1]) * unit);
  }

  const englishK = normalized.match(/^([\d.]+)[kK]$/);
  if (englishK) return Math.round(Number(englishK[1]) * 1000);

  return toNumber(normalized);
}

function ageInHours(isoDate) {
  const time = Date.parse(isoDate || "");
  if (Number.isNaN(time)) return 24;
  return Math.max(0, (Date.now() - time) / (60 * 60 * 1000));
}

function summarize(categoriesData) {
  return Object.fromEntries(
    Object.entries(categoriesData)
      .filter(([, items]) => Array.isArray(items))
      .map(([key, items]) => [
        key,
        {
          count: items.length,
          images: items.filter((item) => isDisplayableImage(item.img)).length,
          maxViewCount: Math.max(...items.map((item) => item.viewCount || item.readCount || 0), 0),
          maxRecommendCount: Math.max(...items.map((item) => item.recommendCount || item.likeCount || 0), 0),
          sampleTitle: items[0]?.title || null,
          sampleSource: items[0]?.source || null,
          newestPublishedAt: newestPublishedAt(items),
          oldestPublishedAt: oldestPublishedAt(items),
        },
      ])
  );
}

function newestPublishedAt(items) {
  return pickPublishedAt(items, "newest");
}

function oldestPublishedAt(items) {
  return pickPublishedAt(items, "oldest");
}

function pickPublishedAt(items, mode) {
  const dates = items
    .map((item) => item.publishedAt)
    .filter((value) => !Number.isNaN(Date.parse(value || "")))
    .sort((a, b) => Date.parse(a) - Date.parse(b));

  if (dates.length === 0) return null;
  return mode === "newest" ? dates[dates.length - 1] : dates[0];
}

function buildFirebaseUrl(rawUrl, authToken) {
  const safeUrl = rawUrl.endsWith(".json")
    ? rawUrl
    : `${rawUrl.replace(/\/+$/, "")}/categories.json`;
  const url = new URL(safeUrl);

  if (authToken && !url.searchParams.has("auth")) {
    url.searchParams.set("auth", authToken);
  }

  return url.toString();
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function formatCountKo(value) {
  const number = toNumber(value);
  if (number >= 10000) {
    const compact = Math.round((number / 10000) * 10) / 10;
    return `${compact}만`;
  }
  return number.toLocaleString("ko-KR");
}

function uniqueCompact(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toPositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function parseListEnv(value, fallback) {
  const items = String(value || "")
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

startRobot().catch((error) => {
  console.error("[치명적 오류]", error);
  process.exit(1);
});
