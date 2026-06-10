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
const COMMUNITY_SOURCE_ITEM_LIMIT = toPositiveInt(process.env.COMMUNITY_SOURCE_ITEM_LIMIT, 100);
const COMMUNITY_PAGE_LIMIT = toPositiveInt(process.env.COMMUNITY_PAGE_LIMIT, 5);
const REQUIRE_COMMUNITY_SOURCE = process.env.REQUIRE_COMMUNITY_SOURCE !== "0";
const TWITCH_SOURCE_ITEM_LIMIT = toPositiveInt(process.env.TWITCH_SOURCE_ITEM_LIMIT, 100);
const TWITCH_MIN_ITEMS_PER_MEDIA_FEED = toPositiveInt(process.env.TWITCH_MIN_ITEMS_PER_MEDIA_FEED, 3);
const YOUTUBE_SOURCE_ITEM_LIMIT = toPositiveInt(process.env.YOUTUBE_SOURCE_ITEM_LIMIT, 50);
const YOUTUBE_MIN_ITEMS_PER_MEDIA_FEED = toPositiveInt(process.env.YOUTUBE_MIN_ITEMS_PER_MEDIA_FEED, 2);
const ENABLE_YOUTUBE_REPLAY = process.env.ENABLE_YOUTUBE_REPLAY === "1";
const REQUIRE_MEDIA_API_SOURCES = process.env.REQUIRE_MEDIA_API_SOURCES === "1";
const REQUIRE_TWITCH_SOURCE = process.env.REQUIRE_TWITCH_SOURCE === "1";
const REQUIRE_YOUTUBE_SOURCE = process.env.REQUIRE_YOUTUBE_SOURCE === "1";
const HTTP_TIMEOUT_MS = toPositiveInt(process.env.HTTP_TIMEOUT_MS, 12000);
const ARTICLE_TIMEOUT_MS = toPositiveInt(process.env.ARTICLE_TIMEOUT_MS, 9000);
const ARTICLE_CONCURRENCY = toPositiveInt(process.env.ARTICLE_CONCURRENCY, 5);
const SOURCE_CONCURRENCY = toPositiveInt(process.env.SOURCE_CONCURRENCY, 3);
const RECENCY_HOURS = toPositiveInt(process.env.RECENCY_HOURS, 48);
const EMBED_IMAGE_MAX_BYTES = toPositiveInt(process.env.EMBED_IMAGE_MAX_BYTES, 700000);
const UPDATE_INTERVAL_MINUTES = toPositiveInt(process.env.UPDATE_INTERVAL_MINUTES, 60);
const DRY_RUN = process.env.DRY_RUN === "1";
const HISTORY_PICK_LIMIT = toPositiveInt(process.env.HISTORY_PICK_LIMIT, 10);
const HISTORY_IMAGE_MAX_CHARS = toPositiveInt(process.env.HISTORY_IMAGE_MAX_CHARS, 120000);

const NAVER_CAFE_API_BASE =
  "https://apis.naver.com/cafe-home-web/cafe-home/v1/popular";
const NAVER_CAFE_ARTICLE_API_BASE = "https://article.cafe.naver.com/gw/v4/cafes";
const DAUM_CAFE_TOP_URL = "https://m.cafe.daum.net/";
const CHZZK_LIVES_API_URL = "https://api.chzzk.naver.com/service/v1/lives?size=20&sortType=POPULAR";
const CHZZK_VIDEOS_API_URL = "https://api.chzzk.naver.com/service/v1/home/videos";
const CHZZK_LIVE_PAGE_BASE = "https://chzzk.naver.com/live";
const CHZZK_VIDEO_PAGE_BASE = "https://chzzk.naver.com/video";
const SOOP_LIVES_API_URL =
  "https://live.sooplive.co.kr/api/main_broad_list_api.php?selectType=action&selectValue=all&orderType=view_cnt&pageNo=1&lang=ko_KR";
const SOOP_PLAY_PAGE_BASE = "https://play.sooplive.com";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_STREAMS_API_URL = "https://api.twitch.tv/helix/streams";
const TWITCH_VIDEOS_API_URL = "https://api.twitch.tv/helix/videos";
const TWITCH_PAGE_BASE = "https://www.twitch.tv";
const YOUTUBE_SEARCH_API_URL = "https://www.googleapis.com/youtube/v3/search";
const YOUTUBE_VIDEOS_API_URL = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_WATCH_BASE = "https://www.youtube.com/watch";
const YOUTUBE_LIVE_QUERIES = parseListEnv(process.env.YOUTUBE_LIVE_QUERIES, [
  "라이브",
  "게임 라이브",
  "음악 라이브",
]);
const YOUTUBE_REPLAY_QUERIES = parseListEnv(process.env.YOUTUBE_REPLAY_QUERIES, [
  "치지직 다시보기",
  "SOOP 다시보기",
  "트위치 다시보기",
  "게임 다시보기",
  "스트리머 다시보기",
]);
const YOUTUBE_REPLAY_RECENCY_DAYS = toPositiveInt(process.env.YOUTUBE_REPLAY_RECENCY_DAYS, 14);

const YOUTUBE_BLOCKED_KEYWORDS = parseListEnv(process.env.YOUTUBE_BLOCKED_KEYWORDS, [
  "뉴스",
  "news",
  "속보",
  "breaking",
  "보도",
  "정치",
  "국회",
  "대통령",
  "정부",
  "주식",
  "증시",
  "경제",
  "코인",
  "bitcoin",
  "crypto",
  "cnn",
  "bbc",
  "fox news",
  "al jazeera",
  "sky news",
  "msnbc",
  "ytn",
  "연합뉴스",
  "mbcnews",
  "sbs 뉴스",
  "kbs news",
  "jtbc news",
  "채널a 뉴스",
  "뉴스tv",
  "24시간 뉴스",
  "24/7 news",
]);

const SECOND_THUMBNAIL_CAFE_KEYWORDS = [
  "여성시대",
  "이종격투기",
  "subdued20club",
  "ssaumjil",
];

const MEDIA_FEEDS = [
  { key: "mediaHot", label: "라이브HOT", category: "all" },
  { key: "mediaReplay", label: "다시보기", category: "replay" },
  { key: "mediaGame", label: "게임", category: "game" },
  { key: "mediaTalk", label: "토크방송", category: "talk" },
  { key: "mediaMusic", label: "음악라디오", category: "music" },
];

const HISTORY_PICK_SOURCES = [
  { key: "mediaHot", sectionKey: "mediaTrend", feedLabel: "실시간 방송", maxItems: 4 },
  { key: "daily", sectionKey: "naverCafe", feedLabel: "카페 인기글", maxItems: 4 },
  { key: "communityPopular", sectionKey: "community", feedLabel: "화제글 모음", maxItems: 4 },
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
    "playlist",
    "플레이리스트",
    "bgm",
    "radio",
    "라디오",
    "힐링",
    "sleep",
    "sleeping",
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
  talk: [
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
    "시사",
    "정치",
    "경제",
    "라이브",
    "live",
    "일상방송",
    "여캠",
    "youtube",
    "유튜브",
  ],
};

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const USER_AGENT = process.env.TREND_USER_AGENT || BROWSER_USER_AGENT;

const CAFE_RANGES = [
  {
    key: "daily",
    label: "실시간HOT",
    endpoint: "realtime",
    description: "네이버 카페와 다음 카페 실시간 공식 인기글 랭킹입니다.",
    includeDaum: true,
    sourceLimit: 40,
    minDaumItems: 2,
  },
  {
    key: "weekly",
    label: "주간TOP",
    endpoint: "weekly",
    description: "네이버 카페 주간 TOP과 다음 카페 공식 인기글 통합 랭킹입니다.",
    includeDaum: true,
    sourceLimit: 100,
    scoreMode: "weekly",
    minDaumItems: 3,
  },
  {
    key: "cafeTravel",
    label: "여행후기",
    endpoints: ["realtime", "weekly"],
    description: "네이버 카페와 다음 카페 인기글 후보 중 여행 후기 반응이 높은 글입니다.",
    includeDaum: true,
    sourceLimit: 220,
    scoreMode: "weekly",
    filterCategory: "travel",
    minDaumItems: 1,
  },
  {
    key: "cafeFood",
    label: "맛집리뷰",
    endpoints: ["realtime", "weekly"],
    description: "네이버 카페와 다음 카페 인기글 후보 중 맛집·카페 리뷰 반응이 높은 글입니다.",
    includeDaum: true,
    sourceLimit: 220,
    scoreMode: "weekly",
    filterCategory: "food",
    minDaumItems: 1,
  },
  {
    key: "cafeOutfit",
    label: "오늘의 코디",
    endpoints: ["realtime", "weekly"],
    description: "네이버 카페와 다음 카페 인기글 후보 중 오늘의 코디·패션 반응이 높은 글입니다.",
    includeDaum: true,
    sourceLimit: 220,
    scoreMode: "weekly",
    filterCategory: "outfit",
    minDaumItems: 1,
  },
];

