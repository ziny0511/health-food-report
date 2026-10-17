// 네이버 데이터랩(API HUB) 검색어 트렌드로 건강기능식품 카테고리별 주간 추이를 수집한다.
// 사용법: node scripts/datalab-trend.mjs [끝나는 일요일 YYYY-MM-DD]
// 키 파일: 저장소 밖 ../naver-datalab.env (NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, "..", "naver-datalab.env");
const ENDPOINT = "https://naverapihub.apigw.ntruss.com/search-trend/v1/search";

// 모든 요청에 같이 넣어 요청 간 상대지수를 맞추는 기준 그룹
const ANCHOR = { groupName: "기준:비타민", keywords: ["비타민", "종합비타민", "멀티비타민"] };

const CATEGORIES = [
  { groupName: "장건강", keywords: ["유산균", "프로바이오틱스", "장건강", "장영양제", "포스트바이오틱스"] },
  { groupName: "혈당", keywords: ["혈당", "혈당영양제", "바나바잎", "혈당유산균", "혈당관리"] },
  { groupName: "관절", keywords: ["콘드로이친", "관절영양제", "MSM", "보스웰리아", "관절건강"] },
  { groupName: "눈", keywords: ["루테인", "지아잔틴", "눈영양제", "눈건강"] },
  { groupName: "수면", keywords: ["아쉬아간다", "테아닌", "수면영양제", "락티움"] },
  { groupName: "단백질", keywords: ["단백질보충제", "프로틴", "단백질쉐이크", "근감소", "HMB"] },
  { groupName: "이너뷰티", keywords: ["콜라겐", "저분자콜라겐", "이너뷰티", "히알루론산", "글루타치온"] },
];

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_]+)\s*=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].trim();
  }
  if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET) throw new Error(`키 파일에 NAVER_CLIENT_ID/NAVER_CLIENT_SECRET이 없습니다: ${path}`);
  return env;
}

const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

// 기본값: 오늘 기준 직전 일요일
function lastSunday(today = new Date()) {
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  return addDays(d, -((d.getUTCDay() + 7) % 7 || 7));
}

async function fetchTrend(env, startDate, endDate, groups) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "X-NCP-APIGW-API-KEY-ID": env.NAVER_CLIENT_ID,
      "X-NCP-APIGW-API-KEY": env.NAVER_CLIENT_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ startDate, endDate, timeUnit: "week", keywordGroups: groups }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const round = (x) => Math.round(x * 100) / 100;

async function main() {
  const env = loadEnv(ENV_PATH);
  const end = process.argv[2] ? new Date(process.argv[2] + "T00:00:00Z") : lastSunday();
  const start = addDays(end, -(104 * 7) + 1); // 104주 = 전년 동기 비교용 2년
  const startDate = ymd(start), endDate = ymd(end);

  // 데이터랩은 요청당 5그룹까지라 기준 그룹 + 4개씩 나눠 요청
  const batches = [];
  for (let i = 0; i < CATEGORIES.length; i += 4) batches.push([ANCHOR, ...CATEGORIES.slice(i, i + 4)]);

  const series = {};
  let anchorBase = null;
  for (const groups of batches) {
    const json = await fetchTrend(env, startDate, endDate, groups);
    const byTitle = Object.fromEntries(json.results.map((r) => [r.title, r.data]));
    const anchor = byTitle[ANCHOR.groupName];
    const anchorSum = anchor.reduce((s, p) => s + p.ratio, 0);
    if (anchorBase === null) anchorBase = { sum: anchorSum, data: anchor };
    const scale = anchorBase.sum / anchorSum; // 첫 요청의 기준 그룹 크기에 맞춰 환산
    for (const g of groups.slice(1)) {
      series[g.groupName] = (byTitle[g.groupName] || []).map((p) => ({ period: p.period, value: round(p.ratio * scale) }));
    }
  }
  series[ANCHOR.groupName] = anchorBase.data.map((p) => ({ period: p.period, value: round(p.ratio) }));

  // 카테고리별 요약 지표. 주 단위 값은 연휴 영향이 커서 전년 비교는 4주·12주 평균으로 한다.
  // share = 카테고리 ÷ 기준 그룹. 네이버 전체 검색량 변화를 걷어낸 "관심 점유율".
  const a = series[ANCHOR.groupName].map((p) => p.value);
  const summary = CATEGORIES.map(({ groupName }) => {
    const s = series[groupName];
    const v = s.map((p) => p.value);
    const n = v.length, last = v[n - 1];
    const win = (xs, from, len) => avg(xs.slice(n - from, n - from + len));
    const share12 = win(v, 12, 12) / win(a, 12, 12);
    const share12ly = win(v, 64, 12) / win(a, 64, 12);
    return {
      category: groupName,
      week: s[n - 1]?.period,
      value: last,
      wow: pct(last, v[n - 2]),
      vs4wAvg: pct(last, win(v, 5, 4)),
      yoy4w: n >= 56 ? pct(win(v, 4, 4), win(v, 56, 4)) : null,
      yoy12w: n >= 64 ? pct(win(v, 12, 12), win(v, 64, 12)) : null,
      share12w: round(share12 * 100),
      shareYoy12w: n >= 64 ? pct(share12, share12ly) : null,
    };
  });
  const anchorYoy12w = pct(avg(a.slice(-12)), avg(a.slice(-64, -52)));

  const out = {
    generatedAt: new Date().toISOString(),
    source: "NAVER DataLab 검색어 트렌드 (API HUB), 주간, 기준 그룹으로 요청 간 환산",
    startDate, endDate, anchor: ANCHOR, anchorYoy12w, categories: CATEGORIES, summary, series,
  };
  mkdirSync(join(ROOT, "data"), { recursive: true });
  const file = join(ROOT, "data", `trend-${endDate}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  writeFileSync(join(ROOT, "data", "trend-latest.json"), JSON.stringify(out));
  console.log(`saved ${file} (+ trend-latest.json), anchor yoy12w ${anchorYoy12w}%`);
  console.table(summary);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
