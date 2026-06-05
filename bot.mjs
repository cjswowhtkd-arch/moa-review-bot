// [bot.mjs] TOP 20 multi-source trend collector with article thumbnail extraction.
// Node 18+ required because this script uses the built-in fetch API.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(SCRIPT_DIR, ".env"));

const DEFAULT_FIREBASE_DB_URL =
  "https://chosanghee00001-default-rtdb.firebaseio.com/categories.json";

const MAX_ITEMS = toPositiveInt(process.env.MAX_ITEMS_PER_CATEGORY, 20);
const SOURCE_ITEM_LIMIT = toPositiveInt(process.env.SOURCE_ITEM_LIMIT, 12);
const ARTICLE_POOL_SIZE = Math.max(MAX_ITEMS * 4, 80);
const SOURCE_CONCURRENCY = toPositiveInt(process.env.SOURCE_CONCURRENCY, 6);
const ARTICLE_CONCURRENCY = toPositiveInt(process.env.ARTICLE_CONCURRENCY, 6);
const CATEGORY_CONCURRENCY = toPositiveInt(process.env.CATEGORY_CONCURRENCY, 2);
const HTTP_TIMEOUT_MS = toPositiveInt(process.env.HTTP_TIMEOUT_MS, 9000);
const ARTICLE_TIMEOUT_MS = toPositiveInt(process.env.ARTICLE_TIMEOUT_MS, 6500);
const ENABLE_DAUM_HTML = process.env.ENABLE_DAUM_HTML !== "0";
const RECENCY_HOURS = toPositiveInt(process.env.RECENCY_HOURS, 48);
const STRICT_RECENCY = process.env.STRICT_RECENCY !== "0";
const PREFER_NAVER_LINKS = process.env.PREFER_NAVER_LINKS !== "0";
const RECENCY_CUTOFF_MS = Date.now() - RECENCY_HOURS * 60 * 60 * 1000;
const GOOGLE_RECENCY_DAYS = Math.max(1, Math.ceil(RECENCY_HOURS / 24));
const DRY_RUN = process.env.DRY_RUN === "1";

const USER_AGENT =
  process.env.TREND_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36 MoaReviewTrendBot/2.0";

const FALLBACK_IMAGES = {
  drama:
    "https://images.unsplash.com/photo-1598899134739-24c46f58b8c0?auto=format&fit=crop&w=900&q=80",
  tech:
    "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80",
  dessert:
    "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=80",
  news:
    "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=900&q=80",
  stock:
    "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?auto=format&fit=crop&w=900&q=80",
};

const CATEGORIES = [
  {
    key: "drama",
    label: "드라마/웹툰",
    queries: [
      "오늘 드라마 웹툰 화제",
      "최신 한국 드라마 OTT 공개",
      "웹툰 신작 오늘 공개",
      "넷플릭스 티빙 디즈니플러스 드라마 최신",
      "네이버웹툰 카카오웹툰 최신 화제",
      "드라마 시청률 오늘",
      "OTT 순위 드라마 오늘",
      "웹툰 원작 드라마 최신",
    ],
    terms: ["드라마", "웹툰", "신작", "라인업", "OTT", "넷플릭스", "티빙"],
  },
  {
    key: "tech",
    label: "IT/테크",
    queries: [
      "오늘 IT 테크 최신 뉴스",
      "AI 반도체 스마트폰 오늘",
      "전자제품 신제품 출시 최신",
      "테크 기업 발표 오늘",
      "국내 IT 업계 실시간",
      "삼성 애플 구글 AI 최신",
      "노트북 스마트폰 신제품 오늘",
      "테크 트렌드 화제",
    ],
    terms: ["IT", "테크", "AI", "반도체", "스마트폰", "신제품", "전자"],
  },
  {
    key: "dessert",
    label: "디저트 핫플",
    queries: [
      "오늘 서울 카페 디저트 핫플",
      "성수동 신상 카페 오픈",
      "서울 디저트 맛집 최신",
      "카페 디저트 오늘 화제",
      "베이커리 디저트 신상",
      "핫플 카페 팝업 오늘",
      "성수 연남 한남 카페 최신",
      "디저트 브랜드 신메뉴 오늘",
      "스타벅스 투썸 메가커피 신메뉴",
      "서울 신상 맛집 카페 오늘",
      "성수 팝업스토어 카페",
      "디저트 카페 트렌드 최신",
      "유명 디저트 브랜드 출시",
      "백화점 디저트 팝업 오늘",
    ],
    terms: ["성수", "카페", "디저트", "맛집", "핫플", "베이커리"],
  },
  {
    key: "news",
    label: "주요 종합뉴스",
    queries: [
      "정치 사회 경제 실시간 주요 뉴스",
      "오늘 주요 뉴스 속보",
      "경제 사회 정치 오늘 이슈",
      "국내 주요 뉴스 오늘 종합",
      "국제 경제 사회 최신 뉴스",
      "오늘 많이 본 뉴스",
      "실시간 이슈 속보",
      "한국 주요 뉴스 최신",
    ],
    terms: ["정치", "사회", "경제", "주요", "뉴스", "속보", "국내"],
  },
  {
    key: "stock",
    label: "증시 특징주",
    queries: [
      "오늘 국내 주식 증시 특징주",
      "코스피 코스닥 특징주 오늘",
      "국내 증시 실시간 특징주",
      "증권가 오늘 실적 주가",
      "금융 시장 주식 최신 뉴스",
      "상한가 급등주 오늘",
      "코스피 코스닥 마감 오늘",
      "증권사 리포트 오늘",
    ],
    terms: ["주식", "증시", "특징주", "코스피", "코스닥", "금융", "증권"],
  },
];