const CAFE_CATEGORY_RULES = {
  travel: [
    "여행",
    "여행후기",
    "여행기",
    "국내여행",
    "해외여행",
    "제주",
    "제주도",
    "강릉",
    "부산",
    "속초",
    "경주",
    "여수",
    "캠핑",
    "차박",
    "숙소",
    "호텔",
    "리조트",
    "항공",
    "공항",
    "비행기",
    "일본",
    "도쿄",
    "오사카",
    "후쿠오카",
    "태국",
    "베트남",
    "유럽",
    "코스",
    "투어",
  ],
  food: [
    "맛집",
    "맛집리뷰",
    "맛집후기",
    "카페",
    "디저트",
    "빵",
    "베이커리",
    "브런치",
    "식당",
    "레스토랑",
    "오마카세",
    "스시",
    "초밥",
    "라멘",
    "국밥",
    "고기",
    "삼겹살",
    "떡볶이",
    "김밥",
    "치킨",
    "피자",
    "먹방",
    "요리",
    "음식",
    "메뉴",
    "런치",
  ],
  outfit: [
    "오늘의코디",
    "오늘코디",
    "오코",
    "코디",
    "데일리룩",
    "데일리",
    "ootd",
    "오오티디",
    "착샷",
    "착장",
    "룩",
    "출근룩",
    "하객룩",
    "여름코디",
    "패션",
    "옷",
    "옷차림",
    "스타일",
    "스타일링",
    "원피스",
    "셔츠",
    "블라우스",
    "자켓",
    "재킷",
    "바지",
    "청바지",
    "스커트",
    "슬랙스",
    "운동화",
    "신발",
    "가방",
    "모자",
  ],
};

const CAFE_OUTFIT_STRONG_TITLE_KEYWORDS = [
  "오늘의코디",
  "오늘코디",
  "오코",
  "코디",
  "데일리룩",
  "ootd",
  "오오티디",
  "착샷",
  "착장",
  "출근룩",
  "하객룩",
  "여름코디",
  "옷차림",
  "스타일링",
];

const CAFE_OUTFIT_WEAK_TITLE_KEYWORDS = [
  "패션",
  "옷",
  "룩",
  "데일리",
  "스타일",
  "원피스",
  "셔츠",
  "블라우스",
  "자켓",
  "재킷",
  "바지",
  "청바지",
  "스커트",
  "슬랙스",
  "운동복",
  "운동화",
  "신발",
  "가방",
  "모자",
  "착용",
];

const CAFE_OUTFIT_SOURCE_KEYWORDS = [
  "디젤매니아",
  "dmain",
  "브랜디드",
  "고아캐드",
  "패션",
  "옷",
  "코디",
  "스타일",
  "데일리룩",
  "운동화",
  "신발",
];

const COMMUNITY_SOURCES = [
  {
    key: "dcinsideBest",
    label: "디시인사이드 실베",
    siteName: "디시인사이드",
    url: "https://m.dcinside.com/board/dcbest",
    referer: "https://m.dcinside.com/",
    userAgent: MOBILE_USER_AGENT,
    parser: parseDcinsideBest,
  },
  {
    key: "theqooHot",
    label: "더쿠 HOT",
    siteName: "더쿠",
    url: "https://theqoo.net/hot",
    referer: "https://theqoo.net/hot",
    parser: parseTheqooHot,
  },
  {
    key: "ruliwebBest",
    label: "루리웹 베스트",
    siteName: "루리웹",
    url: "https://bbs.ruliweb.com/best",
    referer: "https://bbs.ruliweb.com/best",
    parser: parseRuliwebBest,
  },
  {
    key: "ruliwebHotDeal",
    label: "루리웹 핫딜",
    siteName: "루리웹",
    url: "https://bbs.ruliweb.com/market/board/1020",
    referer: "https://bbs.ruliweb.com/market/board/1020",
    parser: parseRuliwebBest,
  },
  {
    key: "ppomppuHot",
    label: "뽐뿌 HOT",
    siteName: "뽐뿌",
    url: "https://www.ppomppu.co.kr/hot.php",
    referer: "https://www.ppomppu.co.kr/hot.php",
    encoding: "euc-kr",
    parser: parsePpomppuHot,
  },
  {
    key: "instizGreen",
    label: "인스티즈 초록글",
    siteName: "인스티즈",
    url: "https://www.instiz.net/pt",
    referer: "https://www.instiz.net/pt",
    parser: parseInstizGreen,
  },
];

const COMMUNITY_FEEDS = [
  { key: "communityIssue", label: "이슈", category: "issue" },
  { key: "communityHumor", label: "유머", category: "humor" },
  { key: "communityEntertain", label: "방송연예", category: "entertainment" },
  { key: "communityEvent", label: "이벤트정보", category: "event" },
];

const COMMUNITY_CATEGORY_RULES = {
  event: [
    "이벤트",
    "행사",
    "축제",
    "전시",
    "공연",
    "팝업",
    "티켓",
    "예매",
    "사전예약",
    "예약",
    "신청",
    "모집",
    "체험단",
    "응모",
    "당첨",
    "쿠폰",
    "무료",
    "배포",
    "할인",
    "세일",
    "특가",
    "핫딜",
    "혜택",
    "굿즈",
    "출시",
    "오픈",
  ],
  humor: [
    "싱글벙글",
    "웃긴",
    "개웃",
    "웃음",
    "유머",
    "짤",
    "밈",
    "드립",
    "레전드",
    "ㅋㅋ",
    "만화",
    "카툰",
    "썰",
  ],
  entertainment: [
    "연예",
    "방송",
    "방송인",
    "아이돌",
    "걸그룹",
    "보이그룹",
    "연예인",
    "배우",
    "드라마",
    "예능",
    "영화",
    "넷플릭스",
    "넷플",
    "티빙",
    "웨이브",
    "디즈니",
    "쿠팡플레이",
    "ott",
    "유튜브",
    "유튜버",
    "크리에이터",
    "인플루언서",
    "bj",
    "인방",
    "스트리머",
    "음악",
    "노래",
    "가수",
    "컴백",
    "데뷔",
    "멤버",
    "콘서트",
    "공연",
    "팬미팅",
    "시상식",
    "무대",
    "화보",
    "인터뷰",
    "티저",
    "예고편",
    "ost",
    "공식입장",
    "소속사",
    "열애",
    "결별",
    "연애",
    "커플",
    "인스타",
    "릴스",
    "모델",
    "셀럽",
    "아나운서",
    "치어리더",
    "bts",
    "그라비아",
    "영점프",
    "ㅇㅎ",
    "나나",
    "배용준",
    "이승기",
    "연갤",
    "여갤",
    "기갤",
    "더갤",
  ],
  info: [
    "후기",
    "맛집",
    "스시",
    "런치",
    "먹방",
    "요리",
    "음식",
    "여행",
    "전국일주",
    "캠핑",
    "사진",
    "pic",
    "코모레비",
    "공원",
    "문화",
    "패션",
    "운동",
    "헬스",
    "직장",
    "블라인드",
    "애플",
    "wwdc",
    "요약",
    "정보",
    "리뷰",
    "자동차",
    "버스",
    "시내버스",
    "게임",
    "it",
    "테크",
    "ai",
    "인공지능",
    "컴퓨터",
    "노트북",
    "스마트폰",
    "아이폰",
    "갤럭시",
    "스팀",
    "닌텐도",
    "플스",
    "xbox",
    "롤",
    "리그오브레전드",
    "발로란트",
    "메이플",
    "로스트아크",
    "마인크래프트",
    "던파",
  ],
  issue: [
    "정치",
    "사회",
    "사건",
    "사고",
    "논란",
    "뉴스",
    "경제",
    "주식",
    "부동산",
    "법",
    "재판",
    "경찰",
    "검찰",
    "전쟁",
    "미국",
    "중국",
    "일본",
    "한국",
    "정부",
  ],
};

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

  const communityBuckets = await fetchCommunityTrendBuckets();
  for (const feed of COMMUNITY_FEEDS) {
    categoriesData[feed.key] = communityBuckets[feed.key] || [];
  }
  categoriesData.communityPopular = communityBuckets.communityPopular || categoriesData.communityIssue || [];

  const mediaBuckets = await fetchMediaTrendBuckets();
  for (const feed of MEDIA_FEEDS) {
    categoriesData[feed.key] = mediaBuckets[feed.key] || [];
  }
  categoriesData.mediaTrends = categoriesData.mediaHot || [];

  const updatedAt = new Date();
  categoriesData.updatedAt = updatedAt.toISOString();

  const firebaseUrl = buildFirebaseUrl(
    process.env.FIREBASE_DB_URL || DEFAULT_FIREBASE_DB_URL,
    process.env.FIREBASE_AUTH_TOKEN
  );

  const previousData = DRY_RUN ? null : await fetchPreviousFirebaseData(firebaseUrl);
  applyRisingTrendSignals(categoriesData, previousData);
  categoriesData._history = buildHistoryData(previousData, updatedAt);
  categoriesData._meta = buildRunMetadata(categoriesData, updatedAt);

  if (DRY_RUN) {
    console.log("\n[DRY_RUN] Firebase 전송 없이 수집 결과만 출력합니다.");
    if (process.env.DRY_RUN_SUMMARY === "1") {
      console.log(JSON.stringify(summarize(categoriesData), null, 2));
    } else {
      console.log(JSON.stringify(categoriesData, null, 2));
    }
    return;
  }

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
  const scopedArticles = filterCafeArticlesByCategory(allArticles, range.filterCategory);
  const recentArticles =
    range.key === "daily"
      ? scopedArticles.filter((item) => ageInHours(item.publishedAt) <= RECENCY_HOURS)
      : scopedArticles;
  const articlePool = recentArticles.length >= MAX_ITEMS ? recentArticles : scopedArticles;

  const articles = articlePool
    .map((item) => ({
      ...item,
      trendScore: calculateCafeTrendScore(item, range),
    }))
    .sort(compareCafeArticles);
  const candidateArticles = selectCafeItems(
    articles,
    range,
    Math.max(MAX_ITEMS * 2, MAX_ITEMS),
    Math.max(toNumber(range.minDaumItems) * 2, toNumber(range.minDaumItems))
  );

  const enrichedItems = await mapLimit(candidateArticles, ARTICLE_CONCURRENCY, enrichCafeArticle);

  const rankedItems = enrichedItems
    .map((item) => ({
      ...item,
      trendScore: calculateCafeTrendScore(item, range),
    }))
    .sort(compareCafeArticles);
  const topItems = selectCafeItems(rankedItems, range, MAX_ITEMS, toNumber(range.minDaumItems))
    .map((item, index) => toPublicCafeTrendItem(item, index, range));

  console.log(
    `  - 통합 후보 ${articles.length}개${range.filterCategory ? ` (${range.label} 필터 적용)` : ""}, 본문첫이미지 ${
      enrichedItems.filter((item) => item.firstImage).length
    }개, 최종 ${topItems.length}/${MAX_ITEMS}개`
  );
  return topItems;
}

