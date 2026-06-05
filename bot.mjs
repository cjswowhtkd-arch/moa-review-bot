// [bot.mjs] - 카테고리별 다중 데이터 생성 및 저장 버전

async function fetchTrendingAndSave() {
    try {
        console.log("🚀 카테고리별 다중 데이터 수집 및 조합 시작...");
        
        // 1. 카테고리별 풍성한 랜덤 데이터베이스 풀
        const dramaPool = [
            { title: "오징어 게임 시즌3 공개일 확정", content: "성기훈의 복수극이 드디어 베일을 벗습니다. 전 세계 팬들이 밤잠을 설치며 기다린 역대급 스케일과 새로운 게임들의 등장!", link: "https://naver.com" },
            { title: "눈물의 여왕 스페셜 에피소드", content: "미공개 비하인드 컷과 주연 배우들의 코멘터리가 담긴 스페셜 방송이 편성되었습니다. 아직 끝나지 않은 여운을 느껴보세요.", link: "https://daum.net" },
            { title: "주술회전 최종화 애니화 결정", content: "원작의 감동을 뛰어넘는 역대급 액션 연출 예고! 전 세계 애니메이션 차트를 뒤흔들 준비를 마쳤습니다.", link: "https://google.com" },
            { title: "나 혼자만 레벨업 외전 연재", content: "성진우의 끝나지 않은 이야기, 새로운 적과 동료들의 등장으로 다시 한번 K-웹툰의 신화를 써 내려갑니다.", link: "https://naver.com" }
        ];

        const techPool = [
            { title: "갤럭시 Z플립7 디자인 유출", content: "외부 화면이 전면을 덮는 혁신적인 변화! 배터리 수명도 대폭 늘어나 역대급 완성도를 자랑할 것으로 보입니다.", link: "https://naver.com" },
            { title: "M5 칩셋 장착 맥북에어 전격 출시", content: "인공지능(AI) 연산 속도가 2배 빨라진 괴물 칩셋 탑재. 하루 종일 써도 배터리가 남는 압도적인 전력 효율을 보여줍니다.", link: "https://daum.net" },
            { title: "아이폰 18 프로 '카메라의 혁신'", content: "가라앉은 잠망경 구조의 렌즈로 카툭튀가 완전히 사라집니다. 전문가급 영화 촬영이 가능한 시네마틱 모드 탑재.", link: "https://google.com" },
            { title: "플레이스테이션6 초기 스펙 공개", content: "8K 해상도에서 끊김 없는 120프레임 구현 가능. 완전히 새로운 차원의 가상 현실 게임 콘솔의 표준을 제시합니다.", link: "https://daum.net" }
        ];

        // 무작위로 섞어서 3개씩만 뽑아내기
        const dramaData = dramaPool.sort(() => 0.5 - Math.random()).slice(0, 3);
        const techData = techPool.sort(() => 0.5 - Math.random()).slice(0, 3);

        const firebaseDbUrl = "https://chosanghee00001-default-rtdb.firebaseio.com/";
        console.log("📦 파이어베이스에 카테고리 데이터 심는 중...");

        // 파이어베이스에 카테고리 구조로 통째로 덮어쓰기 (조회수는 랜덤 부여)
        await fetch(`${firebaseDbUrl}/categories/drama.json`, {
            method: 'PUT',
            body: JSON.stringify(dramaData.map(item => ({ ...item, view: Math.floor(Math.random() * 500) + 100 })))
        });

        await fetch(`${firebaseDbUrl}/categories/tech.json`, {
            method: 'PUT',
            body: JSON.stringify(techData.map(item => ({ ...item, view: Math.floor(Math.random() * 500) + 100 })))
        });

        console.log("🎉 카테고리 데이터 자동 업데이트 대성공!");
        process.exit(0);

    } catch (error) {
        console.error("❌ 에러 발생:", error);
        process.exit(1);
    }
}

fetchTrendingAndSave();
