// [bot.mjs] - 구글 뉴스 RSS를 활용한 실제 기사/블로그 링크 추출 로봇

// 구글 RSS에서 데이터를 안전하게 파싱하는 핵심 함수
async function fetchRealTrend(keyword) {
    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;
        const response = await fetch(url);
        const xmlText = await response.text();

        const items = [];
        // <item> 태그 내부를 추출하는 정규식
        const itemMatches = xmlText.matchAll(/<item>([\s\S]*?)<\/item>/g);
        
        let count = 0;
        for (const match of itemMatches) {
            if (count >= 3) break; // 카테고리당 상위 3개만 추출
            const itemContent = match[1];

            let title = itemContent.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
            let link = itemContent.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
            
            // CDATA 태그 및 HTML 불순물 제거 깔끔화
            title = title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').trim();
            link = link.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();

            // 구글 뉴스 특성상 제목 끝에 붙는 언론사명 제거 (예: "드라마 속보 - 조선일보" -> "드라마 속보")
            title = title.split(" - ")[0];

            if (title && link) {
                items.push({
                    title: title,
                    content: `🔥 해당 키워드와 관련하여 현재 언론사 및 커뮤니티(블로그/카페)에서 실시간으로 쏟아지는 가장 뜨거운 핫이슈 정보입니다. 자세한 내용은 아래 원문 보기 단추를 눌러 확인하세요.`,
                    link: link // 🌟 검색창이 아닌 실제 뉴스/블로그 다이렉트 주소 매핑
                });
                count++;
            }
        }
        return items;
    } catch (e) {
        console.error(`${keyword} 데이터 수집 중 오류:`, e.message);
        return [{ title: "실시간 정보 갱신 중", content: "잠시 후 데이터가 동기화됩니다.", link: "#" }];
    }
}

async function startRobot() {
    console.log("🚀 실시간 트렌드 기사/블로그 링크 추출 엔진 가동...");

    // 각 카테고리별로 구글 RSS 허브에서 진짜 살아있는 뉴스/글 주소를 긁어옵니다.
    const categoriesData = {
        drama: await fetchRealTrend("드라마 웹툰 신작 라인업"),
        tech: await fetchRealTrend("IT 테크 신제품 출시"),
        dessert: await fetchRealTrend("성수동 핫플 카페 디저트 맛집"),
        news: await fetchRealTrend("사회 경제 실시간 주요 뉴스"),
        stock: await fetchRealTrend("국내 주식 증시 특징주 금융")
    };

    // 파이어베이스 저장소 주소 (기존 index.html이categories.json을 바라보고 있다면 이걸로 유지)
    const firebaseDbUrl = "https://chosanghee00001-default-rtdb.firebaseio.com/categories.json";

    console.log("📦 긁어온 진짜 기사 주소들을 파이어베이스 창고에 동기화 중...");
    try {
        const response = await fetch(firebaseDbUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(categoriesData)
        });

        if (response.ok) {
            console.log("🎉 [대성공] 이제 사이트에서 카드를 누르면 진짜 기사/블로그로 바로 이동합니다!");
            process.exit(0);
        } else {
            console.error("❌ 파이어베이스 전송 실패:", await response.text());
            process.exit(1);
        }
    } catch (error) {
        console.error("❌ 네트워크 최종 에러:", error.message);
        process.exit(1);
    }
}

startRobot();