function buildRunMetadata(categoriesData, updatedAt) {
  const feedKeys = [
    ...CAFE_RANGES.map((range) => range.key),
    ...COMMUNITY_FEEDS.map((feed) => feed.key),
    "communityPopular",
    ...MEDIA_FEEDS.map((feed) => feed.key),
    "mediaTrends",
  ];
  const counts = Object.fromEntries(
    feedKeys.map((key) => {
      const items = Array.isArray(categoriesData[key]) ? categoriesData[key] : [];
      return [
        key,
        {
          count: items.length,
          images: items.filter((item) => isDisplayableImage(item.img)).length,
        },
      ];
    })
  );

  return {
    updatedAt: updatedAt.toISOString(),
    updatedAtKst: formatKstDateTime(updatedAt),
    updateIntervalMinutes: UPDATE_INTERVAL_MINUTES,
    schedule: `every ${UPDATE_INTERVAL_MINUTES} minutes`,
    maxItemsPerCategory: MAX_ITEMS,
    counts,
  };
}

function getTrendFeedKeys() {
  return [
    ...CAFE_RANGES.map((range) => range.key),
    ...COMMUNITY_FEEDS.map((feed) => feed.key),
    "communityPopular",
    ...MEDIA_FEEDS.map((feed) => feed.key),
    "mediaTrends",
  ];
}

function applyRisingTrendSignals(categoriesData, previousData) {
  if (!previousData) return;

  let risingCount = 0;
  for (const key of getTrendFeedKeys()) {
    const currentItems = Array.isArray(categoriesData[key]) ? categoriesData[key] : [];
    const previousItems = Array.isArray(previousData[key]) ? previousData[key] : [];
    if (currentItems.length === 0 || previousItems.length === 0) continue;

    const previousRankMap = buildPreviousRankMap(previousItems);
    currentItems.forEach((item, index) => {
      const currentRank = toNumber(item.rank || item.naverRank || index + 1) || index + 1;
      const previousRank = previousRankMap.get(normalizeDedupeKey(item));

      item.currentRank = currentRank;
      if (!previousRank) {
        item.isNewEntry = true;
        item.risingLabel = "NEW";
        return;
      }

      const rankDelta = previousRank - currentRank;
      item.previousRank = previousRank;
      item.rankDelta = rankDelta;

      if (rankDelta >= 2) {
        item.isRising = true;
        item.risingLabel = `▲ ${rankDelta}`;
        risingCount += 1;
      }
    });
  }

  if (risingCount > 0) {
    console.log(`  - 급상승 표시 ${risingCount}개 계산`);
  }
}

function buildPreviousRankMap(items) {
  const map = new Map();
  items.forEach((item, index) => {
    const key = normalizeDedupeKey(item);
    const rank = toNumber(item.rank || item.naverRank || index + 1) || index + 1;
    if (key && !map.has(key)) map.set(key, rank);
  });
  return map;
}

async function fetchPreviousFirebaseData(firebaseUrl) {
  try {
    const response = await fetch(firebaseUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) || null;
  } catch (error) {
    console.warn(`  - 이전 Firebase 데이터 확인 실패: ${error.message}`);
    return null;
  }
}

function buildHistoryData(previousData, updatedAt) {
  const previousHistory =
    previousData && typeof previousData._history === "object" && !Array.isArray(previousData._history)
      ? previousData._history
      : {};
  const history = { ...previousHistory };
  const currentDateKey = formatKstDateKey(updatedAt);
  const previousDateKey = getFirebaseDataKstDateKey(previousData);

  if (previousData && previousDateKey && previousDateKey !== currentDateKey) {
    const yesterdayPicks = buildYesterdayPicks(previousData);
    history.yesterdayDateKst = previousDateKey;
    history.yesterdayPicks = yesterdayPicks;
    history.createdAt = updatedAt.toISOString();
    history.createdAtKst = formatKstDateTime(updatedAt);
    console.log(`  - 어제 놓친 인기글 ${yesterdayPicks.length}개 보관 (${previousDateKey})`);
  }

  return history;
}

function buildYesterdayPicks(previousData) {
  const sourceLists = HISTORY_PICK_SOURCES.map((source) =>
    normalizeHistoryItems(previousData?.[source.key], source).slice(0, source.maxItems)
  );
  const merged = [];
  const maxLength = Math.max(...sourceLists.map((items) => items.length), 0);

  for (let index = 0; index < maxLength; index += 1) {
    for (const list of sourceLists) {
      if (list[index]) merged.push(list[index]);
      if (merged.length >= HISTORY_PICK_LIMIT) break;
    }
    if (merged.length >= HISTORY_PICK_LIMIT) break;
  }

  return dedupeItems(merged).slice(0, HISTORY_PICK_LIMIT).map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}

function normalizeHistoryItems(value, source) {
  const items = Array.isArray(value) ? value : Object.values(value || {});
  return items
    .filter(Boolean)
    .sort((a, b) => normalizeRank(a.rank || a.naverRank) - normalizeRank(b.rank || b.naverRank))
    .map((item) => toHistoryPickItem(item, source))
    .filter((item) => item.title && item.link);
}

function toHistoryPickItem(item, source) {
  const fallbackImage = FALLBACK_IMAGES[source.sectionKey] || FALLBACK_IMAGES.naverCafe;
  const image = compactHistoryImage(
    firstNonEmpty(item.img, item.thumbnail, item.thumbnailUrl, item.image, item.videoThumbnail, item.contentThumbnail),
    fallbackImage
  );

  return {
    title: firstNonEmpty(item.title, item.subject, item.name, item.videoTitle, "제목 없음"),
    link: firstNonEmpty(item.link, item.url, item.articleUrl, item.watchUrl, item.contentUrl),
    img: image,
    thumbnail: image,
    source: firstNonEmpty(item.source, item.siteName, item.cafeName, item.communityName, item.platformName, source.feedLabel),
    siteName: firstNonEmpty(item.siteName, item.source, source.feedLabel),
    boardName: firstNonEmpty(item.boardName, item.channelName, source.feedLabel),
    cafeName: firstNonEmpty(item.cafeName, item.source),
    communityName: firstNonEmpty(item.communityName, item.source),
    platformName: firstNonEmpty(item.platformName, item.source),
    channelName: firstNonEmpty(item.channelName, item.boardName),
    sectionKey: source.sectionKey,
    feedKey: source.key,
    feedLabel: source.feedLabel,
    originalRank: toNumber(item.rank || item.naverRank),
    viewCount: toNumber(item.viewCount || item.readCount || item.views),
    readCount: toNumber(item.readCount || item.viewCount),
    viewerCount: toNumber(item.viewerCount || item.concurrentUserCount),
    concurrentUserCount: toNumber(item.concurrentUserCount || item.viewerCount),
    recommendCount: toNumber(item.recommendCount || item.likeCount || item.likes),
    commentCount: toNumber(item.commentCount || item.comments || item.replyCount),
    publishedAt: firstNonEmpty(item.publishedAt, item.createdAt, item.openDate),
    rankingBasis: `어제 ${source.feedLabel} TOP`,
    mediaCategory: item.mediaCategory,
    communityCategory: item.communityCategory,
  };
}

