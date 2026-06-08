// [bot.mjs] Naver ranking based trend collector.
// Collects public Naver "most viewed" ranking pages and stores daily/weekly/monthly TOP 20.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(SCRIPT_DIR, ".env"));

const DEFAULT_FIREBASE_DB_URL =
  "https://chosanghee00001-default-rtdb.firebaseio.com/categories.json";

const MAX_ITEMS = toPositiveInt(process.env.MAX_ITEMS_PER_CATEGORY, 20);
const HTTP_TIMEOUT_MS = toPositiveInt(process.env.HTTP_TIMEOUT_MS, 12000);
const DRY_RUN = process.env.DRY_RUN === "1";

const USER_AGENT =
  process.env.TREND_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36 MoaReviewRankingBot/3.0";

const RANGES = [
  { key: "daily", label: "일간인기글", days: 1 },
  { key: "weekly", label: "주간인기글", days: 7 },
  { key: "monthly", label: "월간인기글", days: 30 },
];

const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=900&q=80";

const pageCache = new Map();

async function fetchTrendRange(range) {
  console.log(`\n[${range.label}] 네이버 많이 본 뉴스 ${range.days}일 랭킹 수집`);

  const dateKeys = getRecentDateKeys(range.days);
  const allItems = [];

  for (let dateIndex = 0; dateIndex < dateKeys.length; dateIndex++) {
    const dateKey = dateKeys[dateIndex];
    const pageItems = await fetchNaverRankingByDate(dateKey);
    const dayWeight = 1 / (1 + dateIndex * 0.12);

    for (const item of pageItems) {
      allItems.push({
        ...item,
        rangeKey: range.key,
        rangeLabel: range.label,
        score:
          item.rankScore * dayWeight +
          item.officeScore * 0.12 +
          Math.max(0, 30 - dateIndex) * 2,
      });
    }
  }

  const merged = mergeRankingItems(allItems)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ITEMS)
    .map((item, index) => ({
      rank: index + 1,
      title: item.title,
      content: `${range.label} · 네이버 많이 본 뉴스 ${range.days}일 랭킹 기반으로 정렬했습니다.`,
      link: item.link,
      img: item.img || FALLBACK_IMAGE,
      source: "네이버 많이 본 뉴스",
      sources: uniqueCompact(["네이버 많이 본 뉴스", item.officeName]),
      sourceCount: 1,
      publishedAt: item.publishedAt,
      rankingBasis: range.label,
      rankingDays: range.days,
      officeName: item.officeName,
    }));

  console.log(`  - 후보 ${allItems.length}개, 최종 ${merged.length}/${MAX_ITEMS}개`);
  return merged;
}

async function fetchNaverRankingByDate(dateKey) {
  if (pageCache.has(dateKey)) return pageCache.get(dateKey);

  const url = `https://news.naver.com/main/ranking/popularDay.naver?date=${dateKey}`;
  const { text } = await fetchEncodedText(url, "euc-kr");
  const items = parseNaverRankingPage(text, dateKey);
  pageCache.set(dateKey, items);
  return items;
}

function parseNaverRankingPage(html, dateKey) {
  const items = [];
  const titleMatches = [...html.matchAll(/<a href="([^"]+)" class="list_title[^"]*">([\s\S]*?)<\/a>/g)];
  const officeAnchors = [...html.matchAll(/<strong class="rankingnews_name">([\s\S]*?)<\/strong>/g)].map((match) => ({
    index: match.index,
    name: stripHtml(match[1]),
  }));
  const officeCount = Math.max(officeAnchors.length, 1);

  for (const titleMatch of titleMatches) {
    const index = titleMatch.index;
    const liStart = html.lastIndexOf("<li>", index);
    const liEnd = html.indexOf("</li>", index);
    const itemHtml =
      liStart !== -1 && liEnd !== -1
        ? html.slice(liStart, liEnd + "</li>".length)
        : html.slice(Math.max(0, index - 900), index + 1200);
    const office = findNearestOffice(officeAnchors, index);
    const officeIndex = Math.max(officeAnchors.findIndex((item) => item === office), 0);
    const officeScore = officeCount - officeIndex;
    const rankText = stripHtml(
      itemHtml.match(/<em class="list_ranking_num">([\s\S]*?)<\/em>/)?.[1] || "0"
    );
    const rank = Number(rankText.match(/\d+/)?.[0] || "0");
    const link = decodeEntities(titleMatch[1]);
    const title = stripHtml(titleMatch[2]);
    const timeText = stripHtml(
      itemHtml.match(/<span class="list_time[^"]*">([\s\S]*?)<\/span>/)?.[1] || ""
    );
    const img = normalizeRankingImage(
      decodeEntities(itemHtml.match(/<img src="([^"]+)"/)?.[1] || "")
    );

    if (!rank || !title || !isNaverUrl(link)) continue;

    items.push({
      rank,
      rankScore: Math.max(1, 8 - rank) * 100,
      officeScore,
      title,
      link,
      img,
      officeName: office?.name || "네이버 뉴스",
      publishedAt: parseRankingTime(timeText, dateKey),
    });
  }

  return items;
}

