// Downloads public economic data from FRED (St. Louis Fed) and writes macro.json.
// Uses FRED's public CSV download (no key needed). Run daily by .github/workflows/macro-data.yml.
import { writeFileSync } from "node:fs";
import { execFile } from "node:child_process";

const yearsAgo = n => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };
// id: [label, start date]
const SERIES = {
  // Inflation (monthly index levels; the app works out yearly rates)
  CPIAUCSL: ["CPI", yearsAgo(4)], CPILFESL: ["Core CPI", yearsAgo(4)],
  PCEPI: ["PCE prices", yearsAgo(4)], PCEPILFE: ["Core PCE prices", yearsAgo(4)],
  // Fed and rates (daily)
  DFEDTARU: ["Fed target, upper", yearsAgo(3)], DFEDTARL: ["Fed target, lower", yearsAgo(3)],
  DGS2: ["2-year Treasury yield", yearsAgo(3)], DGS10: ["10-year Treasury yield", yearsAgo(3)], T10Y2Y: ["10y minus 2y", yearsAgo(3)],
  // Fed officials' projections (Summary of Economic Projections, median)
  FEDTARMD: ["Fed projection, median", "2000-01-01"], FEDTARMDLR: ["Fed projection, longer run", "2000-01-01"],
  // Economy
  UNRATE: ["Unemployment rate", yearsAgo(4)], PAYEMS: ["Payrolls", yearsAgo(4)], A191RL1Q225SBEA: ["Real GDP growth", yearsAgo(4)],
  CES0500000003: ["Average hourly earnings", yearsAgo(4)], JTSJOL: ["Job openings (JOLTS)", yearsAgo(4)], // wage growth, job openings (7.11)
  VIXCLS: ["VIX", yearsAgo(3)], BAMLH0A0HYM2: ["High-yield credit spread", yearsAgo(3)],
  DTWEXBGS: ["US dollar index", yearsAgo(3)], DCOILWTICO: ["Oil (WTI)", yearsAgo(3)],
  // Exchange rate for converting US holdings to pounds
  DEXUSUK: ["US dollars per pound", "2005-01-01"], // long history: converts past trades for "your results vs the index",
};

async function get(id, start){
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`;
  for(let attempt = 1; attempt <= 4; attempt++){
    try{
      const r = await fetch(url, { headers: { "User-Agent": "stock-analysis-macro/1.0" } });
      if(!r.ok) throw new Error("HTTP " + r.status);
      const lines = (await r.text()).trim().split(/\r?\n/);
      if(!/^observation_date,/.test(lines[0] || "")) throw new Error("unexpected format");
      const d = [], v = [];
      for(const ln of lines.slice(1)){
        const [date, val] = ln.split(",");
        if(date < start) continue;
        const x = parseFloat(val);
        d.push(date); v.push(Number.isFinite(x) ? x : null); // null = missing (e.g. holiday, delayed release)
      }
      return { d, v };
    }catch(e){
      if(attempt === 4) throw new Error(`${id}: ${e.message}`);
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
}

// Release dates (7.11): FRED's public release calendar (BLS dates, shown there in St. Louis time, US Central). This year's
// and next year's pages; next year's dates appear once BLS publishes its schedule. Kept as UTC times.
const RELEASES = { CPI: 10, JOBS: 50 }; // FRED release ids: Consumer Price Index, Employment Situation
const MON = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
function centralToUtc(y, m, d, hh, mm){ // US Central wall time → UTC (CST −6, CDT −5)
  for(const off of [5, 6]){ const t = Date.UTC(y, m - 1, d, hh + off, mm);
    const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "numeric", hourCycle: "h23", day: "numeric" }).formatToParts(new Date(t));
    const g = k => +local.find(p => p.type === k).value;
    if(g("hour") === hh && g("minute") === mm && g("day") === d) return new Date(t).toISOString(); }
  return new Date(Date.UTC(y, m - 1, d, hh + 6, mm)).toISOString();
}
async function releaseDates(rid){
  const now = new Date().getUTCFullYear(), out = [];
  for(const y of [now, now + 1]){
    // Read with curl: FRED's calendar pages refuse Node's own downloader (HTTP 503) but answer curl (tested 22 Nov 2026)
    const h = await new Promise((res, rej) => execFile("curl", ["-sSf", "-m", "40", "--retry", "3", `https://fred.stlouisfed.org/releases/calendar?rid=${rid}&y=${y}`], { maxBuffer: 8 << 20 }, (e, o) => e ? rej(new Error(String(e.message).split("\n")[0].slice(0, 120))) : res(o)));
    for(const m of h.matchAll(/(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})<\/span>[\s\S]{0,400}?(\d{1,2}):(\d{2}) (am|pm)/g)){
      let hh = +m[4] % 12; if(m[6] === "pm") hh += 12;
      out.push(centralToUtc(+m[3], MON[m[1]], +m[2], hh, +m[5]));
    }
  }
  return [...new Set(out)].sort();
}
const out = { updated: new Date().toISOString(), source: "FRED, Federal Reserve Bank of St. Louis", series: {} };
const errors = [];
for(const [id, [label, start]] of Object.entries(SERIES)){
  try{ out.series[id] = { label, ...(await get(id, start)) }; }
  catch(e){ errors.push(e.message); }
}
out.releases = {};
for(const [k, rid] of Object.entries(RELEASES)){
  try{ out.releases[k] = await releaseDates(rid); if(!out.releases[k].length) errors.push(`${k} release dates: none found`); }
  catch(e){ errors.push(`${k} release dates: ${e.message}`); }
}
if(errors.length) out.errors = errors;
if(Object.keys(out.series).length < Object.keys(SERIES).length / 2){ console.error("Too many failures:", errors); process.exit(1); }
writeFileSync(process.argv[2] || "macro.json", JSON.stringify(out));
console.log(`Saved ${Object.keys(out.series).length} series${errors.length ? "; failed: " + errors.join("; ") : ""}`);