function compactHistoryImage(value, fallbackImage) {
  const image = String(value || "").trim();
  if (!image) return fallbackImage;
  if (image.startsWith("data:image/") && image.length > HISTORY_IMAGE_MAX_CHARS) return fallbackImage;
  return image;
}

function getFirebaseDataKstDateKey(data) {
  const kstText = firstNonEmpty(data?._meta?.updatedAtKst);
  if (/^\d{4}-\d{2}-\d{2}/.test(kstText)) return kstText.slice(0, 10);

  const isoText = firstNonEmpty(data?._meta?.updatedAt, data?.updatedAt);
  const date = new Date(isoText || "");
  if (Number.isNaN(date.getTime())) return "";
  return formatKstDateKey(date);
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || "").trim()) || "";
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

async function fetchCommunityTrendBuckets() {
  console.log("\n[커뮤니티 인기] 5개 커뮤니티 공식 인기글 카테고리별 수집");

  const sourceItems = await fetchCommunitySourceItems();
  enforceRequiredCommunitySource(sourceItems);
  const candidates = dedupeItems(sourceItems)
    .map((item) => ({
      ...item,
      type: "community",
      communityCategory: classifyCommunityCategory(item),
      trendScore: calculateTrendScore(item, "community"),
    }))
    .sort(compareTrendItems)
    .slice(0, Math.max(COMMUNITY_SOURCE_ITEM_LIMIT, MAX_ITEMS * COMMUNITY_FEEDS.length));

  const enrichedItems = await mapLimit(
    candidates,
    ARTICLE_CONCURRENCY,
    (item) => enrichExternalArticleImage(item, FALLBACK_IMAGES.community)
  );

  const rankedItems = enrichedItems
    .map((item) => ({
      ...item,
      communityCategory: item.communityCategory || classifyCommunityCategory(item),
      trendScore: calculateTrendScore(item, "community"),
    }))
    .sort(compareTrendItems);

  const buckets = {
    communityPopular: selectBalancedTopItems(rankedItems, MAX_ITEMS)
      .map((item, index) => toPublicTrendItem(item, index, "community", FALLBACK_IMAGES.community)),
  };

  for (const feed of COMMUNITY_FEEDS) {
    const categoryItems = rankedItems.filter((item) => item.communityCategory === feed.category);
    const topItems = selectBalancedTopItems(categoryItems, MAX_ITEMS)
      .map((item, index) => toPublicTrendItem(item, index, "community", FALLBACK_IMAGES.community));

    buckets[feed.key] = topItems;
    const shortageLabel = topItems.length < MAX_ITEMS ? " (후보 부족)" : "";
    console.log(
      `  - ${feed.label}: 후보 ${categoryItems.length}개, 이미지 ${
        topItems.filter((item) => isDisplayableImage(item.img)).length
      }개, 최종 ${topItems.length}/${MAX_ITEMS}개${shortageLabel}`
    );
  }

  console.log(
    `  - 전체HOT: 후보 ${rankedItems.length}개, 이미지 ${
      buckets.communityPopular.filter((item) => isDisplayableImage(item.img)).length
    }개, 최종 ${buckets.communityPopular.length}/${MAX_ITEMS}개`
  );

  return buckets;
}

function enforceRequiredCommunitySource(items) {
  if (!REQUIRE_COMMUNITY_SOURCE || items.length > 0) return;

  throw new Error(
    "커뮤니티 인기글 수집 결과가 0개입니다. 기존 Firebase 커뮤니티 데이터를 지우지 않기 위해 저장을 중단합니다. " +
      "임시로 부분 저장을 허용하려면 REQUIRE_COMMUNITY_SOURCE=0으로 설정하세요."
  );
}

async function fetchCommunitySourceItems() {
  const pageRequests = [];
  for (const source of COMMUNITY_SOURCES) {
    for (let page = 1; page <= COMMUNITY_PAGE_LIMIT; page += 1) {
      pageRequests.push({
        source,
        page,
        url: withPageParam(source.url, page),
      });
    }
  }

  const pageResults = await mapLimit(pageRequests, SOURCE_CONCURRENCY, async ({ source, page, url }) => {
    try {
      const html = await fetchText(url, {
        encoding: source.encoding,
        referer: source.referer || source.url,
        userAgent: source.userAgent,
      });
      const parsed = source
        .parser(html, { ...source, url })
        .filter((item) => item.title && item.link);
      const offset = (page - 1) * Math.max(parsed.length, SOURCE_ITEM_LIMIT);

      return parsed.map((item, index) => ({
        ...item,
        type: "community",
        sourceKey: source.key,
        source: source.siteName,
        siteName: source.siteName,
        boardName: item.boardName || source.label,
        sourceUrl: url,
        sourceRank: offset + (item.sourceRank || index + 1),
      }));
    } catch (error) {
      console.warn(`  - ${source.label} ${page}페이지 수집 실패: ${error.message}`);
      return [];
    }
  });

  const items = selectSourceBalancedCandidates(
    dedupeItems(pageResults.flat()),
    COMMUNITY_SOURCE_ITEM_LIMIT
  );
  const sourceCounts = COMMUNITY_SOURCES
    .map((source) => `${source.label} ${items.filter((item) => item.sourceKey === source.key).length}개`)
    .join(", ");
  console.log(`  - 통합 커뮤니티 후보: ${items.length}개 (${sourceCounts})`);
  return items;
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
      if (isOptionalMediaQuotaError(source.label, error)) {
        console.log(`  - ${source.label}: YouTube 할당량 제한으로 이번 회차 건너뜀`);
        return [];
      }
      console.warn(`  - ${source.label} 수집 실패: ${error.message}`);
      return [];
    }
  });

  const rawMediaItems = sourceResults.flat();
  enforceRequiredMediaSources(rawMediaItems);
  const replayItems = await fetchMediaReplayRankings();

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
    const categoryItems =
      feed.category === "replay"
        ? replayItems
        : feed.category === "music"
          ? buildMusicMediaItems(rankedItems, replayItems)
        : feed.category === "all"
          ? rankedItems
          : rankedItems.filter((item) => item.mediaCategory === feed.category);
    const topItems = (feed.category === "replay" ? selectBalancedTopItems(categoryItems, MAX_ITEMS) : selectMediaTopItems(categoryItems))
      .map((item, index) => toPublicTrendItem(item, index, "media", FALLBACK_IMAGES.mediaTrend));

    buckets[feed.key] = topItems;
    const shortageLabel = topItems.length < MAX_ITEMS ? " (후보 부족)" : "";
    console.log(
      `  - ${feed.label}: 후보 ${categoryItems.length}개, 이미지 ${
        topItems.filter((item) => isDisplayableImage(item.img)).length
      }개, 최종 ${topItems.length}/${MAX_ITEMS}개${shortageLabel}`
    );
  }

  return buckets;
}

async function fetchMediaReplayRankings() {
  console.log("  - 다시보기 후보 수집");

  const sourceFetchers = [
    { label: "치지직 VOD", fetcher: fetchChzzkReplayRankings },
  ];
  if (ENABLE_YOUTUBE_REPLAY) {
    sourceFetchers.splice(1, 0, { label: "YouTube 완료 라이브", fetcher: fetchYoutubeReplayRankings });
  }

  const sourceResults = await mapLimit(sourceFetchers, SOURCE_CONCURRENCY, async (source) => {
    try {
      const items = await source.fetcher();
      console.log(`    · ${source.label}: ${items.length}개`);
      return items;
    } catch (error) {
      if (isOptionalMediaQuotaError(source.label, error)) {
        console.log(`    · ${source.label}: YouTube 할당량 제한으로 이번 회차 건너뜀`);
        return [];
      }
      console.warn(`    · ${source.label} 수집 실패: ${error.message}`);
      return [];
    }
  });

  return dedupeItems(sourceResults.flat())
    .map((item) => ({
      ...item,
      type: "media",
      mediaCategory: "replay",
      trendScore: calculateReplayTrendScore(item),
    }))
    .sort(compareReplayTrendItems)
    .slice(0, Math.max(YOUTUBE_SOURCE_ITEM_LIMIT, MAX_ITEMS * 3));
}

function buildMusicMediaItems(liveItems, replayItems) {
  const liveMusicItems = liveItems.filter((item) => item.mediaCategory === "music" || classifyMediaCategory(item) === "music");
  const replayMusicItems = replayItems
    .filter((item) => classifyMediaCategory(item) === "music")
    .map((item) => ({
      ...item,
      mediaCategory: "music",
      trendScore: item.trendScore || calculateReplayTrendScore(item),
    }));

  return dedupeItems([...liveMusicItems, ...replayMusicItems]).sort(compareTrendItems);
}

function isOptionalMediaQuotaError(label, error) {
  return /youtube/i.test(String(label || "")) && /429|quota|too many requests/i.test(String(error?.message || ""));
}

