// [bot.mjs] MoaReview trend collector.
// Naver Cafe uses the public popular API. Community and hot-deal feeds use
// each site's own best/hot list order, then rank candidates by engagement.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(SCRIPT_DIR, ".env"));

const DEFAULT_FIREBASE_DB_URL =
  "https://chosanghee00001-default-rtdb.firebaseio.com/categories.json";

const MAX_ITEMS = toPositiveInt(process.env.MAX_ITEMS_PER_CATEGORY, 10);
const SOURCE_ITEM_LIMIT = toPositiveInt(process.env.SOURCE_ITEM_LIMIT, 14);
const HTTP_TIMEOUT_MS = toPositiveInt(process.env.HTTP_TIMEOUT_MS, 12000);
const ARTICLE_TIMEOUT_MS = toPositiveInt(process.env.ARTICLE_TIMEOUT_MS, 9000);
const ARTICLE_CONCURRENCY = toPositiveInt(process.env.ARTICLE_CONCURRENCY, 5);
const SOURCE_CONCURRENCY = toPositiveInt(process.env.SOURCE_CONCURRENCY, 3);
const DRY_RUN = process.env.DRY_RUN === "1";

const NAVER_CAFE_API_BASE =
  "https://apis.naver.com/cafe-home-web/cafe-home/v1/popular";
const NAVER_CAFE_ARTICLE_API_BASE = "https://article.cafe.naver.com/gw/v4/cafes";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const USER_AGENT = process.env.TREND_USER_AGENT || BROWSER_USER_AGENT;