function findNearestOffice(offices, itemIndex) {
  let nearest = null;
  for (const office of offices) {
    if (office.index > itemIndex) break;
    nearest = office;
  }
  return nearest;
}

function mergeRankingItems(items) {
  const byKey = new Map();

  for (const item of items) {
    const key = rankingItemKey(item);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { ...item, offices: [item.officeName] });
      continue;
    }

    existing.score += item.score;
    existing.rankScore = Math.max(existing.rankScore, item.rankScore);
    existing.officeScore = Math.max(existing.officeScore, item.officeScore);
    existing.publishedAt = newestDate(existing.publishedAt, item.publishedAt);
    existing.img = existing.img || item.img;
    existing.offices = uniqueCompact([...existing.offices, item.officeName]);
  }

  return [...byKey.values()].map((item) => ({
    ...item,
    officeName: item.offices?.[0] || item.officeName,
  }));
}

function rankingItemKey(item) {
  try {
    const url = new URL(item.link);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return normalizeTitleKey(item.title);
  }
}

async function startRobot() {
  console.log("네이버 조회 기반 인기 트렌드 수집을 시작합니다.");

  const entries = [];
  for (const range of RANGES) {
    entries.push([range.key, await fetchTrendRange(range)]);
  }

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
                naverLinks: items.filter((item) => isNaverUrl(item.link)).length,
                sampleTitle: items[0]?.title || null,
                oldestPublishedAt: oldestPublishedAt(items),
                newestPublishedAt: newestPublishedAt(items),
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

    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    console.log("\n[성공] 네이버 랭킹 기반 인기글이 Firebase에 저장되었습니다.");
  } catch (error) {
    console.error("\n[실패] Firebase 전송 오류:", error.message);
    process.exitCode = 1;
  }
}

async function fetchEncodedText(url, encoding) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.5",
      },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    return { text: new TextDecoder(encoding).decode(buffer), finalUrl: response.url };
  } finally {
    clearTimeout(timer);
  }
}

function getRecentDateKeys(days) {
  return Array.from({ length: days }, (_, index) => formatKstDate(index));
}

function formatKstDate(offsetDays) {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000 - offsetDays * 24 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function parseRankingTime(value, dateKey) {
  const now = Date.now();
  const minuteMatch = value.match(/(\d+)\s*분전/);
  if (minuteMatch) return new Date(now - Number(minuteMatch[1]) * 60 * 1000).toISOString();

  const hourMatch = value.match(/(\d+)\s*시간전/);
  if (hourMatch) return new Date(now - Number(hourMatch[1]) * 60 * 60 * 1000).toISOString();

  const [year, month, day] = [
    Number(dateKey.slice(0, 4)),
    Number(dateKey.slice(4, 6)),
    Number(dateKey.slice(6, 8)),
  ];
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0)).toISOString();
}

function normalizeRankingImage(value) {
  if (!value) return "";
  return value
    .replace(/&amp;/g, "&")
    .replace(/type=nf70_70/g, "type=nf220_220")
    .replace(/type=nf70_70_1/g, "type=nf220_220");
}

function stripHtml(value) {
  return decodeEntities(String(value || ""))
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function isNaverUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase().includes("naver.com");
  } catch {
    return false;
  }
}

function normalizeTitleKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 90);
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
