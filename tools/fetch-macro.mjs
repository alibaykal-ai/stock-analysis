// Downloads public economic data from FRED (St. Louis Fed) and writes macro.json.
// Uses FRED's public CSV download (no key needed). Run daily by .github/workflows/macro-data.yml.
import { writeFileSync } from "node:fs";

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

const out = { updated: new Date().toISOString(), source: "FRED, Federal Reserve Bank of St. Louis", series: {} };
const errors = [];
for(const [id, [label, start]] of Object.entries(SERIES)){
  try{ out.series[id] = { label, ...(await get(id, start)) }; }
  catch(e){ errors.push(e.message); }
}
if(errors.length) out.errors = errors;
if(Object.keys(out.series).length < Object.keys(SERIES).length / 2){ console.error("Too many failures:", errors); process.exit(1); }
writeFileSync(process.argv[2] || "macro.json", JSON.stringify(out));
console.log(`Saved ${Object.keys(out.series).length} series${errors.length ? "; failed: " + errors.join("; ") : ""}`);
