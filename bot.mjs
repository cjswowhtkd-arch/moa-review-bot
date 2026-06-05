// [bot.mjs] - 파이어베이스 프리패스 전송 및 에러 정밀 진단 버전

async function runRobot() {
    try {
        console.log("🚀 로봇 가동: 실시간 타임스탬프 데이터 조합 중...");

        const now = new Date();
        const krTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const timeStr = `${krTime.getMonth() + 1}/${krTime.getDate()} ${krTime.getHours()}:${krTime.getMinutes()}`;

        const categoriesData = {
            drama: [
                { title: `[${timeStr}] 미스터리 스릴러 콘텐츠 통합 시청률 1위`, content: "방금 집계된 실시간 차트 결과, 숨 막히는 복선 전개로 입소문을 탄 화제의 신작이 통합 차트 정상에 올랐습니다.", link: "https://search.naver.com" }
            ],
            tech: [
                { title: `[${timeStr}] 글로벌 IT 기업, 차세대 인공지능 디바이스 공개`, content: "네트워크 연결이 필요 없는 온디바이스 AI 탑재 스마트폰의 상세 벤치마크 점수와 한국 출시 라인업이 실시간 포착되었습니다.", link: "https://google.com" }
            ],
            dessert: [
                { title: `[${timeStr}] 성수동 오픈런 베이커리 맛집 시그니처 현황`, content: "SNS 누적 조회수 500만 회를 돌파하며 주말 대기 시간만 최소 1시간을 기록 중인 핫플레이스 디저트 카페 정보.", link: "https://search.naver.com" }
            ],
            news: [
                { title: `[${timeStr}] 금융시장 안정화를 위한 정부 긴급 동향 회의 소집`, content: "국내외 시장 변동성이 일시적으로 확대됨에 따라 유관 기관 관계자들이 모여 거시경제 지표 안정화 대책을 논의하기 시작했습니다.", link: "https://news.naver.com" }
            ],
            stock: [
                { title: `[${timeStr}] 바이오·제약 및 차세대 광통신 섹터 수주 모멘텀`, content: "신약 글로벌 임상 순항 소식과 함께 유선 네트워크 인프라 부품 제조 우량주를 중심으로 기관의 강한 매수세가 유입되고 있습니다.", link: "https://finance.naver.com" }
            ]
        };

        // 🚨 API 키 없이 깨끗한 기본 주소로만 찌릅니다 (파이어베이스 규칙이 true면 무조건 성공)
        const finalStoreUrl = "https://chosanghee00001-default-rtdb.firebaseio.com/categories.json";

        console.log("📦 파이어베이스 창고로 데이터를 전송합니다...");
        const response = await fetch(finalStoreUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(categoriesData)
        });

        if (response.ok) {
            console.log("🎉 [대성공] 파이어베이스 창고에 실시간 데이터 동기화가 완료되었습니다!");
            process.exit(0);
        } else {
            const errLog = await response.text();
            console.error(`❌ 파이어베이스가 거부함. 에러 내용: ${errLog}`);
            process.exit(1);
        }

    } catch (error) {
        console.error("❌ 로봇 내부 구동 에러:", error);
        process.exit(1);
    }
}

runRobot();