function enforceRequiredMediaSources(items) {
  if (!REQUIRE_MEDIA_API_SOURCES) return;

  const missing = [];
  if (REQUIRE_TWITCH_SOURCE && !items.some(isTwitchItem)) missing.push("트위치");
  if (REQUIRE_YOUTUBE_SOURCE && !items.some(isYoutubeItem)) missing.push("유튜브");

  if (!missing.length) return;

  throw new Error(
    `${missing.join(", ")} 수집 결과가 0개입니다. API 키 또는 할당량을 확인하세요. ` +
      "기존 Firebase 데이터를 지우지 않기 위해 저장을 중단합니다. " +
      "해당 소스를 반드시 포함해야 할 때만 REQUIRE_MEDIA_API_SOURCES=1, REQUIRE_TWITCH_SOURCE=1, REQUIRE_YOUTUBE_SOURCE=1을 설정하세요."
  );
}

async function fetchMediaTrends() {
  const buckets = await fetchMediaTrendBuckets();
  return buckets.mediaHot || [];
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
      if (shouldExcludeYoutubeLive(snippet)) return null;
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

async function fetchYoutubeReplayRankings() {
  const apiKey = process.env.YOUTUBE_API_KEY || "";
  if (!apiKey) {
    console.warn("  - YouTube API 키가 없어 다시보기를 건너뜁니다.");
    return [];
  }

  const publishedAfter = new Date(Date.now() - YOUTUBE_REPLAY_RECENCY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const perQueryLimit = Math.min(8, Math.max(3, Math.ceil(YOUTUBE_SOURCE_ITEM_LIMIT / YOUTUBE_REPLAY_QUERIES.length)));
  const searchResults = await mapLimit(YOUTUBE_REPLAY_QUERIES, SOURCE_CONCURRENCY, async (query) => {
    const searchUrl = new URL(YOUTUBE_SEARCH_API_URL);
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("eventType", "completed");
    searchUrl.searchParams.set("order", "viewCount");
    searchUrl.searchParams.set("regionCode", "KR");
    searchUrl.searchParams.set("relevanceLanguage", "ko");
    searchUrl.searchParams.set("publishedAfter", publishedAfter);
    searchUrl.searchParams.set("maxResults", String(perQueryLimit));
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("key", apiKey);

    const response = await fetchJsonWithHeaders(searchUrl.toString());
    return (response?.items || []).map((item) => ({ ...item, youtubeQuery: query }));
  });

  const searchItems = dedupeYoutubeSearchItems(searchResults.flat()).slice(0, YOUTUBE_SOURCE_ITEM_LIMIT);
  const videoIds = uniqueCompact(searchItems.map((item) => item?.id?.videoId));
  if (videoIds.length === 0) return [];
  const queryByVideoId = new Map(searchItems.map((item) => [item.id.videoId, item.youtubeQuery || ""]));

  const videosUrl = new URL(YOUTUBE_VIDEOS_API_URL);
  videosUrl.searchParams.set("part", "snippet,statistics,contentDetails,liveStreamingDetails");
  videosUrl.searchParams.set("id", videoIds.join(","));
  videosUrl.searchParams.set("key", apiKey);

  const videosResponse = await fetchJsonWithHeaders(videosUrl.toString());
  const videoMap = new Map((videosResponse?.items || []).map((item) => [item.id, item]));

  return videoIds
    .map((videoId, index) => {
      const item = videoMap.get(videoId);
      if (!item?.id) return null;

      const snippet = item.snippet || {};
      if (shouldExcludeYoutubeReplay(snippet)) return null;
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
        boardName: inferYoutubeBoardName(query, snippet.title, "다시보기"),
        sourceKey: "youtubeReplay",
        sourceUrl: "https://www.youtube.com/",
        channelName: stripHtml(snippet.channelTitle || "YouTube"),
        viewerCount: 0,
        concurrentUserCount: 0,
        viewCount: toNumber(item.statistics?.viewCount),
        recommendCount: toNumber(item.statistics?.likeCount),
        commentCount: toNumber(item.statistics?.commentCount),
        viewTime: "다시보기",
        publishedLabel: "다시보기",
        publishedAt: snippet.publishedAt || item.liveStreamingDetails?.actualEndTime || new Date().toISOString(),
        rankingBasis: "YouTube Data API 완료 라이브 조회수 랭킹",
        liveId: item.id,
        channelId: snippet.channelId || "",
        tags: uniqueCompact([query, snippet.channelTitle, "다시보기"]),
      };
    })
    .filter(Boolean);
}

async function fetchChzzkReplayRankings() {
  const response = await fetchJsonWithHeaders(CHZZK_VIDEOS_API_URL, {
    headers: {
      ...basicBrowserHeaders(),
      Referer: "https://chzzk.naver.com/videos",
      Origin: "https://chzzk.naver.com",
    },
  });
  const items = response?.content?.data || [];

  return items
    .filter((item) => item?.videoNo && item.videoTitle && !item.adult && toNumber(item.readCount) > 0)
    .map((item, index) => {
      const channel = item.channel || {};
      const thumbnail = normalizeImageUrl(item.thumbnailImageUrl, "https://chzzk.naver.com/");
      const videoNo = item.videoNo || "";

      return {
        sourceRank: index + 1,
        title: stripHtml(item.videoTitle),
        link: videoNo ? `${CHZZK_VIDEO_PAGE_BASE}/${encodeURIComponent(videoNo)}` : "https://chzzk.naver.com/videos",
        previewUrl: "",
        previewType: "image",
        img: thumbnail,
        thumbnail,
        platformName: "치지직",
        source: "치지직",
        siteName: "치지직",
        boardName: item.videoCategoryValue || item.videoType || "다시보기",
        sourceKey: "chzzkReplay",
        sourceUrl: "https://chzzk.naver.com/videos",
        channelName: stripHtml(channel.channelName || "치지직"),
        viewerCount: 0,
        concurrentUserCount: 0,
        viewCount: toNumber(item.readCount),
        recommendCount: 0,
        commentCount: 0,
        viewTime: formatDurationLabel(item.duration) || "다시보기",
        publishedLabel: "다시보기",
        publishedAt: item.publishDateAt ? new Date(Number(item.publishDateAt)).toISOString() : parseKoreanDate(item.publishDate),
        rankingBasis: "치지직 공개 VOD 조회수 랭킹",
        liveId: item.videoId || videoNo,
        channelId: channel.channelId || item.channelId || "",
        tags: uniqueCompact([item.videoType, item.videoCategoryValue, ...(item.tags || []), "다시보기"]),
      };
    })
    .sort(compareReplayTrendItems)
    .slice(0, Math.max(MAX_ITEMS * 2, 20));
}

async function fetchTwitchReplayRankings(liveItems = []) {
  const clientId = process.env.TWITCH_CLIENT_ID || "";
  const clientSecret = process.env.TWITCH_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    console.warn("  - Twitch API 키가 없어 다시보기를 건너뜁니다.");
    return [];
  }

  const channelIds = uniqueCompact(
    liveItems
      .filter(isTwitchItem)
      .map((item) => item.channelId || item.userId)
  ).slice(0, 8);
  if (channelIds.length === 0) return [];

  const token = await fetchTwitchAppAccessToken(clientId, clientSecret);
  const videoGroups = await mapLimit(channelIds, SOURCE_CONCURRENCY, async (channelId) => {
    const url = new URL(TWITCH_VIDEOS_API_URL);
    url.searchParams.set("user_id", channelId);
    url.searchParams.set("first", "5");
    url.searchParams.set("type", "archive");
    url.searchParams.set("sort", "views");
    url.searchParams.set("period", "week");

    const response = await fetchJsonWithHeaders(url.toString(), {
      headers: {
        ...basicBrowserHeaders(),
        "Client-Id": clientId,
        Authorization: `Bearer ${token}`,
      },
    });

    return (response?.data || []).map((item) => ({
      sourceRank: 999,
      title: stripHtml(item.title),
      link: item.url || `${TWITCH_PAGE_BASE}/${encodeURIComponent(item.user_name || "")}`,
      previewUrl: "",
      previewType: "image",
      img: normalizeTwitchThumbnail(item.thumbnail_url),
      thumbnail: normalizeTwitchThumbnail(item.thumbnail_url),
      platformName: "트위치",
      source: "트위치",
      siteName: "트위치",
      boardName: item.type === "archive" ? "다시보기" : item.type || "VOD",
      sourceKey: "twitchReplay",
      sourceUrl: "https://www.twitch.tv/videos",
      channelName: stripHtml(item.user_name || "Twitch"),
      viewerCount: 0,
      concurrentUserCount: 0,
      viewCount: toNumber(item.view_count),
      recommendCount: 0,
      commentCount: 0,
      viewTime: item.duration || "다시보기",
      publishedLabel: "다시보기",
      publishedAt: item.published_at || item.created_at || new Date().toISOString(),
      rankingBasis: "Twitch Helix Videos API 주간 조회수 랭킹",
      liveId: item.id,
      channelId: item.user_id,
      tags: uniqueCompact([item.type, "다시보기"]),
    }));
  });

  return videoGroups
    .flat()
    .filter((item) => item.title && item.link)
    .sort((a, b) => toNumber(b.viewCount) - toNumber(a.viewCount))
    .map((item, index) => ({ ...item, sourceRank: index + 1 }))
    .slice(0, Math.max(MAX_ITEMS * 2, 20));
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
    imageIndex: getCafeThumbnailImageIndex(item),
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
    imageIndex: getCafeThumbnailImageIndex(item),
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
    if (error?.code === "BROKEN_IMAGE") {
      console.warn(`  - 깨진 보호 이미지 대체: ${item.title} (${error.message})`);
      return fallbackImage;
    }
    if (error?.code === "IMAGE_TOO_LARGE") {
      return image;
    }
    console.warn(`  - 보호 이미지는 원본 주소 사용: ${item.title} (${error.message})`);
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

  const cacheKey = `external:first:${item.link}`;
  if (articleImageCache.has(cacheKey)) return articleImageCache.get(cacheKey);

  const html = await fetchText(item.link, {
    timeoutMs: ARTICLE_TIMEOUT_MS,
    referer: item.sourceUrl || item.link,
  });
  const firstImage = extractFirstImageFromHtml(html, {
    baseUrl: item.link,
    imageIndex: 0,
  });

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
  const endpoints = range.endpoints?.length ? range.endpoints : [range.endpoint || "realtime"];
  const rawGroups = await mapLimit(endpoints, SOURCE_CONCURRENCY, (endpoint) => fetchNaverCafePopular(endpoint));
  return rawGroups
    .flat()
    .filter((entry) => entry?.type === "ARTICLE" && entry.item)
    .map((entry) => normalizeCafeArticle(entry.item, range))
    .filter((item) => item.title && item.link && item.readCount > 0)
    .sort(compareCafeArticles)
    .slice(0, getCafeSourceLimit(range));
}

