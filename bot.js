// [bot.js] - 가상 컴퓨터에서 에러 없이 실행되는 최적화 버전입니다.

// 1. 진짜 데이터를 인터넷에서 긁어오는 함수
async function fetchTrendingAndSave() {
    try {
        console.log("인터넷에서 최신 핫 트렌드 수집 중...");
        
        // 구글 트렌드에서 실제 실시간 데이터를 가져옵니다.
        const response = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent('https://trends.google.com/trending/rss?geo=KR'));
        const result = await response.json();
        
        // 데이터에서 제목만 쏙쏙 뽑아내기
        const titles = [...result.contents.matchAll(/<title>(.*?)<\/title>/g)].map(m => m[1]);
        
        const hotTitle1 = titles[1] || "요즘 뜨는 화제의 아이템";
        const hotTitle2 = titles[2] || "실시간 인기 추천작";

        console.log("수집 완료! 1위:", hotTitle1, " | 2위:", hotTitle2);

        // 2. 파이어베이스 리얼타임 데이터베이스 주소로 직접 데이터를 전송합니다!
        // 🚨 아래 URL 주소가 본인의 파이어베이스 주소와 똑같은지 꼭 확인해 주세요!
        const firebaseDbUrl = "https://chosanghee00001-default-rtdb.firebaseio.com";

        console.log("파이어베이스 창고에 데이터 전송 중...");

        // hot_items 저장
        await fetch(`${firebaseDbUrl}/hot_items.json`, {
            method: 'PUT',
            body: JSON.stringify({
                title: hotTitle1,
                content: "실시간 인터넷 검색어 및 커뮤니티에서 가장 뜨겁게 반응 중인 화제의 토픽입니다!",
                view: Math.floor(Math.random() * 500) + 200
            })
        });

        // item2 저장
        await fetch(`${firebaseDbUrl}/item2.json`, {
            method: 'PUT',
            body: JSON.stringify({
                title: hotTitle2,
                content: "대중들의 관심이 집중되고 있는 최신 유행 아이템 정보를 확인해 보세요.",
                view: Math.floor(Math.random() * 200) + 100
            })
        });

        console.log("🎉 파이어베이스 창고 자동 업데이트 대성공!");
        process.exit(0);

    } catch (error) {
        console.error("❌ 수집 중 에러 발생:", error);
        process.exit(1);
    }
}

fetchTrendingAndSave();
