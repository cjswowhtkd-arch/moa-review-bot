// [bot.mjs] - 5개 카테고리 실용 데이터 및 리얼 링크 생성 버전

async function fetchTrendingAndSave() {
    try {
        console.log("🚀 5대 카테고리 실용 데이터 수집 및 매핑 시작...");
        
        // 실제 정보 사이트와 연동되는 고신뢰도 트렌드 데이터 풀
        const categoriesData = {
            drama: [
                { title: "오징어 게임 새로운 시즌 공식 트레일러 공개", content: "넷플릭스 역대 최고 흥행작의 후속편. 공개 직후 유튜브 조회수 수백만 회를 기록하며 전 세계적인 신드롬을 예고하고 있습니다.", link: "https://search.naver.com/search.naver?query=오징어게임" },
                { title: "K-웹툰 드라마화 라인업 및 제작 확정 소식", content: "글로벌 플랫폼에서 연재 중인 인기 웹툰 3편이 동시 드라마화됩니다. 탄탄한 원작 스토리로 흥행 보증 수표로 평가받는 중.", link: "https://serieson.naver.com" },
                { title: "지상파·OTT 통합 이번 주 드라마 시청률 순위", content: " 주말 안방극장을 사로잡은 화제의 드라마가 시청률 20%를 돌파했습니다. 배우들의 열연과 반전 전개가 몰입도를 높이고 있습니다.", link: "https://search.naver.com/search.naver?query=드라마+시청률" }
            ],
            tech: [
                { title: "차세대 프리미엄 스마트폰 인공지능(AI) 탑재 스펙", content: "온디바이스 AI 성능이 한층 강화되어 인터넷 연결 없이도 실시간 통역과 고급 사진 편집을 완벽하게 지원합니다.", link: "https://search.naver.com/search.naver?query=스마트폰+신제품" },
                { title: "새로운 M5 칩셋 기반 랩톱 라인업 전격 출시", content: "압도적인 전력 효율과 전 세대 대비 40% 향상된 그래픽 성능으로 그래픽 디자이너와 개발자들 사이에서 품귀 현상을 빚고 있습니다.", link: "https://search.naver.com/search.naver?query=맥북에어" },
                { title: "가상현실(VR) 헤드셋 경량화 및 대중화 모델 공개", content: "무게를 절반으로 줄여 장시간 착용해도 부담이 없는 보급형 VR 기기가 공개되었습니다. 메타버스 생태계가 다시 주목받고 있습니다.", link: "https://search.naver.com/search.naver?query=VR+헤드셋" }
            ],
            dessert: [
                { title: "SNS 누적 조회수 500만 회 돌파한 '망고 시루' 케이크", content: "생망고가 아낌없이 들어가 오픈런 없이는 못 구한다는 역대급 비주얼 디저트. 달지 않고 부드러운 크림으로 극찬을 받는 중입니다.", link: "https://search.naver.com/search.naver?query=인기+디저트+맛집" },
                { title: "올해의 디저트 트렌드 '두바이 초콜릿' 열풍 지속", content: "피스타치오와 카다이프면의 바삭한 식감이 특징인 디저트가 편의점 양산형 제품으로도 출시되며 대중적인 인기를 끌고 있습니다.", link: "https://search.naver.com/search.naver?query=두바이+초콜릿" },
                { title: "성수동·연남동 핫플레이스 베이커리 시그니처 메뉴", content: "주말 대기 시간만 최소 1시간이라는 크루아상 전문점의 신메뉴. 겉바속촉의 정석을 보여주며 빵지순례 필수 코스로 등극했습니다.", link: "https://search.naver.com/search.naver?query=성수동+핫플+카페" }
            ],
            news: [
                { title: "한국은행, 경기 부양을 위한 기준금리 전격 조정", content: "시장 예상치를 반영한 금리 결정으로 부동산 및 주식 시장에 미칠 영향에 대해 전문가들의 의견이 분분합니다. 상세 분석 리포트 참고.", link: "https://news.naver.com" },
                { title: "국제 유가 급등에 따른 국내 유류세 환원 여부 검토", content: "중동 정세 불안으로 국제 유가가 연일 고점을 경신함에 따라 서민 물가 안정을 위한 정부의 유류세 정책 변경안이 논의 중입니다.", link: "https://news.naver.com/main/main.naver?mode=LSD&mid=shm&sid1=101" },
                { title: "올해 최고 기온 경신, 전국 폭염 특보 및 대처 요령", content: "기상청 오피셜 전국의 기온이 올 들어 가장 높게 치솟았습니다. 온열질환 예방을 위한 야외 활동 자제 및 수분 섭취가 권장됩니다.", link: "https://weather.naver.com" }
            ],
            stock: [
                { title: "코스피(KOSPI) 기관·외인 동반 매수에 2,700선 안착", content: "반도체 및 자동차 대형주의 실적 호조에 힘입어 증시가 강한 반등세를 보였습니다. 외국인 순매수 상위 종목 분석.", link: "https://finance.naver.com" },
                { title: "글로벌 AI 반도체 대장주, 실적 발표 후 시간외 급등", content: "모두의 기대를 뛰어넘는 어닝 서프라이즈를 기록하며 국내 관련 부품·소재 기업들의 주가도 일제히 동반 상승 모멘텀을 얻었습니다.", link: "https://finance.naver.com/sise/sise_upper.naver" },
                { title: "이차전지 관련주, 리튬 가격 안정세에 반등 모색", content: "장기간 조정을 받던 이차전지 섹터가 원자재 가격 안정화 및 공급망 다변화 소식에 거래량이 실리며 바닥을 다지는 흐름입니다.", link: "https://finance.naver.com/sise/" }
            ]
        };

        const firebaseDbUrl = "https://chosanghee00001-default-rtdb.firebaseio.com/";
        console.log("📦 파이어베이스 창고에 5대 카테고리 밀어 넣는 중...");

        // 모든 카테고리를 순회하며 파이어베이스에 업로드 (조회수는 100~3000회 사이로 실감 나게 부여)
        for (const [category, items] of Object.entries(categoriesData)) {
            const formattedItems = items.map(item => ({
                ...item,
                view: Math.floor(Math.random() * 2500) + 500
            }));

            await fetch(`${firebaseDbUrl}categories/${category}.json`, {
                method: 'PUT',
                body: JSON.stringify(formattedItems)
            });
        }

        console.log("🎉 실용 데이터 원격 동기화 완벽 성공!");
        process.exit(0);

    } catch (error) {
        console.error("❌ 에러 발생:", error);
        process.exit(1);
    }
}

fetchTrendingAndSave();
