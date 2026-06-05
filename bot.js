// [bot.js] - 깃허브가 대신 실행해줄 자동 수집기 로봇 코드입니다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// 1. 내 파이어베이스 주소 설정 (여기에 본인의 진짜 정보를 입력해 주세요!)
const firebaseConfig = {
  apiKey: "AIzaSyCcFkzVkZ2ui3WSIkFbxDa3m5OvebXSfk4",
  authDomain: "chosanghee00001.firebaseapp.com",
  databaseURL: "https://chosanghee00001-default-rtdb.firebaseio.com",
  projectId: "chosanghee00001",
  storageBucket: "chosanghee00001.firebasestorage.app",
  messagingSenderId: "705786109560",
  appId: "1:705786109560:web:01b69c754e13df96e8978d",
  measurementId: "G-E566V33J74"
};


// 파이어베이스 켜기
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 2. 외부 인터넷 트렌드 API에서 진짜 데이터를 긁어오는 함수
async function fetchTrendingData() {
    try {
        console.log("인터넷에서 최신 핫 트렌드 수집 중...");
        
        // 실제 오픈된 트렌드 RSS 피드나 뉴스 API 주소를 사용합니다.
        // 여기서는 안전하게 테스트할 수 있는 오픈 트렌드 데이터 주소를 호출합니다.
        const response = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent('https://trends.google.com/trending/rss?geo=KR'));
        const result = await response.json();
        
        // 가져온 텍스트 데이터에서 제목만 쏙쏙 뽑아내는 작업 (정규식 크롤링)
        const titles = [...result.contents.matchAll(/<title>(.*?)<\/title>/g)].map(m => m[1]);
        
        // 핫 아이템 1위와 2위 추출 (0번째는 채널 타이틀이므로 1, 2번째 사용)
        const hotTitle1 = titles[1] || "요즘 뜨는 핫 아이템";
        const hotTitle2 = titles[2] || "실시간 추천 창작물";

        console.log("수집 완료! 1위:", hotTitle1, " | 2위:", hotTitle2);

        // 3. 수집한 진짜 데이터를 파이어베이스 창고에 자동으로 집어넣기!
        // 기존의 나혼렙, 갤럭시26 대신 이 진짜 데이터로 실시간 교체됩니다.
        await set(ref(db, 'hot_items'), {
            title: hotTitle1,
            content: "실시간 인터넷 검색어 및 커뮤니티에서 가장 뜨겁게 반응 중인 화제의 토픽입니다!",
            view: Math.floor(Math.random() * 500) + 200 // 실시간으로 변하는 가짜 조회수 부여
        });

        await set(ref(db, 'item2'), {
            title: hotTitle2,
            content: "대중들의 관심이 집중되고 있는 최신 유행 아이템 정보를 확인해 보세요.",
            view: Math.floor(Math.random() * 200) + 100
        });

        console.log("파이어베이스 창고 업데이트 성공 완료!");
        process.exit(0);

    } catch (error) {
        console.error("수집 중 에러 발생:", error);
        process.exit(1);
    }
}

fetchTrendingData();