async function fetchCategoryTrends(category) {
  console.log(`\n[${category.label}] 후보 수집 시작`);

  const sourceJobs = [];
  for (const query of category.queries) {
    if (process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) {
      sourceJobs.push(() => fetchNaverNews(query, category));
    }

    sourceJobs.push(() => fetchGoogleNews(query, category));

    if (process.env.KAKAO_REST_API_KEY) {
      sourceJobs.push(() => fetchKakaoDaumSearch(query, category));
    }

    if (ENABLE_DAUM_HTML) {
      sourceJobs.push(() => fetchDaumNewsHtml(query, category));
    }
  }

  const sourceResults = await mapLimit(sourceJobs, SOURCE_CONCURRENCY, (job) =>
    job().catch((error) => {
      console.warn(`  - 소스 수집 실패: ${error.message}`);
      return [];
    })
  );

  const candidates = sourceResults.flat();
  const freshCandidates = STRICT_RECENCY
    ? candidates.filter((item) => isFreshCandidate(item))
    : candidates;
  const merged = mergeCandidates(freshCandidates, category)
    .map((item) => ({ ...item, score: scoreCandidate(item, category) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, ARTICLE_POOL_SIZE);

  console.log(
    `  - 원본 후보 ${candidates.length}개, ${RECENCY_HOURS}시간 이내 ${freshCandidates.length}개, 중복 정리 후 ${merged.length}개`
  );

  const hydrated = await mapLimit(
    merged,
    ARTICLE_CONCURRENCY,
    (candidate) => hydrateArticle(candidate, category)
  );

  const freshHydrated = hydrated.filter((item) =>
    item && (!STRICT_RECENCY || isFreshCandidate(item))
  );

  const sortedHydrated = freshHydrated
    .map((item) => ({ ...item, score: scoreCandidate(item, category) }))
    .sort((a, b) => b.score - a.score);

  const naverHydrated = sortedHydrated.filter((item) =>
    (item.sourceKinds || []).includes("naver")
  );
  const imagePreferred =
    naverHydrated.length >= MAX_ITEMS
      ? naverHydrated
      : sortedHydrated.filter((item) => item.thumbnailSource !== "fallback").length >= MAX_ITEMS
        ? sortedHydrated.filter((item) => item.thumbnailSource !== "fallback")
        : sortedHydrated;

  const finalItems = imagePreferred
    .slice(0, MAX_ITEMS)
    .map((item, index) => {
      const outputLink =
        PREFER_NAVER_LINKS && !isNaverUrl(item.link)
          ? buildNaverNewsSearchUrl(item.title)
          : item.link;
      const outputSource = isNaverUrl(outputLink) ? "네이버 뉴스" : item.primarySource;
      const outputSources = uniqueCompact([outputSource, ...item.sourceNames]);
      const outputItem = {
        ...item,
        link: outputLink,
        primarySource: outputSource,
        sourceNames: outputSources,
      };

      return {
        rank: index + 1,
        title: item.title,
        content: buildContent(outputItem),
        link: outputLink,
        img: item.img || FALLBACK_IMAGES[category.key],
        source: outputSource,
        sources: outputSources,
        sourceCount: outputSources.length,
        sourceKinds: item.sourceKinds,
        publishedAt: item.publishedAt || null,
        thumbnailSource: item.thumbnailSource || "fallback",
      };
    });

  const staleCount = finalItems.filter((item) => !isFreshCandidate(item)).length;
  console.log(
    `  - 최종 저장 ${finalItems.length}/${MAX_ITEMS}개` +
      (staleCount ? `, 오래된 항목 ${staleCount}개 제외 필요` : "")
  );
  return finalItems;
}

async function fetchGoogleNews(query, category) {
  const recencyQuery = `${query} when:${GOOGLE_RECENCY_DAYS}d`;
  const url =
    "https://news.google.com/rss/search?" +
    new URLSearchParams({
      q: recencyQuery,
      hl: "ko",
      gl: "KR",
      ceid: "KR:ko",
    });

  const { text } = await fetchText(url);
  return parseRssItems(text).slice(0, SOURCE_ITEM_LIMIT).map((item) =>
    createCandidate({
      ...item,
      link: decodeGoogleNewsUrl(item.link) || item.link,
      query,
      category,
      sourceKind: "google",
      sourceName: item.sourceName || "Google News",
      primarySource: item.sourceName || "Google News",
    })
  );
}

async function fetchNaverNews(query, category) {
  const url =
    "https://openapi.naver.com/v1/search/news.json?" +
    new URLSearchParams({
      query,
      display: String(SOURCE_ITEM_LIMIT),
      start: "1",
      sort: "date",
    });

  const { json } = await fetchJson(url, {
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET,
    },
  });

  return (json.items || []).map((item) => {
    const naverLink = isNaverUrl(item.link)
      ? item.link
      : buildNaverNewsSearchUrl(cleanTitle(item.title));
    const crawlLink = item.originallink || item.link || naverLink;
    return createCandidate({
      title: item.title,
      description: item.description,
      link: naverLink,
      crawlLink,
      publishedAt: item.pubDate,
      query,
      category,
      sourceKind: "naver",
      sourceName: "네이버 뉴스",
      primarySource: "네이버 뉴스",
    });
  });
}

async function fetchKakaoDaumSearch(query, category) {
  const url =
    "https://dapi.kakao.com/v2/search/web?" +
    new URLSearchParams({
      query,
      sort: "recency",
      size: String(Math.min(SOURCE_ITEM_LIMIT, 50)),
    });

  const { json } = await fetchJson(url, {
    headers: {
      Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}`,
    },
  });

  return (json.documents || [])
    .filter((item) => isLikelyNewsUrl(item.url) || hasCategoryTerm(item.title, category))
    .map((item) =>
      createCandidate({
        title: item.title,
        description: item.contents,
        link: item.url,
        publishedAt: item.datetime,
        query,
        category,
        sourceKind: "kakao",
        sourceName: guessSourceName(item.url) || "Kakao/Daum Search",
        primarySource: guessSourceName(item.url) || "Kakao/Daum",
      })
    );
}

async function fetchDaumNewsHtml(query, category) {
  const url =
    "https://search.daum.net/search?" +
    new URLSearchParams({
      w: "news",
      q: query,
      sort: "recency",
      enc: "utf8",
    });

  const { text } = await fetchText(url);
  const items = [];
  const seen = new Set();

  for (const match of text.matchAll(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const link = normalizeUrlWithBase(match[2], "https://search.daum.net");
    const title = stripHtml(match[3]);
    const nearbyHtml = text.slice(Math.max(0, match.index - 600), match.index + 1800);
    const publishedAt = extractDateFromSearchHtml(nearbyHtml);
    const key = canonicalUrl(link);

    if (!title || title.length < 8 || seen.has(key) || !isLikelyNewsUrl(link)) {
      continue;
    }

    if (STRICT_RECENCY && !isFreshPublishedAt(publishedAt)) {
      continue;
    }

    seen.add(key);
    items.push(
      createCandidate({
        title,
        description: "",
        link,
        publishedAt,
        query,
        category,
        sourceKind: "daum_html",
        sourceName: guessSourceName(link) || "Daum News",
        primarySource: guessSourceName(link) || "Daum",
      })
    );

    if (items.length >= SOURCE_ITEM_LIMIT) break;
  }

  return items;
}

async function hydrateArticle(candidate, category) {
  const fallback = FALLBACK_IMAGES[category.key];
  const directUrl = await resolveDirectArticleUrl(candidate);

  let pageResult = null;
  try {
    pageResult = await extractThumbnailFromArticle(directUrl, fallback);
  } catch (error) {
    pageResult = null;
  }

  const keepNaverLink = (candidate.sourceKinds || []).includes("naver");
  const link = keepNaverLink ? candidate.link : pageResult?.finalUrl || directUrl;
  const img =
    pageResult?.img ||
    candidate.feedImage ||
    extractImageFromHtml(candidate.description || "", link) ||
    fallback;

  return {
    ...candidate,
    link,
    img,
    thumbnailSource: pageResult?.source || (candidate.feedImage ? "feed" : "fallback"),
  };
}

async function extractThumbnailFromArticle(url, fallback) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { img: fallback, finalUrl: url, source: "fallback" };
  }

  const { text, finalUrl } = await fetchText(url, { timeoutMs: ARTICLE_TIMEOUT_MS });
  const baseUrl = finalUrl || url;
  const images = extractArticleImages(text, baseUrl);

  if (images.length > 0) {
    return { img: images[0], finalUrl: baseUrl, source: "article-first-image" };
  }

  const metaImage = extractMetaImage(text, baseUrl);
  if (metaImage) {
    return { img: metaImage, finalUrl: baseUrl, source: "og-image" };
  }

  return { img: fallback, finalUrl: baseUrl, source: "fallback" };
}

async function resolveDirectArticleUrl(candidate) {
  const rawLink = candidate.crawlLink || candidate.link;
  const decodedUrl = decodeGoogleNewsUrl(rawLink) || rawLink;
  if ((candidate.sourceKinds || []).includes("naver")) return decodedUrl;
  if (!isGoogleNewsUrl(decodedUrl)) return decodedUrl;

  if (ENABLE_DAUM_HTML) {
    const daumUrl = await findDaumDirectArticleUrl(candidate.title, candidate.primarySource);
    if (daumUrl) return daumUrl;
  }

  return decodedUrl;
}

async function findDaumDirectArticleUrl(title, sourceName) {
  const query = [title, sourceName].filter(Boolean).join(" ");
  const url =
    "https://search.daum.net/search?" +
    new URLSearchParams({
      w: "news",
      q: query,
      sort: "recency",
      enc: "utf8",
    });

  try {
    const { text } = await fetchText(url, { timeoutMs: HTTP_TIMEOUT_MS });
    const matches = [];

    for (const match of text.matchAll(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
      const link = normalizeUrlWithBase(match[2], "https://search.daum.net");
      const linkTitle = stripHtml(match[3]);
      if (!link || !linkTitle || !isLikelyNewsUrl(link)) continue;

      const similarity = titleSimilarity(title, linkTitle);
      const sourceBonus = sourceName && guessSourceName(link).includes(sourceName) ? 0.2 : 0;
      if (similarity + sourceBonus >= 0.45) {
        matches.push({ link, score: similarity + sourceBonus });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches[0]?.link || "";
  } catch {
    return "";
  }
}

function parseRssItems(xmlText) {
  const items = [];

  for (const match of xmlText.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const itemContent = match[1];
    const descriptionRaw = getTagRaw(itemContent, "description");
    const descriptionHtml = decodeDeep(descriptionRaw);
    const sourceRaw = getTagRaw(itemContent, "source");
    const sourceUrl = itemContent.match(/<source\b[^>]*url=(["'])(.*?)\1/i)?.[2] || "";

    items.push({
      title: getTagText(itemContent, "title").split(" - ")[0],
      link: getTagText(itemContent, "link"),
      description: stripHtml(descriptionHtml),
      feedImage: extractImageFromHtml(descriptionHtml, sourceUrl || "https://news.google.com"),
      publishedAt: getTagText(itemContent, "pubDate"),
      sourceName: stripHtml(sourceRaw),
    });
  }

  return items;
}

function createCandidate(input) {
  const link = normalizeUrl(input.link);
  const title = cleanTitle(input.title);

  if (!title || !link) return null;

  return {
    title,
    description: stripHtml(input.description || ""),
    link,
    crawlLink: normalizeUrl(input.crawlLink || ""),
    feedImage: normalizeImageUrl(input.feedImage || "", link),
    publishedAt: input.publishedAt || null,
    query: input.query,
    sourceKind: input.sourceKind,
    primarySource: input.primarySource || input.sourceName || input.sourceKind,
    sourceNames: uniqueCompact([input.sourceName || input.primarySource || input.sourceKind]),
    sourceKinds: uniqueCompact([input.sourceKind]),
  };
}

function mergeCandidates(candidates, category) {
  const merged = [];
  const byUrl = new Map();
  const byTitle = new Map();

  for (const candidate of candidates.filter(Boolean)) {
    const titleKey = normalizeTitleKey(candidate.title);
    const urlKey = canonicalUrl(candidate.link);
    const existing = byUrl.get(urlKey) || byTitle.get(titleKey);

    if (existing) {
      existing.sourceNames = uniqueCompact([...existing.sourceNames, ...candidate.sourceNames]);
      existing.sourceKinds = uniqueCompact([...existing.sourceKinds, ...candidate.sourceKinds]);
      if (shouldPreferCandidateLink(existing, candidate)) {
        existing.link = candidate.link;
        existing.crawlLink = candidate.crawlLink || existing.crawlLink;
        existing.primarySource = candidate.primarySource || existing.primarySource;
        existing.sourceNames = uniqueCompact([...candidate.sourceNames, ...existing.sourceNames]);
      }
      existing.feedImage = existing.feedImage || candidate.feedImage;
      existing.description = longerText(existing.description, candidate.description);
      existing.publishedAt = newestDate(existing.publishedAt, candidate.publishedAt);
      if (hasCategoryTerm(candidate.title, category) && candidate.title.length > existing.title.length) {
        existing.title = candidate.title;
      }
      continue;
    }

    merged.push(candidate);
    byUrl.set(urlKey, candidate);
    byTitle.set(titleKey, candidate);
  }

  return merged;
}

function scoreCandidate(item, category) {
  let score = 0;

  const sourceKindScore = {
    google: 10,
    naver: 42,
    kakao: 11,
    daum_html: 8,
  };

  for (const sourceKind of item.sourceKinds || []) {
    score += sourceKindScore[sourceKind] || 5;
  }

  score += Math.min(item.sourceNames?.length || 1, 5) * 7;
  score += sourceAuthorityScore(item);
  score += recencyScore(item.publishedAt);
  score += relevanceScore(`${item.title} ${item.description}`, category.terms);
  score += item.img || item.feedImage ? 3 : 0;

  if ((item.sourceKinds || []).includes("naver")) score += 28;
  if (!isGoogleNewsUrl(item.link)) score += 12;
  if (item.thumbnailSource === "article-first-image") score += 22;
  if (item.thumbnailSource === "og-image") score += 10;
  if (item.thumbnailSource === "fallback") score -= 30;

  return Math.round(score);
}

function sourceAuthorityScore(item) {
  const text = `${item.primarySource || ""} ${(item.sourceNames || []).join(" ")} ${item.link}`;
  const rules = [
    [/연합뉴스|yna\.co\.kr/i, 22],
    [/\bKBS\b|\bMBC\b|\bSBS\b|YTN|JTBC|EBS|채널A|MBN|TV조선/i, 18],
    [/조선일보|중앙일보|동아일보|한겨레|경향신문|한국일보|서울신문/i, 16],
    [/매일경제|한국경제|머니투데이|이데일리|서울경제|아시아경제|파이낸셜뉴스/i, 15],
    [/ZDNet|지디넷|전자신문|디지털데일리|블로터|IT조선|테크/i, 13],
    [/네이버|다음|카카오|Google News/i, 6],
  ];

  for (const [pattern, value] of rules) {
    if (pattern.test(text)) return value;
  }

  return 8;
}

function isFreshCandidate(item) {
  return isFreshPublishedAt(item?.publishedAt);
}

function isFreshPublishedAt(value) {
  const time = Date.parse(value || "");
  if (Number.isNaN(time)) return false;
  return time >= RECENCY_CUTOFF_MS && time <= Date.now() + 60 * 60 * 1000;
}

function extractDateFromSearchHtml(html) {
  const text = stripHtml(html);
  const now = new Date();

  const minuteMatch = text.match(/(\d{1,3})\s*분\s*전/);
  if (minuteMatch) {
    return new Date(Date.now() - Number(minuteMatch[1]) * 60 * 1000).toISOString();
  }

  const hourMatch = text.match(/(\d{1,3})\s*시간\s*전/);
  if (hourMatch) {
    return new Date(Date.now() - Number(hourMatch[1]) * 60 * 60 * 1000).toISOString();
  }

  const dayMatch = text.match(/(\d{1,2})\s*일\s*전/);
  if (dayMatch) {
    return new Date(Date.now() - Number(dayMatch[1]) * 24 * 60 * 60 * 1000).toISOString();
  }

  const fullDateMatch = text.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (fullDateMatch) {
    return new Date(
      Number(fullDateMatch[1]),
      Number(fullDateMatch[2]) - 1,
      Number(fullDateMatch[3])
    ).toISOString();
  }

  const monthDayMatch = text.match(/(?:^|\s)(\d{1,2})[.월\s]+(\d{1,2})(?:일)?(?:\s|$)/);
  if (monthDayMatch) {
    const date = new Date(
      now.getFullYear(),
      Number(monthDayMatch[1]) - 1,
      Number(monthDayMatch[2])
    );
    return date.toISOString();
  }

  return "";
}

function recencyScore(value) {
  const time = Date.parse(value || "");
  if (Number.isNaN(time)) return STRICT_RECENCY ? -100 : 3;

  const ageHours = (Date.now() - time) / 36e5;
  if (STRICT_RECENCY && ageHours > RECENCY_HOURS) return -100;
  if (ageHours <= 1) return 32;
  if (ageHours <= 3) return 28;
  if (ageHours <= 6) return 18;
  if (ageHours <= 24) return 15;
  if (ageHours <= 48) return 12;
  if (ageHours <= 72) return 4;
  if (ageHours <= 168) return 1;
  return 2;
}

function relevanceScore(text, terms) {
  const haystack = normalizeSearchText(text);
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(normalizeSearchText(term))) score += 4;
  }
  return Math.min(score, 24);
}

function buildContent(item) {
  const sourceList = uniqueCompact([item.primarySource, ...(item.sourceNames || [])]);
  const sources = sourceList.slice(0, 3).join(", ") || "뉴스 소스";
  const sourceMore = sourceList.length > 3 ? ` 외 ${sourceList.length - 3}곳` : "";
  const dateText = item.publishedAt
    ? new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Seoul",
      }).format(new Date(item.publishedAt))
    : "실시간";
  return `최근 ${RECENCY_HOURS}시간 기준 · ${sources}${sourceMore}에서 선별했습니다. 게시 기준: ${dateText}.`;
}

function extractArticleImages(html, baseUrl) {
  const candidates = [];
  const figureBlocks = [...html.matchAll(/<figure\b[\s\S]*?<\/figure>/gi)].map((m) => m[0]);
  const articleBlocks = [...html.matchAll(/<(article|main)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);

  for (const block of [...figureBlocks, ...articleBlocks]) {
    candidates.push(...extractImagesFromBlock(block, baseUrl));
  }

  if (candidates.length === 0) {
    candidates.push(...extractImagesFromBlock(html, baseUrl));
  }

  return uniqueCompact(candidates).filter(isUsableImageUrl);
}

function extractImagesFromBlock(html, baseUrl) {
  const images = [];

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const imageUrl = pickImageUrl(attrs, baseUrl);
    const width = toPositiveInt(attrs.width, 0);
    const height = toPositiveInt(attrs.height, 0);

    if ((width && width < 100) || (height && height < 80)) continue;
    if (imageUrl) images.push(imageUrl);
  }

  return images;
}

function extractMetaImage(html, baseUrl) {
  const metaNames = new Set([
    "og:image",
    "og:image:url",
    "twitter:image",
    "twitter:image:src",
    "thumbnail",
  ]);

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (metaNames.has(key) && attrs.content) {
      const imageUrl = normalizeImageUrl(attrs.content, baseUrl);
      if (isUsableImageUrl(imageUrl)) return imageUrl;
    }
  }

  return "";
}

function extractImageFromHtml(html, baseUrl) {
  const image = extractImagesFromBlock(decodeDeep(html || ""), baseUrl).find(isUsableImageUrl);
  return image || extractMetaImage(html || "", baseUrl);
}

function pickImageUrl(attrs, baseUrl) {
  const directAttributes = [
    "src",
    "data-src",
    "data-original",
    "data-lazy-src",
    "data-url",
    "data-image",
    "data-img-src",
  ];

  for (const name of directAttributes) {
    const value = normalizeImageUrl(attrs[name] || "", baseUrl);
    if (value) return value;
  }

  return pickFromSrcset(attrs.srcset || attrs["data-srcset"] || "", baseUrl);
}

function pickFromSrcset(srcset, baseUrl) {
  if (!srcset) return "";

  const candidates = srcset
    .split(",")
    .map((part) => {
      const [rawUrl, rawSize] = part.trim().split(/\s+/);
      const size = Number.parseInt((rawSize || "").replace(/\D/g, ""), 10) || 0;
      return { url: normalizeImageUrl(rawUrl, baseUrl), size };
    })
    .filter((item) => item.url);

  candidates.sort((a, b) => b.size - a.size);
  return candidates[0]?.url || "";
}

function decodeGoogleNewsUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "news.google.com") return url;

    const match = parsed.pathname.match(/\/articles\/([^/?]+)/);
    if (!match) return url;

    const token = match[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const articleMatch = decoded.match(/https?:\/\/[^\u0000-\u001f\uFFFD\s"'<>]+/i);
    return articleMatch ? normalizeUrl(articleMatch[0]) : url;
  } catch {
    return url;
  }
}

function shouldPreferCandidateLink(existing, candidate) {
  const currentLink = existing?.link;
  const candidateLink = candidate?.link;
  if (!candidateLink) return false;
  if (!currentLink) return true;

  const existingIsNaver =
    (existing.sourceKinds || []).includes("naver") || isNaverNewsUrl(currentLink);
  const candidateIsNaver =
    (candidate.sourceKinds || []).includes("naver") || isNaverNewsUrl(candidateLink);

  if (candidateIsNaver && !existingIsNaver) return true;
  if (existingIsNaver && !candidateIsNaver) return false;
  if (isGoogleNewsUrl(currentLink) && !isGoogleNewsUrl(candidateLink)) return true;
  if (isGoogleNewsUrl(candidateLink)) return false;
  return false;
}

function isGoogleNewsUrl(value) {
  try {
    return new URL(value).hostname === "news.google.com";
  } catch {
    return false;
  }
}

function isNaverNewsUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes("news.naver.com") || host.includes("n.news.naver.com");
  } catch {
    return false;
  }
}

function isNaverUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase().includes("naver.com");
  } catch {
    return false;
  }
}

function buildNaverNewsSearchUrl(title) {
  return (
    "https://search.naver.com/search.naver?" +
    new URLSearchParams({
      where: "news",
      query: title,
      sort: "1",
    }).toString()
  );
}

async function startRobot() {
  console.log("TOP 1~20 실시간 멀티소스 트렌드 수집을 시작합니다.");
  console.log(
    `소스 상태: Google=ON, Naver=${process.env.NAVER_CLIENT_ID ? "ON" : "OFF"}, ` +
      `Kakao/Daum=${process.env.KAKAO_REST_API_KEY ? "ON" : "OFF"}, ` +
      `Daum HTML=${ENABLE_DAUM_HTML ? "ON" : "OFF"}, ` +
      `클릭 링크=${PREFER_NAVER_LINKS ? "네이버 우선" : "원문 우선"}, ` +
      `최신 기준=${RECENCY_HOURS}시간 이내${STRICT_RECENCY ? " 엄격 적용" : " 완화 적용"}`
  );

  const entries = await mapLimit(CATEGORIES, CATEGORY_CONCURRENCY, async (category) => [
    category.key,
    await fetchCategoryTrends(category),
  ]);

  const categoriesData = Object.fromEntries(entries);

  if (DRY_RUN) {
    console.log("\n[DRY_RUN] Firebase 전송 없이 수집 결과만 출력합니다.");
    if (process.env.DRY_RUN_SUMMARY === "1") {
      console.log(
        JSON.stringify(
          Object.fromEntries(
            Object.entries(categoriesData).map(([key, items]) => [
              key,
              {
                count: items.length,
                articleFirstImages: items.filter(
                  (item) => item.thumbnailSource === "article-first-image"
                ).length,
                fallbackImages: items.filter((item) => item.thumbnailSource === "fallback").length,
                staleItems: items.filter((item) => !isFreshCandidate(item)).length,
                naverWeightedItems: items.filter((item) =>
                  (item.sourceKinds || []).includes("naver")
                ).length,
                naverLinkItems: items.filter((item) => isNaverUrl(item.link)).length,
                newestPublishedAt: newestPublishedAt(items),
                oldestPublishedAt: oldestPublishedAt(items),
              },
            ])
          ),
          null,
          2
        )
      );
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

    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    console.log("\n[성공] TOP 20 멀티소스 데이터가 Firebase에 저장되었습니다.");
  } catch (error) {
    console.error("\n[실패] Firebase 전송 오류:", error.message);
    process.exitCode = 1;
  }
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      ...options,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.5",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    return { text, finalUrl: response.url };
  } finally {
    clearTimeout(timer);
  }
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

async function fetchJson(url, options = {}) {
  const { text, finalUrl } = await fetchText(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  return { json: JSON.parse(text), finalUrl };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await mapper(items[current], current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );

  return results;
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

function getTagRaw(xml, tagName) {
  return xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"))?.[1] || "";
}

function getTagText(xml, tagName) {
  return stripHtml(decodeDeep(getTagRaw(xml, tagName)));
}

function parseAttributes(tag) {
  const attrs = {};

  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[match[1].toLowerCase()] = decodeDeep(match[2] || match[3] || match[4] || "");
  }

  return attrs;
}

function cleanTitle(value) {
  return stripHtml(value)
    .replace(/\s+-\s+[^-]{2,30}$/g, "")
    .replace(/\[[^\]]{1,18}\]/g, "")
    .replace(/\([^)]{1,18}\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value) {
  return decodeDeep(String(value || ""))
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeDeep(value) {
  let output = String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

  for (let i = 0; i < 3; i++) {
    const decoded = decodeEntities(output);
    if (decoded === output) break;
    output = decoded;
  }

  return output;
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

function normalizeUrl(value) {
  const raw = decodeDeep(value || "").replace(/\\\//g, "/").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeUrlWithBase(value, baseUrl) {
  const raw = decodeDeep(value || "").replace(/\\\//g, "/").trim();
  if (!raw) return "";

  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return "";
  }
}

function normalizeImageUrl(value, baseUrl) {
  let raw = decodeDeep(value || "").replace(/\\\//g, "/").trim();
  if (!raw || /^data:|^blob:|^about:/i.test(raw)) return "";

  const embedded = raw.match(/https?:%2F%2F[^&"'<>]+/i)?.[0];
  if (embedded) raw = decodeURIComponent(embedded);

  try {
    if (raw.startsWith("//")) return `https:${raw}`;
    return new URL(raw, baseUrl || "https://example.com").toString();
  } catch {
    return "";
  }
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return `${url.hostname}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return normalizeTitleKey(value);
  }
}

function normalizeTitleKey(value) {
  return normalizeSearchText(value)
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 80);
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isUsableImageUrl(value) {
  if (!/^https?:\/\//i.test(value || "")) return false;

  const lower = value.toLowerCase();
  if (lower.includes("j6_cofbogxhri9im864nl_ligxvsqp2aupskei7z0cnnfdvgumwuy20nuuhkreqyrpy4beeibuc")) {
    return false;
  }
  if (/\.(svg|ico)(\?|#|$)/i.test(lower)) return false;
  if (/logo|favicon|sprite|spacer|blank|profile|avatar|icon|watermark/i.test(lower)) {
    return false;
  }

  return true;
}

function isLikelyNewsUrl(value) {
  if (!/^https?:\/\//i.test(value || "")) return false;

  try {
    const host = new URL(value).hostname.toLowerCase();
    const path = new URL(value).pathname.toLowerCase();
    return (
      host.includes("news") ||
      host.includes("v.daum.net") ||
      path.includes("/news") ||
      path.includes("/article") ||
      path.includes("/view") ||
      /\d{6,}/.test(path)
    );
  } catch {
    return false;
  }
}

function hasCategoryTerm(value, category) {
  const text = normalizeSearchText(stripHtml(value));
  return category.terms.some((term) => text.includes(normalizeSearchText(term)));
}

function guessSourceName(link) {
  try {
    const host = new URL(link).hostname.replace(/^www\./, "");
    const known = [
      ["yna.co.kr", "연합뉴스"],
      ["kbs.co.kr", "KBS"],
      ["imbc.com", "MBC"],
      ["mbc.co.kr", "MBC"],
      ["sbs.co.kr", "SBS"],
      ["ytn.co.kr", "YTN"],
      ["jtbc.co.kr", "JTBC"],
      ["chosun.com", "조선일보"],
      ["joongang.co.kr", "중앙일보"],
      ["donga.com", "동아일보"],
      ["hani.co.kr", "한겨레"],
      ["khan.co.kr", "경향신문"],
      ["hankyung.com", "한국경제"],
      ["mk.co.kr", "매일경제"],
      ["edaily.co.kr", "이데일리"],
      ["etnews.com", "전자신문"],
      ["zdnet.co.kr", "ZDNet Korea"],
      ["v.daum.net", "Daum News"],
      ["n.news.naver.com", "Naver News"],
    ];

    return known.find(([domain]) => host.includes(domain))?.[1] || host;
  } catch {
    return "";
  }
}

function titleSimilarity(a, b) {
  const left = significantTokens(a);
  const right = significantTokens(b);
  if (left.size === 0 || right.size === 0) return 0;

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap++;
  }

  return overlap / Math.min(left.size, right.size);
}

function significantTokens(value) {
  const stopWords = new Set(["뉴스", "단독", "속보", "종합", "영상", "포토"]);
  return new Set(
    normalizeSearchText(stripHtml(value))
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 2 && !stopWords.has(token))
      .slice(0, 16)
  );
}

function newestDate(a, b) {
  const timeA = Date.parse(a || "");
  const timeB = Date.parse(b || "");
  if (Number.isNaN(timeA)) return b || a;
  if (Number.isNaN(timeB)) return a || b;
  return timeA >= timeB ? a : b;
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

function longerText(a, b) {
  return (b || "").length > (a || "").length ? b : a;
}

function uniqueCompact(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function toPositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

startRobot().catch((error) => {
  console.error("[치명적 오류]", error);
  process.exit(1);
});