async function fetchDaumCafeSource(range) {
  const html = await fetchText(DAUM_CAFE_TOP_URL, {
    referer: DAUM_CAFE_TOP_URL,
    userAgent: MOBILE_USER_AGENT,
  });
  return parseDaumCafePopular(html, range).slice(0, Math.max(getCafeSourceLimit(range), MAX_ITEMS));
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
      const rowText = stripHtml(row);
      const classCafeName = cleanCafeName(
        row.match(/<span\b[^>]*class=["'][^"']*popular-list__cafe-name[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""
      );
      const fallbackCafeName = rowText.match(/카페명\s*(.+)$/)?.[1] || "";
      const cafeName = cleanCafeName(
        (classCafeName && classCafeName !== "카페명" ? classCafeName : "") ||
          fallbackCafeName ||
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

  const desktopItems = rows.map((row, index) => {
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

  if (desktopItems.length > 0) return desktopItems;
  return parseDcinsideBestMobile(html, source);
}

function parseDcinsideBestMobile(html, source) {
  const rows = [
    ...html.matchAll(
      /<li\b[^>]*>\s*<div\b[^>]*class=["'][^"']*gall-detail-lnktb[^"']*["'][\s\S]*?<span\b[^>]*class=["'][^"']*blockInfo[^"']*["'][\s\S]*?<\/span>\s*<\/li>/gi
    ),
  ].map((match) => match[0]);

  return rows.map((row, index) => {
    const linkMatch = row.match(/<a\b[^>]*href=["']([^"']*\/board\/dcbest\/\d+[^"']*)["'][^>]*class=["'][^"']*\blt\b/i);
    const link = absolutizeUrl(linkMatch?.[1] || "", source.url);
    const subjectCell = row.match(/<span\b[^>]*class=["'][^"']*subjectin[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "";
    const rawTitle = stripHtml(subjectCell).replace(/\[[\d/]+\]\s*$/, "").trim();
    const galleryName = rawTitle.match(/^\[([^\]]+)\]/)?.[1] || "";
    const title = rawTitle.replace(/^\[[^\]]+\]\s*/, "").trim();
    const thumb = extractImageFromTag(row, source.url);
    const viewCount = parseCount(row.match(/조회\s*([\d,.만천]+)/i)?.[1]);
    const recommendCount = parseCount(row.match(/추천\s*<span[^>]*>\s*([\d,.만천]+)/i)?.[1]);
    const commentCount = parseCount(row.match(/<span\b[^>]*class=["'][^"']*\bct\b[^"']*["'][^>]*>\s*([\d,.만천]+)/i)?.[1]);
    const timeLabel = row.match(/<li>\s*((?:\d{1,2}:\d{2})|(?:\d{2}\.\d{2}))\s*<\/li>/i)?.[1] || "";
    const cleanGalleryName = galleryName && !/^\d+갤$/.test(galleryName) ? `디시 ${galleryName}` : source.siteName;

    return {
      sourceRank: index + 1,
      title,
      link,
      img: thumb,
      viewCount,
      recommendCount,
      commentCount,
      communityName: cleanGalleryName,
      publishedAt: timeLabel ? parseKoreanDate(timeLabel) : new Date().toISOString(),
      rankingBasis: `${source.label} 모바일 공식 목록`,
    };
  });
}

function parseTheqooHot(html, source) {
  const tbody = String(html || "").match(/<tbody\b[^>]*class=["'][^"']*hide_notice[^"']*["'][^>]*>([\s\S]*?)<\/tbody>/i)?.[1] || String(html || "");
  const rows = [...tbody.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
    .map((match) => match[0])
    .filter((row) => !/class=["'][^"']*notice/i.test(row) && /href=["'][^"']*\/hot\/\d+/i.test(row));

  return rows.map((row, index) => {
    const titleCell = row.match(/<td\b[^>]*class=["'][^"']*title[^"']*["'][\s\S]*?<\/td>/i)?.[0] || "";
    const linkMatch = titleCell.match(/<a\b[^>]*href=["']([^"']*\/hot\/\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    const link = absolutizeUrl(linkMatch?.[1] || "", source.url);
    const title = stripHtml(linkMatch?.[2] || "").replace(/\[[\d/]+\]\s*$/, "");
    const category = stripHtml(row.match(/<td\b[^>]*class=["'][^"']*cate[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || "");
    const commentCount = parseCount(titleCell.match(/class=["'][^"']*replyNum[^"']*["'][^>]*>\s*([\d,.만천]+)/i)?.[1]);
    const timeLabel = stripHtml(row.match(/<td\b[^>]*class=["'][^"']*time[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || "");
    const numberCells = [...row.matchAll(/<td\b[^>]*class=["'][^"']*m_no[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => stripHtml(match[1]));
    const viewCount = parseCount(numberCells.at(-1));

    return {
      sourceRank: index + 1,
      title,
      link,
      img: "",
      viewCount,
      recommendCount: 0,
      commentCount,
      communityName: category ? `더쿠 ${category}` : source.siteName,
      boardName: category || source.label,
      publishedAt: timeLabel ? parseKoreanDate(timeLabel) : new Date().toISOString(),
      rankingBasis: `${source.label} 공식 목록`,
    };
  }).filter((item) => item.title && item.link);
}

function parseRuliwebBest(html, source) {
  const rows = [...String(html || "").matchAll(/<tr\b[^>]*class=["'][^"']*table_body[^"']*["'][\s\S]*?<\/tr>/gi)]
    .map((match) => match[0])
    .filter((row) => !/class=["'][^"']*\bnotice\b[^"']*["']/i.test(row));

  return rows.map((row, index) => {
    const linkMatch = row.match(/<a\b[^>]*class=["'][^"']*subject_link[^"']*["'][^>]*href=["']([^"']+)["'][\s\S]*?<\/a>/i);
    const link = absolutizeUrl(linkMatch?.[1] || "", source.url);
    const linkHtml = linkMatch?.[0] || "";
    const cleanTitleHtml = linkHtml
      .replace(/<a\b[^>]*class=["'][^"']*num_reply[^"']*["'][\s\S]*?<\/a>/gi, " ")
      .replace(/<i\b[\s\S]*?<\/i>/gi, " ");
    const title = stripHtml(
      cleanTitleHtml.match(/<strong\b[^>]*class=["'][^"']*text_over[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i)?.[1] ||
        cleanTitleHtml.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ||
        cleanTitleHtml
    );
    const commentCount = parseCount(linkHtml.match(/class=["'][^"']*num_reply[^"']*["'][^>]*>\s*\(?([\d,.만천]+)/i)?.[1]);
    const recommendCount = parseCount(row.match(/<td\b[^>]*class=["'][^"']*recomd[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1]);
    const viewCount = parseCount(row.match(/<td\b[^>]*class=["'][^"']*hit[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1]);
    const timeLabel = stripHtml(row.match(/<td\b[^>]*class=["'][^"']*time[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || "");
    const boardName = inferRuliwebBoardName(link);

    return {
      sourceRank: index + 1,
      title,
      link,
      img: "",
      viewCount,
      recommendCount,
      commentCount,
      communityName: boardName ? `루리웹 ${boardName}` : source.siteName,
      boardName: boardName || source.label,
      publishedAt: timeLabel ? parseKoreanDate(timeLabel) : new Date().toISOString(),
      rankingBasis: `${source.label} 공식 목록`,
    };
  }).filter((item) => item.title && item.link);
}

function inferRuliwebBoardName(link) {
  try {
    const url = new URL(link);
    const text = `${url.pathname} ${url.search}`.toLowerCase();
    if (text.includes("humor")) return "유머";
    if (text.includes("game")) return "게임";
    if (text.includes("market")) return "핫딜";
    if (text.includes("ainfo") || text.includes("book")) return "애니/책";
    if (text.includes("news") || text.includes("userinfo")) return "정보";
    if (text.includes("community")) return "커뮤니티";
    return "베스트";
  } catch {
    return "베스트";
  }
}

function parsePpomppuHot(html, source) {
  const rows = [...String(html || "").matchAll(/<tr\b[^>]*class=["'][^"']*baseList[^"']*["'][\s\S]*?<\/tr>/gi)]
    .map((match) => match[0]);

  return rows.map((row, index) => {
    const titleLinks = [...row.matchAll(/<a\b[^>]*class=["'][^"']*baseList-title[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    const titleMatch = titleLinks.at(-1);
    const link = absolutizeUrl(titleMatch?.[1] || "", source.url);
    const title = stripHtml(titleMatch?.[2] || "");
    const boardName = stripHtml(row.match(/<td\b[^>]*class=["'][^"']*baseList-numb[^"']*["'][\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] || "");
    const thumbnail = extractImageFromTag(row, source.url);
    const commentCount = parseCount(row.match(/class=["'][^"']*list_comment\d*[^"']*["'][^>]*>\s*([\d,.만천]+)/i)?.[1]);
    const dateCells = [...row.matchAll(/<td\b[^>]*class=["'][^"']*board_date[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => stripHtml(match[1]));
    const recommendCount = parseCount(dateCells[1]?.split("-")[0] || "");
    const viewCount = parseCount(dateCells[2] || "");

    return {
      sourceRank: index + 1,
      title,
      link,
      img: thumbnail,
      viewCount,
      recommendCount,
      commentCount,
      communityName: boardName ? `뽐뿌 ${boardName}` : source.siteName,
      boardName: boardName || source.label,
      publishedAt: dateCells[0] ? parseKoreanDate(dateCells[0]) : new Date().toISOString(),
      rankingBasis: `${source.label} 공식 목록`,
    };
  }).filter((item) => item.title && item.link);
}

function parseInstizGreen(html, source) {
  const rows = [...String(html || "").matchAll(/<tr\b[^>]*id=["']detour["'][\s\S]*?<\/tr>/gi)]
    .map((match) => match[0]);

  return rows.map((row, index) => {
    const category = stripHtml(
      row.match(/<span\b[^>]*class=["'][^"']*list_category[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""
    );
    const subjectCell = row.match(/<td\b[^>]*class=["'][^"']*listsubject[^"']*["'][\s\S]*?<\/td>/i)?.[0] || "";
    const linkMatch = subjectCell.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const link = absolutizeUrl(linkMatch?.[1] || "", source.url);
    const titleHtml = String(linkMatch?.[2] || "")
      .replace(/<span\b[^>]*class=["'][^"']*cmt3?[^"']*["'][\s\S]*?<\/span>/gi, " ")
      .replace(/<i\b[\s\S]*?<\/i>/gi, " ");
    const title = stripHtml(titleHtml);
    const commentCount = parseCount(subjectCell.match(/class=["'][^"']*cmt3?[^"']*["'][^>]*>\s*([\d,.만천]+)/i)?.[1]);
    const cells = [...row.matchAll(/<td\b[^>]*class=["'][^"']*listno[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => stripHtml(match[1]));

    return {
      sourceRank: index + 1,
      title,
      link,
      img: "",
      viewCount: parseCount(cells[1]),
      recommendCount: parseCount(cells[2]),
      commentCount,
      communityName: category ? `인스티즈 ${category}` : source.siteName,
      boardName: category || source.label,
      publishedAt: cells[0] ? parseKoreanDate(cells[0]) : new Date().toISOString(),
      rankingBasis: `${source.label} 공식 목록`,
    };
  }).filter((item) => item.title && item.link);
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
  const isReplayMedia = type === "media" && (item.mediaCategory === "replay" || /Replay|VOD/i.test(item.sourceKey || ""));
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
    viewerCount: isReplayMedia ? 0 : toNumber(item.viewerCount || item.concurrentUserCount || item.viewCount),
    concurrentUserCount: isReplayMedia ? 0 : toNumber(item.concurrentUserCount || item.viewerCount || item.viewCount),
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
      communityCategory: item.communityCategory || classifyCommunityCategory(item),
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
  if (type === "media" && item.mediaCategory !== "replay" && toNumber(item.viewerCount || item.viewCount) > 0) {
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

function getCafeSourceLimit(range) {
  return toPositiveInt(range?.sourceLimit, SOURCE_ITEM_LIMIT);
}

function filterCafeArticlesByCategory(items, category) {
  if (!category) return items;
  return items
    .filter((item) => matchesCafeCategory(item, category))
    .sort((a, b) => cafeCategoryScore(b, category) - cafeCategoryScore(a, category) || compareCafeArticles(a, b));
}

function matchesCafeCategory(item, category) {
  const keywords = CAFE_CATEGORY_RULES[category] || [];
  if (keywords.length === 0) return true;
  if (category === "outfit") return cafeOutfitScore(item) > 0;
  const text = getCafeCategoryText(item);
  const titleText = normalizeCompactText(item.title);
  return keywords.some((keyword) => {
    const normalized = normalizeCompactText(keyword);
    if (category === "food" && normalized === "카페") return titleText.includes(normalized);
    return text.includes(normalized);
  });
}

function cafeCategoryScore(item, category) {
  if (category === "outfit") {
    const sourceScore = Math.max(0, 120 - normalizeRank(item.sourceRank || item.naverRank)) / 20;
    return cafeOutfitScore(item) + sourceScore;
  }

  const keywords = CAFE_CATEGORY_RULES[category] || [];
  const text = getCafeCategoryText(item);
  const matchScore = keywords.reduce(
    (score, keyword) => {
      const normalized = normalizeCompactText(keyword);
      const matched =
        category === "food" && normalized === "카페"
          ? normalizeCompactText(item.title).includes(normalized)
          : text.includes(normalized);
      return score + (matched ? 1 : 0);
    },
    0
  );
  const reviewScore = /후기|리뷰|추천|모음|정리|코스|메뉴|가격|내돈내산/i.test(
    [item.title, item.cafeName].filter(Boolean).join(" ")
  )
    ? 3
    : 0;
  const sourceScore = Math.max(0, 120 - normalizeRank(item.sourceRank || item.naverRank)) / 20;
  return matchScore * 10 + reviewScore + sourceScore;
}

function getCafeCategoryText(item) {
  return normalizeCompactText(
    [
      item.title,
      item.cafeName,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function cafeOutfitScore(item) {
  const titleText = normalizeCompactText(item.title);
  const sourceText = normalizeCompactText(
    [item.cafeName, item.source, item.siteName, item.boardName].filter(Boolean).join(" ")
  );
  const strongTitleMatches = CAFE_OUTFIT_STRONG_TITLE_KEYWORDS.reduce(
    (score, keyword) => score + (titleText.includes(normalizeCompactText(keyword)) ? 1 : 0),
    0
  );
  const weakTitleMatches = CAFE_OUTFIT_WEAK_TITLE_KEYWORDS.reduce(
    (score, keyword) => score + (titleText.includes(normalizeCompactText(keyword)) ? 1 : 0),
    0
  );
  const isFashionSource = CAFE_OUTFIT_SOURCE_KEYWORDS.some((keyword) =>
    sourceText.includes(normalizeCompactText(keyword))
  );

  if (strongTitleMatches > 0) return strongTitleMatches * 30 + weakTitleMatches * 8 + (isFashionSource ? 12 : 0);
  if (isFashionSource && weakTitleMatches > 0) return weakTitleMatches * 10 + 8;
  return 0;
}

function getCafeThumbnailImageIndex(item) {
  const text = normalizeCompactText(
    [item.cafeName, item.source, item.siteName, item.boardName, item.link].filter(Boolean).join(" ")
  );

  return SECOND_THUMBNAIL_CAFE_KEYWORDS.some((keyword) => text.includes(normalizeCompactText(keyword))) ? 1 : 0;
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

function compareReplayTrendItems(a, b) {
  return (
    toNumber(b.trendScore) - toNumber(a.trendScore) ||
    toNumber(b.viewCount) - toNumber(a.viewCount) ||
    toNumber(b.commentCount) - toNumber(a.commentCount) ||
    normalizeRank(a.sourceRank) - normalizeRank(b.sourceRank) ||
    Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)
  );
}

function selectSourceBalancedCandidates(items, maxItems) {
  const orderedSources = uniqueCompact([
    ...COMMUNITY_SOURCES.map((source) => source.key),
    ...items.map((item) => item.sourceKey),
  ]).filter((sourceKey) => items.some((item) => item.sourceKey === sourceKey));
  if (orderedSources.length <= 1) return items.slice(0, maxItems);

  const minimumPerSource = Math.max(1, Math.floor(maxItems / Math.max(orderedSources.length * 2, 1)));
  const selected = [];
  const selectedKeys = new Set();

  const addItem = (item) => {
    if (selected.length >= maxItems) return false;
    const key = normalizeDedupeKey(item);
    if (!key || selectedKeys.has(key)) return false;
    selectedKeys.add(key);
    selected.push(item);
    return true;
  };

  for (const sourceKey of orderedSources) {
    let sourceCount = 0;
    for (const item of items.filter((candidate) => candidate.sourceKey === sourceKey)) {
      if (sourceCount >= minimumPerSource) break;
      if (addItem(item)) sourceCount += 1;
    }
  }

  for (const item of items) {
    if (!addItem(item) && selected.length >= maxItems) break;
  }

  return selected.slice(0, maxItems);
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

function selectCafeItems(items, range, maxItems, minDaumItems = 0) {
  const selected = [];
  const selectedKeys = new Set();

  const addItem = (item) => {
    const key = normalizeDedupeKey(item);
    if (!key || selectedKeys.has(key)) return false;
    selectedKeys.add(key);
    selected.push(item);
    return true;
  };

  if (range?.includeDaum && minDaumItems > 0) {
    for (const item of items.filter(isDaumCafeItem)) {
      if (selected.filter(isDaumCafeItem).length >= minDaumItems) break;
      addItem(item);
    }
  }

  for (const item of items) {
    if (selected.length >= maxItems) break;
    addItem(item);
  }

  return selected.sort(compareCafeArticles).slice(0, maxItems);
}

function isDaumCafeItem(item) {
  return [item.sourceKey, item.source, item.siteName, item.link]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes("daum");
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

function calculateReplayTrendScore(item) {
  const sourceRank = normalizeRank(item.sourceRank);
  const rankScore = Math.max(0, SOURCE_ITEM_LIMIT + 1 - sourceRank) * 300;
  const ageHours = ageInHours(item.publishedAt);
  const recencyScore = Math.max(0, YOUTUBE_REPLAY_RECENCY_DAYS * 24 - ageHours) * 30;
  return (
    toNumber(item.viewCount) * 1.2 +
    toNumber(item.recommendCount) * 60 +
    toNumber(item.commentCount) * 35 +
    rankScore +
    recencyScore
  );
}

function calculateCafeTrendScore(item, range = {}) {
  const sourceRank = normalizeRank(item.sourceRank || item.naverRank);
  const rankLimit = Math.max(getCafeSourceLimit(range), SOURCE_ITEM_LIMIT, MAX_ITEMS, 20);
  const readCount = toNumber(item.readCount || item.viewCount);
  const likeCount = toNumber(item.likeCount || item.recommendCount);
  const commentCount = toNumber(item.commentCount);
  const ageHours = ageInHours(item.publishedAt);
  const mode = range.scoreMode || range.key || "daily";

  if (mode === "yearly") {
    const rankScore = Math.max(0, rankLimit + 1 - sourceRank) * 1800;
    const recencyScore = Math.max(0, 365 * 24 - ageHours) * 1.2;
    return rankScore + readCount * 1.9 + likeCount * 320 + commentCount * 190 + recencyScore;
  }

  if (mode === "monthly") {
    const rankScore = Math.max(0, rankLimit + 1 - sourceRank) * 3500;
    const recencyScore = Math.max(0, 30 * 24 - ageHours) * 18;
    return rankScore + readCount * 1.45 + likeCount * 280 + commentCount * 165 + recencyScore;
  }

  if (mode === "weekly") {
    const rankScore = Math.max(0, rankLimit + 1 - sourceRank) * 6500;
    const recencyScore = Math.max(0, 7 * 24 - ageHours) * 85;
    return rankScore + readCount * 1.05 + likeCount * 245 + commentCount * 135 + recencyScore;
  }

  const rankScore = Math.max(0, rankLimit + 1 - sourceRank) * 10000;
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
        "User-Agent": options.userAgent || USER_AGENT,
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
  const usableImages = [];

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
      usableImages.push(imageUrl);
    }
  }

  if (usableImages.length > 0) {
    const imageIndex = Math.max(0, toNumber(options.imageIndex));
    return usableImages[imageIndex] || usableImages[0];
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
    if (hostname.includes("ruliweb.com") && /ruliweb_bi|ruli_200|\/img\/2016\/common\//i.test(path)) {
      return false;
    }
    if (hostname.includes("instiz.net") && /\/data\/images\/|ico_app|ico_logo|ico_instiz|ico_green_leaf|btn_password/i.test(path)) {
      return false;
    }
    if (hostname.includes("pstatic.net") && /share\/images|appicon|naver_square/i.test(path)) {
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
    return (
      hostname.includes("dcinside.co.kr") ||
      hostname.includes("dcimg") ||
      hostname.includes("dccdn") ||
      hostname.includes("ruliweb.com") ||
      hostname.includes("instiz.net")
    );
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

  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText}`);
    if (response.status === 404 || response.status === 410) error.code = "BROKEN_IMAGE";
    throw error;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length <= 0 || bytes.length > EMBED_IMAGE_MAX_BYTES) {
    const error = new Error(`image size ${bytes.length} bytes`);
    error.code = bytes.length <= 0 ? "BROKEN_IMAGE" : "IMAGE_TOO_LARGE";
    throw error;
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

  const monthDayTime = text.match(/(\d{1,2})[./-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (monthDayTime) {
    const date = new Date(
      now.getFullYear(),
      Number(monthDayTime[1]) - 1,
      Number(monthDayTime[2]),
      Number(monthDayTime[3]),
      Number(monthDayTime[4]),
      Number(monthDayTime[5] || 0)
    );
    if (date.getTime() - now.getTime() > 7 * 24 * 60 * 60 * 1000) {
      date.setFullYear(date.getFullYear() - 1);
    }
    return date.toISOString();
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
  return imageUrl
    .replace(/\{width\}|%\{width\}/g, "640")
    .replace(/\{height\}|%\{height\}/g, "360");
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

function shouldExcludeYoutubeLive(snippet) {
  const text = [
    snippet?.title,
    snippet?.description,
    snippet?.channelTitle,
    snippet?.categoryId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!text) return true;
  if (YOUTUBE_BLOCKED_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) return true;

  const titleAndChannel = [snippet?.title, snippet?.channelTitle].filter(Boolean).join(" ");
  return isLikelyForeignBroadcast(titleAndChannel);
}

function shouldExcludeYoutubeReplay(snippet) {
  const text = [
    snippet?.title,
    snippet?.description,
    snippet?.channelTitle,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!text) return true;
  if (YOUTUBE_BLOCKED_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) return true;

  const titleAndChannel = [snippet?.title, snippet?.channelTitle].filter(Boolean).join(" ");
  return isLikelyForeignBroadcast(titleAndChannel);
}

function isLikelyForeignBroadcast(value) {
  const text = String(value || "");
  const hangulCount = (text.match(/[가-힣]/g) || []).length;
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;
  const cjkCount = (text.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length;

  if (hangulCount >= 2) return false;
  if (cjkCount > 0) return true;
  if (latinCount >= 12 && hangulCount === 0) return true;

  return hangulCount === 0;
}

function classifyCommunityCategory(item) {
  const sourceText = [
    item.communityCategory,
    item.title,
    item.communityName,
    item.boardName,
    item.siteName,
    item.source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ");

  for (const category of ["event", "humor", "entertainment", "issue"]) {
    const keywords = COMMUNITY_CATEGORY_RULES[category] || [];
    if (keywords.some((keyword) => sourceText.includes(keyword.toLowerCase()))) return category;
  }

  return "issue";
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

  for (const keyword of MEDIA_CATEGORY_RULES.talk) {
    if (sourceText.includes(keyword.toLowerCase())) return "talk";
  }

  return "talk";
}

function selectMediaTopItems(items) {
  const sortedItems = items.slice().sort(compareLiveTrendItems);
  const selected = [];
  for (const item of sortedItems) {
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

function withPageParam(rawUrl, page) {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("page", String(page));
    return url.toString();
  } catch {
    return rawUrl;
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
  return trimEdgeQuotes(stripHtml(value).replace(/^카페명\s*/i, ""));
}

function trimEdgeQuotes(value) {
  const quoteChars = new Set(["`", "'", '"', "\u2018", "\u2019", "\u201c", "\u201d"]);
  let text = String(value || "").trim();

  while (text && quoteChars.has(text[0])) {
    text = text.slice(1).trimStart();
  }
  while (text && quoteChars.has(text.at(-1))) {
    text = text.slice(0, -1).trimEnd();
  }

  return text;
}

function normalizeCompactText(value) {
  return stripHtml(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
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

function formatDurationLabel(seconds) {
  const totalSeconds = toNumber(seconds);
  if (totalSeconds <= 0) return "";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${Math.max(1, minutes)}분`;
}

function formatKstDateTime(date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatKstDateKey(date) {
  return formatKstDateTime(date).slice(0, 10);
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
