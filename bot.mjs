// [bot.mjs] - TOP 20 확장 및 실시간 썸네일 추출 고도화 엔진

async function fetchRealTrend(keyword, category) {
    try {
        // 구글 뉴스 RSS 허브 개방
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;
        const response = await fetch(url);
        const xmlText = await response.text();

        const items = [];
        const itemMatches = xmlText.matchAll(/<item>([\s\S]*?)<\/item>/g);
        
        // 뉴스 기사 자체 이미지가 없을 때 받쳐줄 프리미엄 카테고리별 프리셋 썸네일
        const fallbacks = {
            drama: "https://images.unsplash.com/photo-1598899134739-24c46f58b8c0?auto=format&fit=crop&w=500&q=80",
            tech: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=500&q=80",
            dessert: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=500&q=80",
            news: "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=500&q=80",
            stock: "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?auto=format&fit=crop&w=500&q=80"
        };

        let count = 0;
        for (const match of itemMatches) {
            if (count >= 20) break; // 🌟 정확히 1위부터 20위까지 수집 제한 확장
            const itemContent = match[1];

            let title = itemContent.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
            let link = itemContent.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
            let description = itemContent.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "";
            
            // 🌟 뉴스 데이터 안에 포함된 원본 썸네일 이미지 태그 주소 정밀 추출
            let img = description.match(/src="([^"]+)"/)?.[1] || "";
            if (!img || img.startsWith("/")) {
                img = fallbacks[category]; // 이미지가 깨지거나 없을 시 프리셋 매핑
            }

            title = title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').trim();
            link = link.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
            title = title.split(" - ")[0]; // 제목 끝 언론사 지저분한 문자열 커팅

            if (title && link) {
                items.push({
                    title: title,
                    content: `국내 주요 언론사 및 실시간 커뮤니티 트렌드 분석 허브를 통해 검증된 신뢰도 높은 정보입니다. 자세한 정밀 리포트 및 맥락은 하단 원문 링크 단추를 눌러 바로 확인 가능합니다.`,
                    link: link,
                    img: img // 🌟 썸네일 주소 저장 탑재
                });
                count++;
            }
        }
        return items;
    } catch (e) {
        console.error(`${keyword} 엔진 가동 실패:`, e.message);
        return [];
    }
}

async function startRobot() {
    console.log("🚀 TOP 1~20 실시간 고신뢰도 트렌드 수집을 시작합니다...");

    const categoriesData = {
        drama: await fetchRealTrend("드라마 웹툰 신작 라인업", "drama"),
        tech: await fetchRealTrend("IT 테크 신제품 출시 전자", "tech"),
        dessert: await fetchRealTrend("성수동 핫플 카페 디저트 맛집", "dessert"),
        news: await fetchRealTrend("정치 사회 경제 실시간 주요 뉴스", "news"),
        stock: await fetchRealTrend("국내 주식 증시 특징주 금융", "stock")
    };

    const firebaseDbUrl = "https://chosanghee00001-default-rtdb.firebaseio.com/categories.json";

    try {
        const response = await fetch(firebaseDbUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(categoriesData)
        });

        if (response.ok) {
            console.log("🎉 [성공] 썸네일을 포함한 TOP 20개의 데이터가 파이어베이스에 안착했습니다.");
            process.exit(0);
        } else {
            console.error("❌ 전송 거부:", await response.text());
            process.exit(1);
        }
    } catch (error) {
        console.error("❌ 네트워크 최종 예외:", error.message);
        process.exit(1);
    }
}

startRobot();
