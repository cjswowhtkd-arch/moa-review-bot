// [bot.mjs] - 진짜 실시간 뉴스를 긁어와 카테고리별로 자동 분류하는 리얼 크롤러

async function fetchRealTrendingNews() {
    try {
        console.log("🌐 실시간 오픈 뉴스 허브망에 접속하여 크롤링을 시작합니다...");

        // 차단 걱정이 없는 공공 뉴스 RSS 허브망에서 대한민국 실시간 최신 뉴스 30개를 긁어옵니다.
        const targetUrl = encodeURIComponent('https://www.yonhapnewstv.co.kr/category/news/feed');
        const response = await fetch(`https://api.allorigins.win/get?url=${targetUrl}`);
        
        if (!response.ok) throw new Error("뉴스 허브망 통신 실패");
        
        const data = await response.json();
        const xmlText = data.contents || "";

        // XML 데이터에서 제목(title), 내용(description), 진짜 링크(link)를 쏙쏙 뽑아내는 정밀 추출기
        const items = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;

        while ((match = itemRegex.exec(xmlText)) !== null) {
            const itemContent = match[1];
            const title = (itemContent.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || itemContent.match(/<title>(.*?)<\/title>/) || [])[1] || "";
            const link = (itemContent.match(/<link>(.*?)<\/link>/) || [])[1] || "https://news.naver.com";
            const desc = (itemContent.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || itemContent.match(/<description>(.*?)<\/description>/) || [])[1] || "실시간 속보 뉴스입니다. 자세한 내용은 원문을 참조하세요.";

            if (title) {
                items.push({
                    title: title.trim(),
                    content: desc.replace(/<[^>]*>/g, '').substring(0, 90).trim() + "...", // HTML태그 제거 및 글자수 요약
                    link: link.trim()
                });
            }
        }

        console.log(`✅ 총 ${items.length}개의 리얼 타임 뉴스 수집 완료! 이제 카테고리 자동 분류를 시작합니다...`);

        // 기본 5대 카테고리 방 만들기
        const categoriesData = { drama: [], tech: [], dessert: [], news: [], stock: [] };

        // 긁어온 진짜 뉴스 제목을 분석해서 인공지능처럼 카테고리에 알맞게 집어넣기
        items.forEach(item => {
            const t = item.title;
            const c = item.content;

            if (t.match(/주식|증시|코스피|코스닥|금리|환율|은행|기업|결산|매수|외인/)) {
                categoriesData.stock.push(item);
            } else if (t.match(/반도체|스마트폰|AI|출시|유출|애플|삼성|디지털|IT|테크|컴퓨터/)) {
                categoriesData.tech.push(item);
            } else if (t.match(/드라마|넷플릭스|영화|웹툰|방송|연예|시청률|가수|아이돌/)) {
                categoriesData.drama.push(item);
            } else if (t.match(/맛집|카페|초콜릿|빵|디저트|축제|핫플|오픈런/)) {
                categoriesData.dessert.push(item);
            } else {
                categoriesData.news.push(item); // 일반 시사, 정치, 사회 뉴스는 기본 뉴스 탭으로
            }
        });

        // 🚨 혹시 특정 탭에 뉴스가 부족할 경우를 대비한 안전 보완 장치 (빈 공간 채우기)
        const defaultNews = [
            { title: "실시간 종합 뉴스 속보 랭킹", content: "현재 시각 가장 많은 누리꾼들이 조회하고 있는 실시간 종합 이슈 리포트입니다.", link: "https://news.naver.com" },
            { title: "오늘의 주요 카테고리 핫토픽", content: "인터넷 커뮤니티 및 주요 포털에서 뜨거운 감자로 떠오른 화제의 소식 모음.", link: "https://daum.net" },
            { title: "실시간 검색어 및 트렌드 분석", content: "실시간 검색어 빅데이터 분석 결과 대중들의 관심이 가장 집중된 영역입니다.", link: "https://google.com" }
        ];

        Object.keys(categoriesData).forEach(key => {
            // 수집된 뉴스가 3개보다 적으면 보완용 실시간 뉴스로 채워서 무조건 3개 맞추기
            while (categoriesData[key].length < 3) {
                categoriesData[key].push({
                    title: `${key.toUpperCase()} 관련 - ${defaultNews[categoriesData[key].length].title}`,
                    content: defaultNews[categoriesData[key].length].content,
                    link: defaultNews[categoriesData[key].length].link
                });
            }
            // 3개만 남기고 자르기
            categoriesData[key] = categoriesData[key].slice(0, 3);
        });

        // 파이어베이스 창고 주소 설정
        let firebaseDbUrl = "https://chosanghee00001-default-rtdb.firebaseio.com";
        if (!firebaseDbUrl.endsWith("/")) firebaseDbUrl += "/";

        console.log("📦 긁어온 리얼 데이터를 파이어베이스 창고에 실시간 동기화 중...");

        // 파이어베이스에 덮어쓰기
        await fetch(`${firebaseDbUrl}categories.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(categoriesData)
        });

        console.log("🎉 [대성공] 이제 진짜 실시간 데이터로 24시간 자동 가동됩니다!");
        process.exit(0);

    } catch (error) {
        console.error("❌ 크롤링 중 치명적 에러 발생:", error);
        process.exit(1);
    }
}

fetchRealTrendingNews();
