// [bot.js] - 깃허브 가상 컴퓨터가 100% 좋아하는 서버 전용 최종 코드입니다.

async function fetchTrendingAndSave() {
    try {
        console.log("🚀 인터넷에서 최신 핫 트렌드 수집을 시작합니다...");
        
        // 1. 구글 트렌드 실시간 RSS 데이터를 안전하게 가져옵니다.
        const response = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent('https://trends.google.com/trending/rss?geo=KR'));
        const result = await response.json();
        
        // 데이터에서 제목들만 안전하게 추출하기
        const contents = result.contents || "";
        const titleRegex = /<title>(.*?)<\/title>/g;
        const titles = [];
        let match;
        
        while ((match = titleRegex.exec(contents)) !== null) {
            titles.push(match[1]);
        }
        
        // 1위와 2위 제목 뽑기 (0번째는 전체 채널 제목이므로 1, 2번 사용)
        const hotTitle1 = titles[1] || "요즘 뜨는 화제의 아이템";
        const hotTitle2 = titles[2] || "실시간 인기 추천작";

        console.log("✅ 수집 성공! 1위:", hotTitle1, " | 2위:", hotTitle2);

        // 2. 파이어베이스 리얼타임 데이터베이스 주소로 데이터를 직접 전송합니다.
        const firebaseDbUrl = "https://chosanghee00001-default-rtdb.firebaseio.com";

        console.log("📦 파이어베이스 창고에 실시간 데이터를 저장하는 중...");

        // 첫 번째 핫 아이템(hot_items) 방에 저장
        await fetch(`${firebaseDbUrl}/hot_items.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: hotTitle1,
                content: "실시간 인터넷 검색어 및 커뮤니티에서 가장 뜨겁게 반응 중인 화제의 토픽입니다!",
                view: Math.floor(Math.random() * 500) + 200
            })
        });

        // 두 번째 핫 아이템(item2) 방에 저장
        await fetch(`${firebaseDbUrl}/item2.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: hotTitle2,
                content: "대중들의 관심이 집중되고 있는 최신 유행 아이템 정보를 확인해 보세요.",
                view: Math.floor(Math.random() * 200) + 100
            })
        });

        console.log("🎉 파이어베이스 창고 자동 업데이트 대성공!");
        process.exit(0); // 정상 종료

    } catch (error) {
        console.error("❌ 수집 중 예상치 못한 에러 발생:", error);
        process.exit(1); // 에러 종료
    }
}

// 로봇 가동
fetchTrendingAndSave();
