// [bot.mjs] Naver Cafe view-count based trend collector.
// Collects public Naver Cafe HOT/TOP posts and stores the top 10 by read count.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(SCRIPT_DIR, ".env"));

const DEFAULT_FIREBASE_DB_URL =
  "https://chosanghee00001-default-rtdb.firebaseio.com/categories.json";

const MAX_ITEMS = toPositiveInt(process.env.MAX_ITEMS_PER_CATEGORY, 10);
const HTTP_TIMEOUT_MS = toPositiveInt(process.env.HTTP_TIMEOUT_MS, 12000);
const DRY_RUN = process.env.DRY_RUN === "1";

const NAVER_CAFE_API_BASE =
  "https://apis.naver.com/cafe-home-web/cafe-home/v1/popular";

const USER_AGENT =
  process.env.TREND_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36 MoaReviewCafeBot/4.0";

const CAFE_RANGES = [
  {
    key: "daily",
    label: "실시간HOT",
    endpoint: "realtime",
    description: "네이버 카페 실시간 HOT 중 최근 글을 조회수 기준으로 정렬합니다.",
    maxAgeHours: 48,
  },
  {
    key: "weekly",
    label: "주간TOP",
    endpoint: "weekly",
    description: "네이버 카페 주간 TOP 중 조회수가 높은 글을 정렬합니다.",
  },
];

const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80";

async function fetchCafeTrend(range) {
  console.log(`\n[${range.label}] 네이버 카페 ${range.endpoint} 조회수 기반 수집`);

  const rawItems = await fetchNaverCafePopular(range.endpoint);
  const articles = rawItems
    .filter((entry) => entry?.type === "ARTICLE" && entry.item)
    .map((entry) => normalizeCafeArticle(entry.item))
    .filter((item) => item.title && item.link && item.readCount > 0);

  const freshArticles = range.maxAgeHours
    ? articles.filter((item) => isWithinHours(item.publishedAt, range.maxAgeHours))
    : articles;
  const freshWithImages = freshArticles.filter((item) => item.img);
  const allWithImages = articles.filter((item) => item.img);
  const candidates =
    freshWithImages.length >= MAX_ITEMS
      ? freshWithImages
      : allWithImages.length >= MAX_ITEMS
        ? allWithImages
        : freshArticles.length >= MAX_ITEMS
          ? freshArticles
          : articles;

  const topItems = candidates
    .sort(compareCafeArticles)
    .slice(0, MAX_ITEMS)
    .map((item, index) => ({
      rank: index + 1,
      title: item.title,
      content: `${range.label} · ${item.cafeName} · 조회 ${formatCountKo(
        item.readCount
      )} · 댓글 ${formatCountKo(item.commentCount)} · 좋아요 ${formatCountKo(item.likeCount)}`,
      link: item.link,
      img: item.img || FALLBACK_IMAGE,
      source: item.cafeName || "네이버 카페",
      sources: uniqueCompact(["네이버 카페", item.cafeName]),
      sourceCount: 1,
      publishedAt: item.publishedAt,
      rankingBasis: `${range.label} 조회수`,
      readCount: item.readCount,
      commentCount: item.commentCount,
      likeCount: item.likeCount,
      cafeName: item.cafeName,
      cafeId: item.cafeId,
      articleId: item.articleId,
    }));

  console.log(
    `  - 후보 ${articles.length}개, 실제이미지 ${allWithImages.length}개, 최신필터 ${freshArticles.length}개, 최종 ${topItems.length}/${MAX_ITEMS}개`
  );
  return topItems;
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

function normalizeCafeArticle(item) {
  return {
    title: stripHtml(item.subject),
    link: buildCafeArticleUrl(item),
    img: normalizeCafeImage(item.representImage),
    readCount: toNumber(item.readCount),
    commentCount: toNumber(item.commentCount),
    likeCount: toNumber(item.likeCount),
    cafeName: cleanCafeName(item.cafeName || "네이버 카페"),
    cafeId: item.cafeId,
    articleId: item.articleId,
    publishedAt: item.writeDateTimestamp
      ? new Date(Number(item.writeDateTimestamp)).toISOString()
      : new Date().toISOString(),
  };
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

function compareCafeArticles(a, b) {
  return (
    b.readCount - a.readCount ||
    b.commentCount - a.commentCount ||
    b.likeCount - a.likeCount ||
    Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
  );
}

async function startRobot() {
  console.log("네이버 카페 조회수 기반 인기글 수집을 시작합니다.");

  const entries = [];
  for (const range of CAFE_RANGES) {
    entries.push([range.key, await fetchCafeTrend(range)]);
  }

  const categoriesData = Object.fromEntries(entries);

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
    console.log("\n[성공] 네이버 카페 조회수 기반 인기글이 Firebase에 저장되었습니다.");
  } catch (error) {
    console.error("\n[실패] Firebase 전송 오류:", error.message);
    process.exitCode = 1;
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.5",
        Referer: "https://section.cafe.naver.com/ca-fe/home/cafe-hots",
        Origin: "https://section.cafe.naver.com",
        "X-Cafe-Product": "pc",
      },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function summarize(categoriesData) {
  return Object.fromEntries(
    Object.entries(categoriesData).map(([key, items]) => [
      key,
      {
        count: items.length,
        cafeLinks: items.filter((item) => isNaverCafeUrl(item.link)).length,
        images: items.filter((item) => isHttpUrl(item.img)).length,
        maxReadCount: Math.max(...items.map((item) => item.readCount || 0), 0),
        sampleTitle: items[0]?.title || null,
        newestPublishedAt: newestPublishedAt(items),
        oldestPublishedAt: oldestPublishedAt(items),
      },
    ])
  );
}

function isWithinHours(isoDate, hours) {
  const time = Date.parse(isoDate || "");
  return !Number.isNaN(time) && Date.now() - time <= hours * 60 * 60 * 1000;
}

function normalizeCafeImage(value) {
  if (!value) return "";
  return String(value).replace(/&amp;/g, "&");
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
  return stripHtml(value).replace(/^[`'"\u2018\u2019\u201c\u201d]+|[`'"\u2018\u2019\u201c\u201d]+$/g, "");
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

function isNaverCafeUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.includes("cafe.naver.com");
  } catch {
    return false;
  }
}

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
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

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toPositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

startRobot().catch((error) => {
  console.error("[치명적 오류]", error);
  process.exit(1);
});
