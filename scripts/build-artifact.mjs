// GitHub Pages 사이트 내용을 Claude 아티팩트용 단일 HTML 한 장으로 묶는다.
// 사용법: node scripts/build-artifact.mjs  →  artifact/dist/health-food-weekly.html
// 아티팩트는 페이지 간 이동·외부 fetch가 제한되므로 주차 목록, 각 주차 리포트 본문, 트렌드·심층 분석 데이터를 모두 페이지 안에 넣는다.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
// </script> 가 데이터 안에서 태그를 닫지 않도록 < 를 이스케이프
const embed = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

// 주차 목록: index.html 의 <script type="application/json" id="weeks">
const weeksMatch = /<script type="application\/json" id="weeks">([\s\S]*?)<\/script>/.exec(read("index.html"));
if (!weeksMatch) throw new Error("index.html 에서 weeks 데이터를 찾지 못했습니다");
const weeks = JSON.parse(weeksMatch[1]);

// 각 주차 리포트: hero 부터 </main> 까지의 본문
const reports = {};
for (const w of weeks) {
  const html = read(w.file);
  const start = html.indexOf('<div class="wrap hero">');
  const end = html.indexOf("</main>");
  if (start < 0 || end < 0) throw new Error(`${w.file} 에서 본문 구간을 찾지 못했습니다`);
  reports[w.id] = html.slice(start, end + "</main>".length);
}

const dataDir = join(ROOT, "data");
const latestFile = (prefix) => {
  if (!existsSync(dataDir)) return null;
  const f = readdirSync(dataDir).filter((n) => n.startsWith(prefix) && n.endsWith(".json")).sort().pop();
  return f ? JSON.parse(readFileSync(join(dataDir, f), "utf8")) : null;
};
const trend = existsSync(join(dataDir, "trend-latest.json")) ? JSON.parse(read("data/trend-latest.json")) : null;
const deep = latestFile("deep-dive-");

const builtAt = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ") + " KST";
const out = read("artifact/template.html")
  .replace("__WEEKS__", () => embed(weeks))
  .replace("__REPORTS__", () => embed(reports))
  .replace("__TREND__", () => embed(trend))
  .replace("__DEEP__", () => embed(deep))
  .replace("__META__", () => embed({ builtAt }));

mkdirSync(join(ROOT, "artifact", "dist"), { recursive: true });
const dest = join(ROOT, "artifact", "dist", "health-food-weekly.html");
writeFileSync(dest, out);
console.log(`built ${dest} (${(out.length / 1024).toFixed(0)} KB, ${weeks.length} weeks, trend ${trend ? "yes" : "no"}, deep ${deep ? "yes" : "no"})`);

// 로그인·인터넷 없이 더블클릭으로 여는 단독 파일 (메일·사내 메신저 전달용).
// 아티팩트는 문서 골격을 자동으로 씌우지만 단독 파일은 직접 씌워야 표준 모드로 렌더링된다.
const standalone = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>[hidden]{display:none!important}body{margin:0}img{max-width:100%}</style>
${out}
</html>
`;
const standaloneDest = join(ROOT, "artifact", "dist", `health-food-weekly-${weeks[0]?.id ?? "latest"}.html`);
writeFileSync(standaloneDest, standalone);
console.log(`built ${standaloneDest} (standalone)`);