const CAFE_RANGES = [
  {
    key: "daily",
    label: "실시간HOT",
    endpoint: "realtime",
    description: "네이버 카페 실시간 HOT 공식 랭킹입니다.",
  },
  {
    key: "weekly",
    label: "주간TOP",
    endpoint: "weekly",
    description: "네이버 카페 주간 TOP 공식 랭킹입니다.",
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
  {
    key: "fmkoreaBest",
    label: "에펨코리아 포텐",
    siteName: "에펨코리아",
    url: "https://www.fmkorea.com/best2",
    parser: parseFmkoreaBest,
  },
];

const HOTDEAL_SOURCES = [
  {
    key: "ppomppuHot",
    label: "뽐뿌 핫게시글",
    siteName: "뽐뿌",
    url: "https://www.ppomppu.co.kr/hot.php?id=ppomppu",
    encoding: "euc-kr",
    parser: parsePpomppuHot,
  },
  {
    key: "ruliwebHotdeal",
    label: "루리웹 유저 핫딜 BEST",
    siteName: "루리웹",
    url: "https://bbs.ruliweb.com/market/board/1020",
    parser: parseRuliwebHotdeal,
  },
  {
    key: "eomisaePopular",
    label: "어미새 인기정보",
    siteName: "어미새",
    url: "https://eomisae.co.kr/fs",
    parser: parseEomisaePopular,
  },
];

const FALLBACK_IMAGES = {
  naverCafe:
    "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80",
  community:
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
  hotDeal:
    "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=900&q=80",
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

  categoriesData.hotDeals = await fetchAggregateTrend({
    key: "hotDeals",
    label: "쇼핑 핫딜",
    type: "hotDeal",
    sources: HOTDEAL_SOURCES,
    fallbackImage: FALLBACK_IMAGES.hotDeal,
  });

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
  console.log(`\n[${range.label}] 네이버 카페 ${range.endpoint} 공식 랭킹 수집`);

  const rawItems = await fetchNaverCafePopular(range.endpoint);
  const articles = rawItems
    .filter((entry) => entry?.type === "ARTICLE" && entry.item)
    .map((entry) => normalizeCafeArticle(entry.item))
    .filter((item) => item.title && item.link && item.readCount > 0);

  const enrichedItems = await mapLimit(
    articles.sort(compareCafeArticles).slice(0, MAX_ITEMS),
    ARTICLE_CONCURRENCY,
    enrichNaverCafeArticle
  );

  const topItems = enrichedItems
    .sort(compareCafeArticles)
    .slice(0, MAX_ITEMS)
    .map((item, index) => ({
      rank: index + 1,
      title: item.title,
      content: `${range.label} · ${item.cafeName} · 조회 ${formatCountKo(
        item.readCount
      )} · 댓글 ${formatCountKo(item.commentCount)} · 좋아요 ${formatCountKo(item.likeCount)}`,
      link: item.link,
      img: item.firstImage || item.img || FALLBACK_IMAGES.naverCafe,
      source: item.cafeName || "네이버 카페",
      sources: uniqueCompact(["네이버 카페", item.cafeName]),
      sourceCount: 1,
      publishedAt: item.publishedAt,
      rankingBasis: `${range.label} 네이버 카페 공식 랭킹`,
      naverRank: item.naverRank,
      readCount: item.readCount,
      commentCount: item.commentCount,
      likeCount: item.likeCount,
      recommendCount: item.likeCount,
      cafeName: item.cafeName,
      cafeId: item.cafeId,
      articleId: item.articleId,
    }));

  console.log(
    `  - 후보 ${articles.length}개, 본문첫이미지 ${
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
      topItems.filter((item) => isHttpUrl(item.img)).length
    }개, 최종 ${topItems.length}/${MAX_ITEMS}개`
  );

  return topItems;
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
  if (isHttpUrl(item.img) && !item.preferDetailImage) {
    return { ...item, img: item.img };
  }

  const firstImage = await fetchExternalFirstImage(item).catch((error) => {
    console.warn(`  - 외부 글 첫 이미지 추출 실패: ${item.title} (${error.message})`);
    return "";
  });

  return {
    ...item,
    firstImage,
    img: firstImage || item.img || fallbackImage,
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

function parseFmkoreaBest(html, source) {
  const rows = [...html.matchAll(/<li\b[^>]*class=["'][^"']*li_best2_pop[^"']*["'][\s\S]*?<\/li>/gi)]
    .map((match) => match[0])
    .filter((row) => !/li_best2_hotdeal1/i.test(row));

  return rows.map((row, index) => {
    const titleAnchor = row.match(/<h3\b[^>]*class=["'][^"']*title[^"']*["'][\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const title = stripHtml(row.match(/<span\b[^>]*class=["'][^"']*ellipsis-target[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || titleAnchor?.[2] || "");
    const category = stripHtml(row.match(/<span\b[^>]*class=["'][^"']*category[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const regDate = stripHtml(row.match(/<span\b[^>]*class=["'][^"']*regdate[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");

    return {
      sourceRank: index + 1,
      title,
      link: absolutizeUrl(titleAnchor?.[1] || "", source.url),
      img: extractImageFromTag(row, source.url),
      recommendCount: parseCount(row.match(/<span\b[^>]*class=["'][^"']*count[^"']*["'][^>]*>([\d,]+)/i)?.[1]),
      commentCount: parseCount(row.match(/<span\b[^>]*class=["'][^"']*comment_count[^"']*["'][^>]*>\s*\[?([\d,]+)/i)?.[1]),
      communityName: category ? `${source.siteName} ${category}` : source.siteName,
      publishedAt: parseKoreanDate(regDate),
      rankingBasis: `${source.label} 공식 목록`,
    };
  });
}

function parsePpomppuHot(html, source) {
  const rows = [...html.matchAll(/<tr\b[^>]*class=["'][^"']*baseList[^"']*["'][\s\S]*?<\/tr>/gi)]
    .map((match) => match[0])
    .filter((row) => /data-bbs_no=["']\d+["']/i.test(row));

  return rows.map((row, index) => {
    const anchors = [...row.matchAll(/<a\b[^>]*class=["'][^"']*baseList-title[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    const titleAnchor = anchors[anchors.length - 1] || anchors[0];
    const parsedTitle = parseDealTitle(stripHtml(titleAnchor?.[2] || ""));
    const boardDates = [...row.matchAll(/<td\b[^>]*class=["'][^"']*board_date[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
      stripHtml(match[1])
    );
    const voteText = boardDates[1] || "";

    return {
      sourceRank: index + 1,
      title: parsedTitle.title,
      mallName: parsedTitle.mallName,
      price: parsedTitle.price,
      link: absolutizeUrl(titleAnchor?.[1] || "", source.url),
      img: extractImageFromTag(row, source.url),
      viewCount: parseCount(boardDates[2]),
      recommendCount: parseCount(voteText.split("-")[0]),
      commentCount: parseCount(row.match(/<span\b[^>]*class=["'][^"']*list_comment2[^"']*["'][^>]*>([\d,]+)/i)?.[1]),
      publishedAt: parseKoreanDate(boardDates[0]),
      rankingBasis: `${source.label} 공식 목록`,
    };
  });
}

function parseRuliwebHotdeal(html, source) {
  const rows = [...html.matchAll(/<tr\b[^>]*class=["'][^"']*table_body[^"']*["'][\s\S]*?<\/tr>/gi)]
    .map((match) => match[0])
    .filter((row) => /best|blocktarget/i.test(row) && !/notice/i.test(row));

  return rows.map((row, index) => {
    const subjectCell = row.match(/<td\b[^>]*class=["'][^"']*subject[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || "";
    const titleAnchor = subjectCell.match(/<a\b[^>]*class=["'][^"']*subject_link[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const rawTitle = stripHtml(subjectCell.match(/<strong>([\s\S]*?)<\/strong>/i)?.[1] || titleAnchor?.[2] || "");
    const parsedTitle = parseDealTitle(rawTitle);

    return {
      sourceRank: index + 1,
      title: parsedTitle.title,
      mallName: parsedTitle.mallName,
      price: parsedTitle.price,
      link: absolutizeUrl(titleAnchor?.[1] || "", source.url),
      img: "",
      preferDetailImage: true,
      viewCount: parseCount(extractCellText(row, "hit")),
      recommendCount: parseCount(extractCellText(row, "recomd")),
      commentCount: parseCount(subjectCell.match(/<a\b[^>]*class=["'][^"']*num_reply[^"']*["'][^>]*>\s*\(?([\d,]+)/i)?.[1]),
      publishedAt: parseKoreanDate(extractCellText(row, "time")),
      rankingBasis: `${source.label} 공식 목록`,
    };
  });
}

function parseEomisaePopular(html, source) {
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    .map((match) => match[0])
    .filter((row) => /is_popular/i.test(row) && /class=["']title/i.test(row) && !/adlink_|&nbsp;AD&nbsp;|>AD</i.test(row));

  return rows.map((row, index) => {
    const titleCell = row.match(/<td\b[^>]*class=["']title["'][^>]*>[\s\S]*?<\/td>/i)?.[0] || row;
    const titleAnchor = titleCell.match(/<a\b[^>]*class=["'][^"']*pjax[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const category = stripHtml(titleCell.match(/<span\b[^>]*class=["'][^"']*cate[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const parsedTitle = parseDealTitle(stripHtml(titleAnchor?.[2] || ""));
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripHtml(match[1]));

    return {
      sourceRank: index + 1,
      title: parsedTitle.title,
      mallName: parsedTitle.mallName || category,
      price: parsedTitle.price,
      link: absolutizeUrl(titleAnchor?.[1] || "", source.url),
      img: "",
      preferDetailImage: true,
      viewCount: 0,
      recommendCount: parseCount(cells[cells.length - 1]),
      commentCount: parseCount(titleCell.match(/<a\b[^>]*class=["'][^"']*tt_cm[^"']*["'][^>]*>[\s\S]*?([\d,]+)[\s\S]*?<\/a>/i)?.[1]),
      publishedAt: parseKoreanDate(cells[cells.length - 2]),
      rankingBasis: `${source.label} 공식 목록`,
    };
  });
}

function normalizeCafeArticle(item) {
  return {
    title: stripHtml(item.subject),
    link: buildCafeArticleUrl(item),
    img: normalizeImageUrl(item.representImage),
    naverRank: toNumber(item.rank),
    readCount: toNumber(item.readCount),
    viewCount: toNumber(item.readCount),
    commentCount: toNumber(item.commentCount),
    likeCount: toNumber(item.likeCount),
    cafeName: cleanCafeName(item.cafeName || "네이버 카페"),
    cafeId: item.cafeId,
    articleId: item.articleId,
    art: item.art || "",
    publishedAt: item.writeDateTimestamp
      ? new Date(Number(item.writeDateTimestamp)).toISOString()
      : new Date().toISOString(),
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
    trendScore: Math.round(item.trendScore || 0),
    viewCount: toNumber(item.viewCount),
    readCount: toNumber(item.viewCount),
    recommendCount: toNumber(item.recommendCount),
    commentCount: toNumber(item.commentCount),
  };

  if (type === "community") {
    return {
      ...base,
      communityName: item.communityName || item.source || item.siteName,
    };
  }

  return {
    ...base,
    mallName: item.mallName || "",
    shopName: item.mallName || "",
    price: item.price || "",
    productImage: base.img,
    productUrl: item.link,
  };
}

function buildContentSummary(item, type) {
  const parts = [];
  if (item.siteName || item.source) parts.push(item.siteName || item.source);
  if (item.boardName) parts.push(item.boardName);
  if (item.viewCount > 0) parts.push(`조회 ${formatCountKo(item.viewCount)}`);
  if (item.recommendCount > 0) parts.push(`${type === "hotDeal" ? "추천" : "추천"} ${formatCountKo(item.recommendCount)}`);
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

function compareCafeArticles(a, b) {
  return (
    normalizeRank(a.naverRank) - normalizeRank(b.naverRank) ||
    normalizeRank(a.rank) - normalizeRank(b.rank) ||
    b.commentCount - a.commentCount ||
    b.likeCount - a.likeCount ||
    b.readCount - a.readCount ||
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

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const path = `${url.pathname}${url.search}`.toLowerCase();

    if (options.allowedHostIncludes?.length) {
      const allowed = options.allowedHostIncludes.some((part) => hostname.includes(part));
      if (!allowed) return false;
    }

    if (/profile|avatar|emoticon|icon|sprite|blank|default|transparent|logo|loading/i.test(path)) {
      return false;
    }
    if (/\.(svg|ico)(?:$|\?)/i.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}

function parseDealTitle(rawTitle) {
  let title = stripHtml(rawTitle).replace(/^\s*(?:hot|HOT)\s*/g, "").trim();
  let mallName = "";
  const priceParts = [];

  const mallMatch = title.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (mallMatch) {
    mallName = mallMatch[1].trim();
    title = mallMatch[2].trim();
  }

  title = title.replace(/\(([^()]*?(?:원|무료|배송|달러|위안|엔|￦|₩|\$|€)[^()]*)\)\s*$/g, (_, value) => {
    priceParts.unshift(value.trim());
    return "";
  }).trim();

  return {
    title,
    mallName,
    price: uniqueCompact(priceParts).join(" / "),
  };
}

function extractCellText(row, className) {
  const pattern = new RegExp(`<td\\b[^>]*class=["'][^"']*${escapeRegExp(className)}[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`, "i");
  return stripHtml(String(row || "").match(pattern)?.[1] || "");
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

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
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
          images: items.filter((item) => isHttpUrl(item.img)).length,
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

startRobot().catch((error) => {
  console.error("[치명적 오류]", error);
  process.exit(1);
});
