import { useState, useCallback, useRef } from "react";
import * as XLSX from "xlsx";

// ── Brand Assets (embedded) ───────────────────────────────────────────────────
const LOGO             = "/logos/shield-green.png";
const LOGO_SHIELD_GOLD = "/logos/shield-gold.png";
const LOGO_WORDMARK    = "/logos/wordmark-gold.png";

// ── Brand Themes ──────────────────────────────────────────────────────────────
const BRANDS = {
  granara: {
    id: "granara",
    name: "GRANARA",
    cardBg:      "#002621",
    cardMid:     "#013A34",
    cardBorder:  "#AF965D",
    cardGold:    "#AF965D",
    cardGoldDim: "#65562E",
    headerGrad:  "linear-gradient(90deg,#001a17 0%,#013A34 100%)",
    sectionBg:   "#013A3444",
    logoHeader:  LOGO_WORDMARK,
    logoFooter:  LOGO_SHIELD_GOLD,
    logoHeaderH: 44,
    logoFooterH: 36,
    footerUrl:   "app.gtrd.com.br/relatorios",
    accentPos:   "#6fcf97",
    accentNeg:   "#eb5757",
    // ExportTab compat aliases
    accent:      "#AF965D",
    commodityStyle: { background:"linear-gradient(90deg,#013A34,#002621)", borderBottom:"1px solid #AF965D44" },
  },
  getreide: {
    id: "getreide",
    name: "GETREIDE COMMODITIES",
    cardBg:      "#0d2e0d",
    cardMid:     "#1C8152",
    cardBorder:  "#FFD768",
    cardGold:    "#FFD768",
    cardGoldDim: "#BFD730",
    headerGrad:  "linear-gradient(90deg,#0d2e0d 0%,#1C8152 100%)",
    sectionBg:   "#1C815222",
    logoHeader:  "/logos/gtrd-wordmark1.png",
    logoFooter:  "/logos/gtrd-shield.png",
    logoHeaderH: 52,
    logoFooterH: 60,
    footerUrl:   "app.gtrd.com.br/relatorios",
    accentPos:   "#6fcf97",
    accentNeg:   "#eb5757",
    // ExportTab compat aliases
    accent:      "#FFD768",
    commodityStyle: { background:"linear-gradient(90deg,#1C8152,#0d2e0d)", borderBottom:"1px solid #FFD76844" },
  },
};

const ICON_CORN        = "/logos/icon-corn.png";
const ICON_SOY         = "/logos/icon-soy.png";

// ── Brand Colors ──────────────────────────────────────────────────────────────
const G = {
  darkGreen: "#002621", midGreen: "#013A34", slateGreen: "#2F3F3C",
  cream: "#EFE8D8", gold: "#AF965D", goldDark: "#65562E",
};

// ── Parsers ───────────────────────────────────────────────────────────────────
function parseAMS(text) {
  const lines = text.split("\n").map(l => l.replace(/\r/g, ""));
  let result = { corn: {}, soy: {}, reportDate: "", weekEnding: "" };

  // Extract week ending date — try multiple patterns
  const weekPatterns = [
    /REPORTED IN WEEK ENDING[:\s]+(\w+\.?\s+\d+,?\s*\d{4})/i,
    /WEEK\s+ENDING[:\s]+(\w+\.?\s+\d+,?\s*\d{4})/i,
    /ENDING\s+(\w+\.?\s+\d+,?\s*\d{4})/i,
  ];
  for (const re of weekPatterns) {
    const m = text.match(re);
    if (m) { result.weekEnding = m[1].trim(); break; }
  }

  // Report date
  const dateMatch = text.match(/Washington[^,\n]*,?\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[,\s]+(\w+\.?\s+\d+,\s*\d{4})/i);
  if (dateMatch) result.reportDate = dateMatch[2];

  // Helper: extract all numbers from a string
  const nums = s => (s.match(/[\d,]+/g) || []).map(n => n.replace(/,/g, "")).filter(n => n.length >= 3);

  // Strategy 1: lines where crop name and numbers are on same line
  for (const line of lines) {
    const trimmed = line.trim();

    if (!result.corn.semanaAtual && /^CORN\b/i.test(trimmed)) {
      const n = nums(trimmed.replace(/^CORN[^0-9]*/i, ""));
      if (n.length >= 4) {
        result.corn = { semanaAtual:n[0], semanaAnterior:n[1], anoAnterior:n[2], acumulado2526:n[3], acumulado2425:n[4]||"" };
      }
    }

    if (!result.soy.semanaAtual && /^SOYBEANS?\b/i.test(trimmed)) {
      const n = nums(trimmed.replace(/^SOYBEANS?[^0-9]*/i, ""));
      if (n.length >= 4) {
        result.soy = { semanaAtual:n[0], semanaAnterior:n[1], anoAnterior:n[2], acumulado2526:n[3], acumulado2425:n[4]||"" };
      }
    }
  }

  // Strategy 2 fallback — crop name on one line, numbers on next
  if (!result.corn.semanaAtual || !result.soy.semanaAtual) {
    let lastLabel = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^CORN\b/i.test(trimmed) && !/\d/.test(trimmed)) { lastLabel = "corn"; continue; }
      if (/^SOYBEANS?\b/i.test(trimmed) && !/\d/.test(trimmed)) { lastLabel = "soy"; continue; }
      const n = nums(trimmed);
      if (n.length >= 4) {
        if (lastLabel === "corn" && !result.corn.semanaAtual) {
          result.corn = { semanaAtual:n[0], semanaAnterior:n[1], anoAnterior:n[2], acumulado2526:n[3], acumulado2425:n[4]||"" };
          lastLabel = "";
        } else if (lastLabel === "soy" && !result.soy.semanaAtual) {
          result.soy = { semanaAtual:n[0], semanaAnterior:n[1], anoAnterior:n[2], acumulado2526:n[3], acumulado2425:n[4]||"" };
          lastLabel = "";
        }
      }
    }
  }

  // Strategy 3 — if still nothing, log raw for debugging (dev only)
  if (!result.corn.semanaAtual) {
    console.warn("[parseAMS] CORN not found. First 3000 chars:", text.slice(0, 3000));
  }

  return result;
}

function parseCropProgress(text) {
  const result = { date: "", corn: {}, soy: {} };

  // Extract report date
  const dateMatch = text.match(/Released\s+(\w+\s+\d+,\s*\d+)/i);
  if (dateMatch) result.date = dateMatch[1];

  // Generic helper: extract 18-States row for a given table section
  // Columns: [anoPassado, semPassada, atual, media5]
  // The table header shows: "April 19, : April 12, : April 19, : 2021-2025"
  //                          year-ago     prev-week   current    avg
  function extract18States(sectionText) {
    const m = sectionText.match(/18 States\s*\.+:\s*(\d+|-)\s+(\d+|-|NA|\(NA\))\s+(\d+|-)\s+(\d+|-)/);
    if (!m) return null;
    const clean = v => (v === "-" || v.includes("NA")) ? "" : v;
    return {
      anoPassado: clean(m[1]),
      semPassada: clean(m[2]),
      atual:      clean(m[3]),
      media5:     clean(m[4]),
    };
  }

  // Split text into named sections by crop header
  function getSection(title) {
    const re = new RegExp(title + "[\\s\\S]*?(?=\\n\\n[A-Z]|$)", "i");
    const m = text.match(re);
    return m ? m[0] : "";
  }

  // Corn stages
  const cornPlanted    = getSection("Corn Planted");
  const cornEmerged    = getSection("Corn Emerged");

  // Summer stages (may not be present in April)
  const cornDough      = getSection("Corn Dough");
  const cornDented     = getSection("Corn Dented");
  const cornMatured    = getSection("Corn Mature");
  const cornHarvested  = getSection("Corn Harvested");
  const cornCondMatch  = text.match(/Corn Condition[\s\S]*?18 States\s*\.+:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i);

  if (extract18States(cornPlanted))   result.corn.plantado        = extract18States(cornPlanted);
  if (extract18States(cornEmerged))   result.corn.emergido        = extract18States(cornEmerged);
  if (extract18States(cornDough))     result.corn.pastoso         = extract18States(cornDough);
  if (extract18States(cornDented))    result.corn.formacaoDentes  = extract18States(cornDented);
  if (extract18States(cornMatured))   result.corn.maduro          = extract18States(cornMatured);
  if (extract18States(cornHarvested)) result.corn.colhido         = extract18States(cornHarvested);

  if (cornCondMatch) {
    // VP, P, F, G, E → ruim=(VP+P), regular=F, bom=(G+E)
    const vp = parseInt(cornCondMatch[1])||0, p  = parseInt(cornCondMatch[2])||0;
    const f  = parseInt(cornCondMatch[3])||0;
    const g  = parseInt(cornCondMatch[4])||0, e  = parseInt(cornCondMatch[5])||0;
    // Previous week line
    const prevMatch = text.match(/Previous week\s*\.+:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)[\s\S]*?Previous year/i);
    const pvp = prevMatch ? parseInt(prevMatch[1])||0 : 0;
    const pp  = prevMatch ? parseInt(prevMatch[2])||0 : 0;
    const pf  = prevMatch ? parseInt(prevMatch[3])||0 : 0;
    const pg  = prevMatch ? parseInt(prevMatch[4])||0 : 0;
    const pe  = prevMatch ? parseInt(prevMatch[5])||0 : 0;
    result.corn.bom     = { anterior: String(pg+pe), atual: String(g+e) };
    result.corn.regular = { anterior: String(pf),    atual: String(f)   };
    result.corn.ruim    = { anterior: String(pvp+pp), atual: String(vp+p) };
  }

  // Soy stages
  const soyPlanted   = getSection("Soybeans Planted");
  const soyEmerged   = getSection("Soybeans Emerged");
  const soyBlooming  = getSection("Soybeans Blooming");
  const soySetting   = getSection("Soybeans Setting Pods");
  const soyLeafDrop  = getSection("Soybeans Dropping Leaves");
  const soyHarvested = getSection("Soybeans Harvested");
  const soyCondMatch = text.match(/Soybean Condition[\s\S]*?18 States\s*\.+:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i);

  if (extract18States(soyPlanted))   result.soy.plantado    = extract18States(soyPlanted);
  if (extract18States(soyEmerged))   result.soy.emergido    = extract18States(soyEmerged);
  if (extract18States(soyBlooming))  result.soy.florescendo = extract18States(soyBlooming);
  if (extract18States(soySetting))   result.soy.vaginando   = extract18States(soySetting);
  if (extract18States(soyLeafDrop))  result.soy.quedaFolhas = extract18States(soyLeafDrop);
  if (extract18States(soyHarvested)) result.soy.colhido     = extract18States(soyHarvested);

  if (soyCondMatch) {
    const vp=parseInt(soyCondMatch[1])||0, p=parseInt(soyCondMatch[2])||0;
    const f=parseInt(soyCondMatch[3])||0;
    const g=parseInt(soyCondMatch[4])||0, e=parseInt(soyCondMatch[5])||0;
    const prevMatch = text.match(/Previous week\s*\.+:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)[\s\S]{0,200}?Previous year/i);
    const pvp=prevMatch?parseInt(prevMatch[1])||0:0, pp=prevMatch?parseInt(prevMatch[2])||0:0;
    const pf=prevMatch?parseInt(prevMatch[3])||0:0;
    const pg=prevMatch?parseInt(prevMatch[4])||0:0, pe=prevMatch?parseInt(prevMatch[5])||0:0;
    result.soy.bom     = { anterior: String(pg+pe), atual: String(g+e) };
    result.soy.regular = { anterior: String(pf),    atual: String(f)   };
    result.soy.ruim    = { anterior: String(pvp+pp), atual: String(vp+p) };
  }

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const toNum = v => parseFloat(String(v||"").replace(/,/g,"").replace(".","").replace(",",".")) || 0;
const fmtBR = v => {
  const n = parseFloat(String(v||"").replace(/,/g,""));
  return isNaN(n)||v===""?"—":Math.round(n).toLocaleString("pt-BR");
};
const pctDiff = (a,b) => {
  const na=parseFloat(String(a).replace(/,/g,"")), nb=parseFloat(String(b).replace(/,/g,""));
  if(!nb) return null;
  return (((na-nb)/nb)*100).toFixed(2);
};

// ── Sub-components ────────────────────────────────────────────────────────────
const GoldLine = () => (
  <div style={{height:1,background:`linear-gradient(90deg,${G.goldDark}44,${G.gold},${G.goldDark}44)`,margin:"10px 0"}}/>
);

function FField({label,value,onChange,sm}) {
  return (
    <div style={{marginBottom:sm?4:8}}>
      <div style={{fontSize:9,color:G.gold,fontFamily:"'Cinzel',serif",letterSpacing:"0.1em",marginBottom:2}}>{label}</div>
      <input value={value} onChange={e=>onChange(e.target.value)} placeholder="—"
        style={{width:"100%",background:"rgba(0,0,0,0.25)",border:`1px solid ${G.goldDark}88`,
          borderRadius:3,padding:sm?"4px 7px":"6px 9px",color:"#ffffff",
          fontFamily:"'Courier New',monospace",fontSize:sm?11:13,boxSizing:"border-box",outline:"none"}}
        onFocus={e=>e.target.style.borderColor=G.gold}
        onBlur={e=>e.target.style.borderColor=`${G.goldDark}88`}
      />
    </div>
  );
}

function Row({label,value,bold,accent}) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
      padding:"4px 0",borderBottom:`1px solid ${G.goldDark}22`}}>
      <span style={{fontSize:10,fontFamily:"'Cinzel',serif",letterSpacing:"0.05em",
        color:accent?G.gold:G.cream+"99",textTransform:"uppercase"}}>{label}</span>
      <span style={{fontSize:bold?14:12,fontFamily:"'Courier New',monospace",
        fontWeight:bold?"bold":"normal",color:bold?G.cream:G.cream+"cc"}}>{value}</span>
    </div>
  );
}

function SectionBar({label}) {
  return (
    <div style={{background:G.midGreen,borderLeft:`3px solid ${G.gold}`,
      padding:"4px 10px",marginBottom:5,marginTop:6}}>
      <span style={{fontSize:9,fontFamily:"'Cinzel',serif",letterSpacing:"0.12em",color:G.gold}}>{label}</span>
    </div>
  );
}

function CardShell({icon,title,subtitle,children}) {
  return (
    <div style={{flex:1,minWidth:300,background:`linear-gradient(155deg,${G.darkGreen},${G.midGreen})`,
      border:`1px solid ${G.goldDark}`,borderRadius:2,overflow:"hidden"}}>
      <div style={{background:`linear-gradient(90deg,${G.darkGreen},${G.slateGreen}66)`,
        borderBottom:`2px solid ${G.gold}`,padding:"10px 14px",display:"flex",alignItems:"center",gap:10}}>
        <img src={icon} style={{width:28,height:28,filter:"invert(1) sepia(1) saturate(2) hue-rotate(5deg)",opacity:.85}} alt="" />
        <div>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:17,letterSpacing:"0.2em",color:G.cream}}>{title}</div>
          <div style={{fontSize:9,color:G.gold,letterSpacing:"0.12em"}}>{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Export Card ───────────────────────────────────────────────────────────────
function ExportCard({label,icon,data,onUpdate,reportDate}) {
  const acum  = parseFloat(data.acumulado2526||0);
  const exp   = parseFloat(data.expectativa||0);
  const sem   = parseInt(data.semanas)||0;
  const pend  = exp-acum;
  const semEsp= sem?(pend/sem):0;
  const dSem  = pctDiff(data.semanaAtual,data.semanaAnterior);
  const dAcum = pctDiff(data.acumulado2526,data.acumulado2425);
  const arrow = v => parseFloat(v)>=0?"▲":"▼";
  const col   = v => parseFloat(v)>=0?"#6fcf97":"#eb5757";

  return (
    <CardShell icon={icon} title={label} subtitle={`EM TONELADAS MÉTRICAS · ATÉ ${reportDate||"—"}`}>
      <div style={{display:"flex"}}>
        {/* inputs */}
        <div style={{flex:1,padding:"12px 12px 12px 14px",borderRight:`1px solid ${G.goldDark}22`}}>
          <div style={{fontSize:9,color:G.gold,fontFamily:"'Cinzel',serif",letterSpacing:"0.12em",marginBottom:6}}>DADOS</div>
          <FField label="Semana Atual"       value={data.semanaAtual||""}    onChange={v=>onUpdate("semanaAtual",v)} />
          <FField label="Semana Anterior"    value={data.semanaAnterior||""} onChange={v=>onUpdate("semanaAnterior",v)} />
          <FField label="Ano Anterior 24/25" value={data.anoAnterior||""}    onChange={v=>onUpdate("anoAnterior",v)} />
          <FField label="Acumulado 25/26"    value={data.acumulado2526||""}  onChange={v=>onUpdate("acumulado2526",v)} />
          <FField label="Acumulado 24/25"    value={data.acumulado2425||""}  onChange={v=>onUpdate("acumulado2425",v)} />
          <GoldLine/>
          <div style={{fontSize:9,color:G.gold,fontFamily:"'Cinzel',serif",letterSpacing:"0.12em",marginBottom:6}}>WASDE</div>
          <FField label="Expectativa Total"  value={data.expectativa||""}    onChange={v=>onUpdate("expectativa",v)} />
          <FField label="Semanas Restantes"  value={data.semanas||""}        onChange={v=>onUpdate("semanas",v)} />
        </div>
        {/* preview */}
        <div style={{flex:1,padding:"12px 14px"}}>
          <div style={{fontSize:9,color:G.gold,fontFamily:"'Cinzel',serif",letterSpacing:"0.12em",marginBottom:6}}>RELATÓRIO</div>
          <Row label="Semana Atual"   value={fmtBR(data.semanaAtual)} bold />
          <Row label="Sem. Anterior"  value={fmtBR(data.semanaAnterior)} />
          {dSem!==null&&<div style={{textAlign:"right",fontSize:10,color:col(dSem),fontFamily:"monospace"}}>{arrow(dSem)} {Math.abs(dSem)}%</div>}
          <Row label="Ano Ant. 24/25" value={fmtBR(data.anoAnterior)} />
          <GoldLine/>
          <Row label="Acum. 25/26" value={fmtBR(data.acumulado2526)} bold accent />
          <Row label="Acum. 24/25" value={fmtBR(data.acumulado2425)} />
          {dAcum!==null&&<div style={{textAlign:"right",fontSize:10,color:col(dAcum),fontFamily:"monospace"}}>{arrow(dAcum)} {Math.abs(dAcum)}%</div>}
          <GoldLine/>
          <div style={{fontSize:9,color:G.gold,fontFamily:"'Cinzel',serif",letterSpacing:"0.1em",marginBottom:4}}>EMBARQUE</div>
          <Row label="Expectativa"    value={data.expectativa?Number(data.expectativa).toLocaleString("pt-BR"):"—"} />
          <Row label="Acumulado"      value={fmtBR(data.acumulado2526)} />
          <Row label="Pendente"       value={exp&&acum?Math.round(pend).toLocaleString("pt-BR"):"—"} bold />
          <Row label="Sem. Restantes" value={data.semanas||"—"} />
          <Row label="Sem. Esperado"  value={exp&&acum&&sem?Math.round(semEsp).toLocaleString("pt-BR"):"—"} bold accent />
        </div>
      </div>
    </CardShell>
  );
}

// ── Crop Card ─────────────────────────────────────────────────────────────────
const CORN_STAGES_LABELS = {
  plantado:"PLANTADO", emergido:"EMERGIDO", pastoso:"PASTOSO",
  formacaoDentes:"FORMAÇÃO DE DENTES", maduro:"MADURO", colhido:"COLHIDO",
};
const SOY_STAGES_LABELS = {
  plantado:"PLANTADO", emergido:"EMERGIDO", florescendo:"FLORESCENDO",
  vaginando:"VAGINANDO", quedaFolhas:"QUEDA DAS FOLHAS", colhido:"COLHIDOS",
};
const CONDITIONS = [
  {key:"bom",    label:"Bom / Excelente", color:"#6fcf97"},
  {key:"regular",label:"Regular",         color:G.cream+"99"},
  {key:"ruim",   label:"Ruim / Muito Ruim",color:"#eb5757"},
];

function CropCard({label,icon,isSoy,data,onUpdate,cropDate}) {
  const stageLabels = isSoy ? SOY_STAGES_LABELS : CORN_STAGES_LABELS;
  const activeStages = Object.entries(stageLabels).filter(([k]) => data[k]);

  return (
    <CardShell icon={icon} title={label} subtitle={`PROGRESSO · ATÉ ${cropDate||"—"}`}>
      <div style={{display:"flex"}}>
        {/* inputs */}
        <div style={{flex:1,padding:"12px 12px 12px 14px",borderRight:`1px solid ${G.goldDark}22`}}>
          {Object.entries(stageLabels).map(([k,lbl])=>(
            <div key={k} style={{marginBottom:8}}>
              <SectionBar label={lbl}/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 6px"}}>
                <FField sm label="Atual %" value={data[k]?.atual||""} onChange={v=>onUpdate(k,"atual",v)} />
                <FField sm label="Sem. Pas." value={data[k]?.semPassada||""} onChange={v=>onUpdate(k,"semPassada",v)} />
                <FField sm label="Ano Pas." value={data[k]?.anoPassado||""} onChange={v=>onUpdate(k,"anoPassado",v)} />
                <FField sm label="Méd. 5A." value={data[k]?.media5||""} onChange={v=>onUpdate(k,"media5",v)} />
              </div>
            </div>
          ))}
          <GoldLine/>
          <div style={{fontSize:9,color:G.gold,fontFamily:"'Cinzel',serif",letterSpacing:"0.1em",marginBottom:4}}>CONDIÇÕES</div>
          {CONDITIONS.map(c=>(
            <div key={c.key} style={{marginBottom:6}}>
              <div style={{fontSize:9,color:c.color,fontFamily:"'Cinzel',serif",marginBottom:2}}>{c.label}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 6px"}}>
                <FField sm label="Ant. %" value={data[c.key]?.anterior||""} onChange={v=>onUpdate(c.key,"anterior",v)} />
                <FField sm label="Atual %" value={data[c.key]?.atual||""} onChange={v=>onUpdate(c.key,"atual",v)} />
              </div>
            </div>
          ))}
        </div>
        {/* preview */}
        <div style={{flex:1,padding:"12px 14px"}}>
          <div style={{fontSize:9,color:G.gold,fontFamily:"'Cinzel',serif",letterSpacing:"0.12em",marginBottom:6}}>RELATÓRIO</div>
          {activeStages.length===0 && (
            <div style={{color:G.goldDark,fontSize:11,fontFamily:"'Cinzel',serif",marginTop:20,textAlign:"center"}}>
              Carregue os dados ou preencha à esquerda
            </div>
          )}
          {activeStages.map(([k,lbl])=>(
            <div key={k} style={{marginBottom:8}}>
              <SectionBar label={lbl}/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 0",padding:"0 4px"}}>
                {[["Atual",data[k]?.atual],["Ano Passado",data[k]?.anoPassado],
                  ["Sem. Passada",data[k]?.semPassada],["Média 5 Anos",data[k]?.media5]].map(([l,v])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",fontSize:10,padding:"2px 4px"}}>
                    <span style={{color:G.cream+"77",fontFamily:"'Cinzel',serif"}}>{l}</span>
                    <span style={{color:"#ffffff",fontFamily:"monospace",
                      fontWeight:l==="Atual"?"bold":"normal"}}>{v?v+"%":"—"}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {Object.keys(data).some(k=>CONDITIONS.map(c=>c.key).includes(k)) && (
            <>
              <GoldLine/>
              <div style={{fontSize:9,color:G.gold,fontFamily:"'Cinzel',serif",marginBottom:4}}>CONDIÇÕES</div>
              {CONDITIONS.map(c=>(
                <div key={c.key} style={{display:"flex",justifyContent:"space-between",
                  alignItems:"center",padding:"4px 0",borderBottom:`1px solid ${G.goldDark}22`}}>
                  <span style={{fontSize:10,fontFamily:"'Cinzel',serif",color:c.color}}>{c.label}</span>
                  <div style={{display:"flex",gap:6,fontFamily:"monospace",alignItems:"center"}}>
                    <span style={{fontSize:10,color:G.cream+"55"}}>{data[c.key]?.anterior?data[c.key].anterior+"%":"—"}</span>
                    <span style={{color:G.goldDark}}>→</span>
                    <span style={{fontSize:12,fontWeight:"bold",color:c.color}}>{data[c.key]?.atual?data[c.key].atual+"%":"—"}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </CardShell>
  );
}



// ── Export Card Renderers ─────────────────────────────────────────────────────

function fmtE(v) {
  const n = parseFloat(String(v||"").replace(/,/g,""));
  return isNaN(n)||v===""?"—":Math.round(n).toLocaleString("pt-BR");
}
function pctE(a,b){
  const na=parseFloat(String(a).replace(/,/g,"")),nb=parseFloat(String(b).replace(/,/g,""));
  if(!nb)return null;
  return (((na-nb)/nb)*100).toFixed(2);
}

// Shared card shell — dark green, logo header + footer
function CardShellExport({ children, logo, logoFooter, brand }) {
  const B = brand || BRANDS.granara;
  return (
    <div style={{
      background: B.cardBg,
      width:580,
      fontFamily:"'Helvetica Neue',Arial,sans-serif",
      borderRadius:6,
      overflow:"hidden",
      boxShadow:"0 4px 24px rgba(0,0,0,0.5)",
    }}>
      <div style={{
        background: B.headerGrad,
        borderBottom:`2px solid ${B.cardBorder}`,
        padding:"12px 20px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        <img src={logo || B.logoHeader} style={{height: B.logoHeaderH || 44, objectFit:"contain", filter:"drop-shadow(0 2px 6px rgba(0,0,0,0.5))"}} alt={B.name} />
        <div style={{fontSize:8, color:`${B.cardGold}88`, letterSpacing:"0.2em"}}>FONTE: USDA</div>
      </div>

      {children}

      <div style={{
        background: B.cardBg,
        borderTop:`1px solid ${B.cardGoldDim}44`,
        padding:"8px 20px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        <span style={{fontSize:9, color: B.cardGoldDim, letterSpacing:"0.12em", fontStyle:"italic"}}>
          {B.footerUrl}
        </span>
        <img src={logoFooter || B.logoFooter} style={{height: B.logoFooterH || 36, objectFit:"contain"}} alt={B.name} />
      </div>
    </div>
  );
}

function ExportCardExport({ label, icon, data, reportDate, logo, logoFooter, brand }) {
  const B = brand || BRANDS.granara;
  const acum  = parseFloat(data.acumulado2526||0);
  const exp   = parseFloat(data.expectativa||0);
  const sem   = parseInt(data.semanas)||0;
  const pend  = exp - acum;
  const semEsp= sem ? pend/sem : 0;
  const dAcum = pctE(data.acumulado2526, data.acumulado2425);
  const dSem  = pctE(data.semanaAtual, data.semanaAnterior);
  const isPos = v => parseFloat(v) >= 0;
  const arrowCol = v => isPos(v) ? "#6fcf97" : "#eb5757";

  const Row = ({label:l, value, bold, accent}) => (
    <div style={{
      display:"flex", justifyContent:"space-between", alignItems:"baseline",
      padding:"6px 0", borderBottom:"1px solid #ffffff0a",
    }}>
      <span style={{
        fontSize:14, color: accent ? B.cardGold : "#b8c8b8",
        letterSpacing:"0.07em", textTransform:"uppercase",
        fontWeight: bold ? "600" : "normal",
      }}>{l}</span>
      <span style={{
        fontSize: bold ? 26 : 22,
        fontFamily:"'Courier New',monospace",
        fontWeight: bold ? "bold" : "normal",
        color: "#ffffff",
      }}>{value}</span>
    </div>
  );

  return (
    <CardShellExport logo={logo} logoFooter={logoFooter} brand={B}>
      {/* commodity header */}
      <div style={{
        ...B.commodityStyle,
        padding:"14px 20px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        <div style={{display:"flex", alignItems:"center", gap:12}}>
          <img src={icon} style={{
            width:36, height:36,
            filter:"invert(1) sepia(1) saturate(2) hue-rotate(5deg)", opacity:.9,
          }} alt={label} />
          <div>
            <div style={{fontSize:24, fontWeight:"bold", letterSpacing:"0.2em", color:"#EFE8D8"}}>{label}</div>
            <div style={{fontSize:11, color:B.cardGold, letterSpacing:"0.15em"}}>EM TONELADAS MÉTRICAS</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:9, color:B.cardGoldDim, letterSpacing:"0.1em"}}>RELATÓRIO SEMANAL</div>
          <div style={{fontSize:13, color:B.cardGold, fontWeight:"bold", letterSpacing:"0.1em"}}>ATÉ {reportDate||"—"}</div>
        </div>
      </div>

      {/* body */}
      <div style={{padding:"14px 20px 10px"}}>
        <Row label="Semana Atual"       value={fmtE(data.semanaAtual)}    bold />
        <Row label="Semana Anterior"    value={fmtE(data.semanaAnterior)} />
        {dSem !== null && (
          <div style={{textAlign:"right", fontSize:15, fontFamily:"monospace",
            color:arrowCol(dSem), marginBottom:2}}>
            {isPos(dSem)?"▲":"▼"} {Math.abs(dSem)}% vs sem. anterior
          </div>
        )}
        <Row label="Ano Anterior 2024/25" value={fmtE(data.anoAnterior)} />

        {/* divider */}
        <div style={{height:1, background:"linear-gradient(90deg,#AF965D44,#AF965D,#AF965D44)", margin:"10px 0"}} />

        <Row label="Acumulado 2025/26" value={fmtE(data.acumulado2526)} bold accent />
        <Row label="Acumulado 2024/25" value={fmtE(data.acumulado2425)} />
        {dAcum !== null && (
          <div style={{textAlign:"right", fontSize:12, fontFamily:"monospace",
            color:arrowCol(dAcum), fontWeight:"bold", marginBottom:2}}>
            {isPos(dAcum)?"▲":"▼"} {Math.abs(dAcum)}% acumulado
          </div>
        )}

        {/* embarque block */}
        <div style={{
          background:B.sectionBg, border:"1px solid #AF965D22",
          borderRadius:4, padding:"10px 14px", marginTop:10,
        }}>
          <div style={{fontSize:9, color:B.accent, letterSpacing:"0.15em",
            marginBottom:8, borderBottom:`1px solid ${B.accent}33`, paddingBottom:4}}>
            EMBARQUE
          </div>
          {[
            ["Expectativa de Embarque",   data.expectativa ? Number(data.expectativa).toLocaleString("pt-BR") : "—", false],
            ["Embarque Acumulado",         fmtE(data.acumulado2526), false],
            ["Embarque Pendente",          exp&&acum ? Math.round(pend).toLocaleString("pt-BR") : "—", true],
            ["Semanas Restantes",          data.semanas||"—", false],
            ["Embarque Semanal Esperado",  exp&&acum&&sem ? Math.round(semEsp).toLocaleString("pt-BR") : "—", true],
          ].map(([l,v,b]) => (
            <div key={l} style={{
              display:"flex", justifyContent:"space-between",
              padding:"4px 0", borderBottom:"1px solid #ffffff08",
            }}>
              <span style={{fontSize:14, color:"#b8c8b8", letterSpacing:"0.05em"}}>{l}</span>
              <span style={{
                fontSize: b ? 17 : 15,
                fontFamily:"monospace", fontWeight: b ? "bold" : "normal",
                color: "#ffffff",
              }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </CardShellExport>
  );
}

function CropCardExport({ label, icon, data, cropDate, logo, logoFooter, isSoy, brand }) {
  const B = brand || BRANDS.granara;
  const stageLabels = isSoy ? SOY_STAGES_LABELS : CORN_STAGES_LABELS;
  const activeStages = Object.entries(stageLabels).filter(([k]) => data[k]?.atual || data[k]?.anoPassado);

  return (
    <CardShellExport logo={logo} logoFooter={logoFooter} brand={B}>
      {/* commodity header */}
      <div style={{
        ...B.commodityStyle,
        padding:"14px 20px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        <div style={{display:"flex", alignItems:"center", gap:12}}>
          <img src={icon} style={{
            width:36, height:36,
            filter:"invert(1) sepia(1) saturate(2) hue-rotate(5deg)", opacity:.9,
          }} alt={label} />
          <div>
            <div style={{fontSize:24, fontWeight:"bold", letterSpacing:"0.2em", color:"#EFE8D8"}}>{label}</div>
            <div style={{fontSize:11, color:B.cardGold, letterSpacing:"0.15em"}}>PROGRESSO DAS LAVOURAS EUA</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:9, color:B.cardGoldDim, letterSpacing:"0.1em"}}>USDA CROP PROGRESS</div>
          <div style={{fontSize:13, color:B.cardGold, fontWeight:"bold", letterSpacing:"0.1em"}}>ATÉ {cropDate||"—"}</div>
        </div>
      </div>

      {/* stages */}
      <div style={{padding:"14px 20px 10px"}}>
        {activeStages.length === 0 && (
          <div style={{color:B.cardGoldDim, fontSize:12, textAlign:"center", padding:"24px 0"}}>
            Sem dados carregados
          </div>
        )}
        {activeStages.map(([k, lbl]) => (
          <div key={k} style={{marginBottom:10}}>
            <div style={{
              background:B.cardMid, borderLeft:`3px solid ${B.accent}`,
              padding:"4px 10px", marginBottom:6,
            }}>
              <span style={{fontSize:14, color:B.accent, letterSpacing:"0.14em", fontWeight:"bold"}}>{lbl}</span>
            </div>
            <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"2px 0", padding:"0 4px"}}>
              {[["Atual", data[k]?.atual], ["Ano Passado", data[k]?.anoPassado],
                ["Sem. Passada", data[k]?.semPassada], ["Média 5 Anos", data[k]?.media5]].map(([l,v])=>(
                <div key={l} style={{display:"flex", justifyContent:"space-between", padding:"3px 8px"}}>
                  <span style={{fontSize:14, color:"#b8c8b8", letterSpacing:"0.05em"}}>{l}</span>
                  <span style={{
                    fontSize: l==="Atual" ? 24 : 20,
                    fontFamily:"monospace",
                    fontWeight: l==="Atual" ? "bold" : "normal",
                    color: l==="Atual" ? "#EFE8D8" : "#b8c8b8",
                  }}>{v ? v+"%" : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* conditions */}
        {CONDITIONS.some(c => data[c.key]?.atual) && (
          <div style={{
            background:B.sectionBg, border:"1px solid #AF965D22",
            borderRadius:4, padding:"10px 14px", marginTop:6,
          }}>
            <div style={{fontSize:9, color:B.cardGold, letterSpacing:"0.15em",
              marginBottom:8, borderBottom:"1px solid #AF965D33", paddingBottom:4}}>
              CONDIÇÕES
            </div>
            {CONDITIONS.map(c => (
              <div key={c.key} style={{
                display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"5px 0", borderBottom:"1px solid #ffffff08",
              }}>
                <span style={{fontSize:14, color: c.key==="bom"?"#6fcf97": c.key==="ruim"?"#eb5757":"#b8c8b8"}}>
                  {c.label}
                </span>
                <div style={{display:"flex", gap:8, alignItems:"center", fontFamily:"monospace"}}>
                  <span style={{fontSize:19, color:"#aaaaaa"}}>
                    {data[c.key]?.anterior ? data[c.key].anterior+"%" : "—"}
                  </span>
                  <span style={{color:B.cardGoldDim}}>→</span>
                  <span style={{
                    fontSize:24, fontWeight:"bold",
                    color: c.key==="bom"?"#6fcf97": c.key==="ruim"?"#eb5757":"#ffffff",
                  }}>
                    {data[c.key]?.atual ? data[c.key].atual+"%" : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </CardShellExport>
  );
}

// PNG download — usa dom-to-image (melhor suporte a fontes e CORS)
async function downloadCardPNG(elementId, filename) {
  const el = document.getElementById(elementId);
  if (!el) { alert('Elemento não encontrado: ' + elementId); return; }

  // Carrega dom-to-image-more via CDN se ainda não estiver disponível
  if (!window.domtoimage) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/dom-to-image/2.6.0/dom-to-image.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Converte todas as imagens <img> para base64 inline antes de capturar
  // (evita CORS block nas logos hospedadas no mesmo servidor)
  const imgs = el.querySelectorAll('img');
  const origSrcs = [];
  await Promise.all([...imgs].map(async (img, i) => {
    origSrcs[i] = img.src;
    try {
      const res = await fetch(img.src);
      const blob = await res.blob();
      await new Promise(r => {
        const fr = new FileReader();
        fr.onload = e => { img.src = e.target.result; r(); };
        fr.readAsDataURL(blob);
      });
    } catch (_) { /* mantém src original se fetch falhar */ }
  }));

  // Aguarda um frame para garantir que as imgs foram substituídas
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    const dataUrl = await window.domtoimage.toPng(el, {
      scale: 2,
      bgcolor: null, // usa o background do próprio elemento
      style: { margin: '0', boxShadow: 'none' },
    });
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
  } finally {
    // Restaura src originais
    imgs.forEach((img, i) => { img.src = origSrcs[i]; });
  }
}

function ExportTab({ exportData, cropData, reportDate, cropDate, salesData, salesDate, brand }) {
  const T = brand || BRANDS.granara;
  const cardLogo = T.logoHeader;
  const cardLogoFooter = T.logoFooter;
  const [dl, setDl] = useState({});

  async function handleDL(id, filename) {
    setDl(p => ({...p, [id]: true}));
    try {
      await downloadCardPNG(id, filename);
    } catch(e) {
      alert("Erro ao gerar PNG: " + e.message);
    } finally {
      setDl(p => ({...p, [id]: false}));
    }
  }

  const Section = ({title, id, filename, children}) => (
    <div style={{marginBottom:36}}>
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        marginBottom:12,
      }}>
        <div style={{fontSize:12, color:T.cardGold, fontFamily:"'Cinzel',serif", letterSpacing:"0.18em"}}>{title}</div>
        <button
          onClick={() => handleDL(id, filename)}
          disabled={dl[id]}
          style={{
            background: dl[id] ? "transparent" : T.cardGold,
            border:`1px solid ${T.cardGoldDim}`, borderRadius:2,
            color: dl[id] ? T.cardGold : "#002621",
            fontFamily:"'Cinzel',serif", fontSize:9, letterSpacing:"0.12em",
            padding:"6px 14px", cursor: dl[id] ? "wait" : "pointer", fontWeight:"bold",
          }}>
          {dl[id] ? "⏳ GERANDO..." : "⬇ BAIXAR PNG"}
        </button>
      </div>
      <div id={id} style={{display:"inline-block"}}>
        {children}
      </div>
    </div>
  );

  const date = reportDate || "export";
  const cdate = cropDate || "crop";

  return (
    <div style={{padding:"20px 26px 60px", maxWidth:1300, margin:"0 auto"}}>
      <div style={{fontSize:10, color:"#AF965D55", fontFamily:"'Cinzel',serif",
        letterSpacing:"0.12em", marginBottom:24}}>
        CARDS PRONTOS PARA COMPARTILHAR · IDENTIDADE {T.name}
      </div>

      <Section title="INSPEÇÕES · MILHO" id="ec-corn" filename={`granara-milho-${date}.png`}>
        <ExportCardExport label="MILHO" icon={ICON_CORN} data={exportData.corn} reportDate={reportDate} logo={cardLogo} logoFooter={cardLogoFooter} brand={T} />
      </Section>

      <Section title="INSPEÇÕES · SOJA" id="ec-soy" filename={`granara-soja-${date}.png`}>
        <ExportCardExport label="SOJA" icon={ICON_SOY} data={exportData.soy} reportDate={reportDate} logo={cardLogo} logoFooter={cardLogoFooter} brand={T} />
      </Section>

      <Section title="INSPEÇÕES · MILHO + SOJA" id="ec-both" filename={`granara-exportacoes-${date}.png`}>
        <div style={{display:"flex", gap:16}}>
          <ExportCardExport label="MILHO" icon={ICON_CORN} data={exportData.corn} reportDate={reportDate} logo={cardLogo} logoFooter={cardLogoFooter} brand={T} />
          <ExportCardExport label="SOJA"  icon={ICON_SOY}  data={exportData.soy}  reportDate={reportDate} logo={cardLogo} logoFooter={cardLogoFooter} brand={T} />
        </div>
      </Section>


      <Section title="VENDAS · MILHO" id="sc-corn" filename={`granara-milho-vendas-${salesDate||"sales"}.png`}>
        <SalesCardExport label="MILHO" icon={ICON_CORN} data={salesData.corn} salesDate={salesDate}
          logo={cardLogo} logoFooter={cardLogoFooter} brand={T} />
      </Section>

      <Section title="VENDAS · SOJA" id="sc-soy" filename={`granara-soja-vendas-${salesDate||"sales"}.png`}>
        <SalesCardExport label="SOJA" icon={ICON_SOY} data={salesData.soy} salesDate={salesDate}
          logo={cardLogo} logoFooter={cardLogoFooter} brand={T} />
      </Section>

      <Section title="VENDAS · MILHO + SOJA" id="sc-both" filename={`granara-vendas-${salesDate||"sales"}.png`}>
        <div style={{display:"flex", gap:16}}>
          <SalesCardExport label="MILHO" icon={ICON_CORN} data={salesData.corn} salesDate={salesDate}
            logo={cardLogo} logoFooter={cardLogoFooter} brand={T} />
          <SalesCardExport label="SOJA"  icon={ICON_SOY}  data={salesData.soy}  salesDate={salesDate}
            logo={cardLogo} logoFooter={cardLogoFooter} brand={T} />
        </div>
      </Section>

      <Section title="LAVOURAS · MILHO" id="cc-corn" filename={`granara-milho-lavoura-${cdate}.png`}>
        <CropCardExport label="MILHO" icon={ICON_CORN} data={cropData.corn} cropDate={cropDate} logo={cardLogo} logoFooter={cardLogoFooter} brand={T} isSoy={false} />
      </Section>

      <Section title="LAVOURAS · SOJA" id="cc-soy" filename={`granara-soja-lavoura-${cdate}.png`}>
        <CropCardExport label="SOJA" icon={ICON_SOY} data={cropData.soy} cropDate={cropDate} logo={cardLogo} logoFooter={cardLogoFooter} brand={T} isSoy={true} />
      </Section>

      <Section title="LAVOURAS · MILHO + SOJA" id="cc-both" filename={`granara-lavouras-${cdate}.png`}>
        <div style={{display:"flex", gap:16}}>
          <CropCardExport label="MILHO" icon={ICON_CORN} data={cropData.corn} cropDate={cropDate} logo={cardLogo} logoFooter={cardLogoFooter} brand={T} isSoy={false} />
          <CropCardExport label="SOJA"  icon={ICON_SOY}  data={cropData.soy}  cropDate={cropDate} logo={cardLogo} logoFooter={cardLogoFooter} brand={T} isSoy={true}  />
        </div>
      </Section>
    </div>
  );
}


// ── Sales Parser ──────────────────────────────────────────────────────────────
function parseSales(xmlText) {
  const result = { date:"", corn:{}, soy:{} };
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const details = doc.querySelectorAll("Details");

    details.forEach(d => {
      const name = d.getAttribute("CommodityName") || "";
      const isCorn = name.includes("CORN - UNMILLED") && !name.includes("SORGHUM");
      const isSoy  = name.includes("SOYBEANS") && !name.includes("CAKE") && !name.includes("MEAL") && !name.includes("OIL");
      if (!isCorn && !isSoy) return;

      const period = d.getAttribute("PeriodEndingDate") || "";
      // Use most recent (week 45 > week 44)
      const mktWeek = parseInt(d.getAttribute("MarketingYearWeekNumber") || "0");
      const target  = isCorn ? result.corn : result.soy;

      if (!target.week || mktWeek > target.week) {
        target.week = mktWeek;
        if (!result.date) {
        // Convert MM/DD/YYYY to DD/MM/YYYY
        const parts = period.split("/");
        result.date = parts.length === 3 ? `${parts[1]}/${parts[0]}/${parts[2]}` : period;
      }

        target.vendasSemana        = d.getAttribute("NetSales")                        || "";
        target.vendasAcum2526      = d.getAttribute("TotalCommitment")                || "";
        // Acum 24/25 = embarques acumulados + pendentes do ano anterior
        const prevAcum  = parseFloat(d.getAttribute("PreviousMKTYearAccumulatedExports") || "0");
        const prevOut   = parseFloat(d.getAttribute("PreviousMKTYearOutstandingSales")   || "0");
        target.vendasAcum2425      = String(prevAcum + prevOut);
        target.embarqueSemana      = d.getAttribute("WeeklyExports")                  || "";
        target.embarqueAcum2526    = d.getAttribute("AccumulatedExports")             || "";
        target.embarquePendente    = d.getAttribute("OutstandingSales")               || "";
        target.expectativa         = d.getAttribute("WASDEReportProjectionsQuantity") || "";
        target.embarqueAcum2425    = d.getAttribute("PreviousMKTYearAccumulatedExports") || "";
      }
    });
  } catch(e) {
    console.error("parseSales error:", e);
  }
  return result;
}

// ── Sales Export Card ─────────────────────────────────────────────────────────
function SalesCardExport({ label, icon, data, salesDate, logo, logoFooter, brand }) {
  const B = brand || BRANDS.granara;
  const fmtS = v => {
    const n = parseFloat(String(v||"").replace(/,/g,"."));
    if (isNaN(n) || v === "") return "—";
    // FAS data is in thousands — multiply by 1000 for full number display
    return Math.round(n * 1000).toLocaleString("pt-BR");
  };
  const pS = (a,b) => {
    const na=parseFloat(String(a).replace(/,/g,".")), nb=parseFloat(String(b).replace(/,/g,"."));
    if(!nb) return null;
    return (((na-nb)/nb)*100).toFixed(2);
  };
  const isPos = v => parseFloat(v) >= 0;
  const arrowCol = v => isPos(v) ? "#6fcf97" : "#eb5757";
  const dVendas = pS(data.vendasAcum2526, data.vendasAcum2425);

  return (
    <CardShellExport logo={logo} logoFooter={logoFooter} brand={B}>
      {/* commodity header */}
      <div style={{
        ...B.commodityStyle,
        padding:"14px 20px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        <div style={{display:"flex", alignItems:"center", gap:12}}>
          <img src={icon} style={{width:36,height:36,filter:"invert(1) sepia(1) saturate(2) hue-rotate(5deg)",opacity:.9}} alt={label}/>
          <div>
            <div style={{fontSize:22,fontWeight:"bold",letterSpacing:"0.2em",color:"#EFE8D8"}}>{label}</div>
            <div style={{fontSize:11,color:B.cardGold,letterSpacing:"0.15em"}}>EXPORTAÇÕES E VENDAS EUA · EM TONELADAS MÉTRICAS</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:9,color:B.cardGoldDim,letterSpacing:"0.1em"}}>RELATÓRIO SEMANAL</div>
          <div style={{fontSize:13,color:B.cardGold,fontWeight:"bold",letterSpacing:"0.1em"}}>ATÉ {salesDate||"—"}</div>
        </div>
      </div>

      <div style={{padding:"14px 20px 10px"}}>
        {/* VENDAS block */}
        <div style={{background:B.sectionBg,border:"1px solid #AF965D22",borderRadius:4,padding:"10px 14px",marginBottom:10}}>
          <div style={{fontSize:9,color:B.accent,letterSpacing:"0.15em",marginBottom:8,
            borderBottom:`1px solid ${B.accent}33`,paddingBottom:4,fontWeight:"bold"}}>VENDAS</div>
          {[
            ["Vendas da Semana 2025/26",   data.vendasSemana,   false],
            ["Vendas Acumuladas 2025/26",  data.vendasAcum2526, true],
            ["Vendas Acumuladas 2024/25",  data.vendasAcum2425, false],
          ].map(([l,v,b])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #ffffff08"}}>
              <span style={{fontSize:14,color:b?B.cardGold:"#b8c8b8",letterSpacing:"0.05em",fontWeight:b?"bold":"normal"}}>{l}</span>
              <span style={{fontSize:b?18:15,fontFamily:"monospace",fontWeight:b?"bold":"normal",color:"#ffffff"}}>{fmtS(v)}</span>
            </div>
          ))}
          {dVendas!==null&&(
            <div style={{textAlign:"right",fontSize:15,fontFamily:"monospace",color:arrowCol(dVendas),fontWeight:"bold",marginTop:2}}>
              {isPos(dVendas)?"▲":"▼"} {Math.abs(dVendas)}% acumulado
            </div>
          )}
        </div>

        {/* EMBARQUES block */}
        <div style={{background:B.sectionBg,border:"1px solid #AF965D22",borderRadius:4,padding:"10px 14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            marginBottom:8,borderBottom:"1px solid #AF965D33",paddingBottom:4}}>
            <div style={{fontSize:9,color:B.cardGold,letterSpacing:"0.15em",fontWeight:"bold"}}>EMBARQUES</div>
            {data.expectativa && (
              <div style={{fontSize:10,color:B.cardGold,fontFamily:"monospace",fontWeight:"bold"}}>
                EXPECTATIVA: {(parseFloat(data.expectativa)*1000).toLocaleString("pt-BR")}
              </div>
            )}
          </div>
          {[
            ["Embarques da Semana",         data.embarqueSemana,   false],
            ["Embarques Pendentes",         data.embarquePendente, false],
            ["Embarques Acumulados 2025/26",data.embarqueAcum2526, true],
            ["Embarques Acumulados 2024/25",data.embarqueAcum2425, false],
          ].map(([l,v,b])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #ffffff08"}}>
              <span style={{fontSize:14,color:b?B.cardGold:"#b8c8b8",letterSpacing:"0.05em",fontWeight:b?"bold":"normal"}}>{l}</span>
              <span style={{fontSize:b?18:15,fontFamily:"monospace",fontWeight:b?"bold":"normal",color:"#ffffff"}}>{fmtS(v)}</span>
            </div>
          ))}
        </div>
      </div>
    </CardShellExport>
  );
}


// ── WASDE Parser (XML — robusto por título semântico) ────────────────────────
//
// Duas estruturas de página coexistem no WASDE XML:
//
// TIPO A — US pages (sr11 Wheat, sr12 Corn, sr15 Soy):
//   m1_attribute_group > attribute{N} (element filho com attr attribute{N})
//     > m1_year_group_Collection > m1_year_group (market_year{N})
//       > m1_month_group_Collection > m1_month_group (forecast_month{N})
//         > Cell (cell_value{N})
//
// TIPO B — World pages (sr18/19 Wheat, sr22/23 Corn, sr28 Soy):
//   m1_attribute_group (com attr attribute{N} no próprio tag)
//     > Cell (cell_value{N})   ← flat, histórico
//   ou
//   m1_region_group > m1_month_group > m1_attribute_group > FormatFiller3 > Cell
//
// O parser detecta o sufixo numérico automaticamente e roteia para o handler correto.

function parseWASDE(xmlText) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(xmlText, 'text/xml');
  const root   = doc.documentElement;

  const ptMon = { JAN:'JAN',FEB:'FEV',MAR:'MAR',APR:'ABR',MAY:'MAI',JUN:'JUN',
                  JUL:'JUL',AUG:'AGO',SEP:'SET',OCT:'OUT',NOV:'NOV',DEC:'DEZ' };
  const toNum = s => { const v = parseFloat(String(s||'').replace(/,/g,'')); return isNaN(v)?null:v; };
  const cleanName = s => String(s||'').replace(/[\r\n]+/g,' ').trim();

  // ── Encontra página por termos no sub_report_title ─────────────────────────
  function findPage(terms) {
    for (const page of root.children) {
      const report = page.querySelector('Report');
      if (!report) continue;
      const title = (report.getAttribute('sub_report_title')||'').toLowerCase();
      if (terms.every(t => title.includes(t.toLowerCase()))) return report;
    }
    return null;
  }

  // ── Detecta sufixo numérico (1, 2, 4, 5…) de uma página ───────────────────
  function detectSuffix(report) {
    for (const el of report.querySelectorAll('Cell')) {
      for (const k of el.getAttributeNames()) {
        if (k.startsWith('cell_value')) return k.replace('cell_value','');
      }
    }
    return '1';
  }

  // ── TIPO A: US pages — attribute como elemento filho ───────────────────────
  // Retorna Map: attrName → [v_yr0, v_yr1, v_prev, v_cur]
  function parseUSPageA(report) {
    const sfx = detectSuffix(report);
    const map = new Map();
    for (const ag of report.querySelectorAll('m1_attribute_group')) {
      const aEl = ag.querySelector(`[attribute${sfx}]`);
      if (!aEl || aEl.tagName === 'Cell') continue;
      const name = cleanName(aEl.getAttribute(`attribute${sfx}`));
      const ygs = [...aEl.querySelectorAll(`m1_year_group`)];
      const vals = [];
      for (const yg of ygs) {
        const mgs = [...yg.querySelectorAll(`m1_month_group`)];
        if (mgs.length > 0) {
          for (const mg of mgs) {
            const cell = mg.querySelector(`Cell[cell_value${sfx}]`);
            vals.push(cell ? toNum(cell.getAttribute(`cell_value${sfx}`)) : null);
          }
        } else {
          const cell = yg.querySelector(`Cell[cell_value${sfx}]`);
          vals.push(cell ? toNum(cell.getAttribute(`cell_value${sfx}`)) : null);
        }
      }
      // Esperamos [yr0, yr1, prev, cur] — 4 valores
      if (vals.length >= 4) map.set(name, vals.slice(0,4));
    }
    return map;
  }

  // ── TIPO B flat: World pages — attribute no próprio m1_attribute_group ─────
  // Retorna Map: regionName → Map: attrName → value
  function parseWorldFlat(matrix, sfx) {
    const result = new Map();
    for (const rg of matrix.querySelectorAll('m1_region_group')) {
      const region = cleanName(rg.getAttribute(`region${sfx}`) || rg.getAttribute('region1') || '');
      const attrs = new Map();
      for (const ag of rg.querySelectorAll('m1_attribute_group')) {
        const name = cleanName(ag.getAttribute(`attribute${sfx}`) || ag.getAttribute('attribute1') || '');
        if (!name) continue;
        const cell = ag.querySelector(`Cell[cell_value${sfx}]`);
        if (cell) attrs.set(name, toNum(cell.getAttribute(`cell_value${sfx}`)));
      }
      if (attrs.size) result.set(region, attrs);
    }
    return result;
  }

  // ── TIPO B proj: World cont'd pages — region > month_group > attribute ─────
  // Retorna Map: regionName → Map: month → Map: attrName → value
  function parseWorldProj(matrix, sfx) {
    const result = new Map();
    for (const rg of matrix.querySelectorAll('m1_region_group')) {
      const region = cleanName(rg.getAttribute(`region${sfx}`) || rg.getAttribute('region1') || '');
      const byMonth = new Map();
      for (const mg of rg.querySelectorAll('m1_month_group')) {
        const month = (mg.getAttribute(`forecast_month${sfx}`) || mg.getAttribute('forecast_month1') || '').trim();
        const attrs = new Map();
        for (const ag of mg.querySelectorAll('m1_attribute_group')) {
          const name = cleanName(ag.getAttribute(`attribute${sfx}`) || ag.getAttribute('attribute1') || '');
          if (!name) continue;
          const cell = ag.querySelector(`Cell[cell_value${sfx}]`);
          if (cell) attrs.set(name, toNum(cell.getAttribute(`cell_value${sfx}`)));
        }
        if (attrs.size) byMonth.set(month, attrs);
      }
      if (byMonth.size) result.set(region, byMonth);
    }
    return result;
  }

  // ── Combina flat23, flat24, proj26 numa estrutura uniforme ─────────────────
  // Retorna Map: regionName → Map: attrName → [v23, v24, vPrev, vCur]
  function mergeWorldData(flat23, flat24, proj26) {
    const allRegions = new Set([...flat23.keys(), ...flat24.keys(), ...proj26.keys()]);
    const regionMap = new Map();
    for (const region of allRegions) {
      const d23 = flat23.get(region) || new Map();
      const d24 = flat24.get(region) || new Map();
      const d26 = proj26.get(region);
      const allAttrs = new Set([...d23.keys(), ...d24.keys(),
        ...(d26 ? [...d26.values()].flatMap(m => [...m.keys()]) : [])]);
      const attrMap = new Map();
      for (const attr of allAttrs) {
        const months = d26 ? [...d26.entries()] : [];
        const vPrev = months[0] ? months[0][1].get(attr) ?? null : null;
        const vCur  = months[1] ? months[1][1].get(attr) ?? null : (months[0] ? months[0][1].get(attr) ?? null : null);
        attrMap.set(attr, [d23.get(attr)??null, d24.get(attr)??null, vPrev, vCur]);
      }
      regionMap.set(region, attrMap);
    }
    return regionMap;
  }

  // Helper: busca região por fragmento de nome (trim + endsWith)
  function wv(regionMap, frag, attr) {
    const f = frag.trim();
    for (const [key, attrs] of regionMap) {
      const k = key.trim();
      if (k === f || k.endsWith(f) || k.includes(f)) {
        return attrs.get(attr) || [null,null,null,null];
      }
    }
    return [null,null,null,null];
  }

  // ── Metadados: meses e safras do sr15 (Soy US) ─────────────────────────────
  function extractMeta(report) {
    const sfx = detectSuffix(report);
    const years = [...report.querySelectorAll(`[market_year${sfx}]`)]
      .map(el => el.getAttribute(`market_year${sfx}`).trim()).filter(Boolean);
    const months = [...report.querySelectorAll(`[forecast_month${sfx}]`)]
      .map(el => el.getAttribute(`forecast_month${sfx}`).trim()).filter(Boolean);
    const unique = [...new Set(years)];
    const s = i => (unique[i]||'').replace(/ Est\.| Proj\./g,'').trim();
    const nonEmpty = [...new Set(months.filter(Boolean))];
    const pm = ptMon[(nonEmpty[0]||'').slice(0,3).toUpperCase()] || nonEmpty[0]||'';
    const cm = ptMon[(nonEmpty[1]||nonEmpty[0]||'').slice(0,3).toUpperCase()] || nonEmpty[1]||'';
    return {
      cols: [
        { safra: s(0), month: cm },
        { safra: s(1), month: cm },
        { safra: s(2), month: pm },
        { safra: s(2), month: cm },
      ],
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SOJA EUA  (sr15 — Tipo A)
  // ══════════════════════════════════════════════════════════════════════════
  const soyUSPage = findPage(['u.s. soybeans', 'products', 'supply and use']);
  const meta  = soyUSPage ? extractMeta(soyUSPage) : { cols: [{safra:'',month:''},{safra:'',month:''},{safra:'',month:''},{safra:'',month:''}] };
  const cols  = meta.cols;
  const usoyM = soyUSPage ? parseUSPageA(soyUSPage) : new Map();
  const uv    = attr => usoyM.get(attr) || [null,null,null,null];

  const soyUSRows = [
    { label:'Área Plantada',  values: uv('Area Planted'),             hl:false },
    { label:'Área Colhida',   values: uv('Area Harvested'),           hl:false },
    { label:'Produtividade',  values: uv('Yield per Harvested Acre'), hl:false },
    { label:'PRODUÇÃO',       values: uv('Production'),               hl:true  },
    { label:'EXPORTAÇÃO',     values: uv('Exports'),                  hl:true  },
    { label:'Esmagamento',    values: uv('Crushings'),                hl:false },
    { label:'IMPORTAÇÃO',     values: uv('Imports'),                  hl:false },
    { label:'ESTOQUE FINAL',  values: uv('Ending Stocks'),            hl:true  },
  ];

  // ══════════════════════════════════════════════════════════════════════════
  // SOJA MUNDO  (sr28 — Tipo B especial com sufixos 4/5/2)
  // ══════════════════════════════════════════════════════════════════════════
  const soyWorldPage = findPage(['world soybean supply and use']);
  let soyWM = new Map();
  if (soyWorldPage) {
    const mx4 = soyWorldPage.querySelector('matrix4');
    const mx5 = soyWorldPage.querySelector('matrix5');
    const mx3 = soyWorldPage.querySelector('matrix3'); // 2025/26 with months
    const flat23 = mx4 ? parseWorldFlat(mx4, '4') : new Map();
    const flat24 = mx5 ? parseWorldFlat(mx5, '5') : new Map();
    const proj26 = mx3 ? parseWorldProj(mx3, '2') : new Map();
    soyWM = mergeWorldData(flat23, flat24, proj26);
  }

  const soyWorldRows = [
    { label:'MUNDO - PRODUÇÃO',      values: wv(soyWM,'World  2/','Production'),      hl:true  },
    { label:'MUNDO - CONSUMO',       values: wv(soyWM,'World  2/','Domestic Total'),   hl:true  },
    { label:'MUNDO - ESTOQUE FINAL', values: wv(soyWM,'World  2/','Ending Stocks'),    hl:true  },
    { label:'BRASIL - PRODUÇÃO',     values: wv(soyWM,'Brazil','Production'),          hl:true  },
    { label:'BRASIL - EXPORTAÇÃO',   values: wv(soyWM,'Brazil','Exports'),             hl:true  },
    { label:'ARGENTINA - PROD.',     values: wv(soyWM,'Argentina','Production'),       hl:false },
    { label:'CHINA - IMPORT.',       values: wv(soyWM,'China','Imports'),              hl:false },
    { label:'UE - IMPORTAÇÃO',       values: wv(soyWM,'European Union','Imports'),     hl:false },
  ];

  // ══════════════════════════════════════════════════════════════════════════
  // MILHO EUA  (sr12 — Tipo A, sufixo 1)
  // ══════════════════════════════════════════════════════════════════════════
  const cornUSPage = findPage(['u.s. feed grain', 'corn supply and use']);
  const ucornM = cornUSPage ? parseUSPageA(cornUSPage) : new Map();
  const cuv    = attr => ucornM.get(attr) || [null,null,null,null];

  const cornUSRows = [
    { label:'Área Plantada',  values: cuv('Area Planted'),             hl:false },
    { label:'Área Colhida',   values: cuv('Area Harvested '),          hl:false },
    { label:'Produtividade',  values: cuv('Yield per Harvested Acre'), hl:false },
    { label:'PRODUÇÃO',       values: cuv('Production'),               hl:true  },
    { label:'EXPORTAÇÃO',     values: cuv('Exports'),                  hl:true  },
    { label:'ESTOQUE FINAL',  values: cuv('Ending Stocks'),            hl:true  },
  ];

  // ══════════════════════════════════════════════════════════════════════════
  // MILHO MUNDO  (sr22 flat + sr23 proj — Tipo B, sufixo 1)
  // ══════════════════════════════════════════════════════════════════════════
  const cornWorldPage = findPage(['world corn supply and use']);
  const cornProjPage  = findPage(["world corn supply and use", "cont"]);
  let cornWM = new Map();
  if (cornWorldPage) {
    const mx1 = cornWorldPage.querySelector('matrix1');
    const mx2 = cornWorldPage.querySelector('matrix2');
    const flat23 = mx1 ? parseWorldFlat(mx1, '1') : new Map();
    const flat24 = mx2 ? parseWorldFlat(mx2, '2') : new Map();
    let proj26 = new Map();
    if (cornProjPage) {
      const pmx = cornProjPage.querySelector('matrix1');
      if (pmx) proj26 = parseWorldProj(pmx, '1');
    }
    cornWM = mergeWorldData(flat23, flat24, proj26);
  }

  const cornWorldRows = [
    { label:'MUNDO - PRODUÇÃO',    values: wv(cornWM,'World','Production'),     hl:true  },
    { label:'MUNDO - CONSUMO',     values: wv(cornWM,'World','Domestic Total'),  hl:true  },
    { label:'MUNDO - ESTOQUE F.',  values: wv(cornWM,'World','Ending Stocks'),   hl:true  },
    { label:'CHINA - PRODUÇÃO',    values: wv(cornWM,'China','Production'),      hl:false },
    { label:'CHINA - ESTOQUE F.',  values: wv(cornWM,'China','Ending Stocks'),   hl:false },
    { label:'BRASIL - PRODUÇÃO',   values: wv(cornWM,'Brazil','Production'),     hl:true  },
    { label:'BRASIL - EXPORTAÇÃO', values: wv(cornWM,'Brazil','Exports'),        hl:true  },
    { label:'UCRÂNIA - EXPORT.',   values: wv(cornWM,'Ukraine','Exports'),       hl:false },
    { label:'ARGENTINA - PROD.',   values: wv(cornWM,'Argentina','Production'),  hl:false },
    { label:'ARGENTINA - EXPORT.', values: wv(cornWM,'Argentina','Exports'),     hl:false },
  ];

  // ══════════════════════════════════════════════════════════════════════════
  // TRIGO EUA  (sr11 — Tipo A, sufixo 1)
  // ══════════════════════════════════════════════════════════════════════════
  const wheatUSPage = findPage(['u.s. wheat supply and use']);
  const uwheatM = wheatUSPage ? parseUSPageA(wheatUSPage) : new Map();
  const wuv     = attr => uwheatM.get(attr) || [null,null,null,null];

  // ══════════════════════════════════════════════════════════════════════════
  // TRIGO MUNDO  (sr18 flat + sr19 proj — Tipo B, sufixo 1)
  // ══════════════════════════════════════════════════════════════════════════
  const wheatWorldPage = findPage(['world wheat supply and use']);
  const wheatProjPage  = findPage(["world wheat supply and use", "cont"]);
  let wheatWM = new Map();
  if (wheatWorldPage) {
    const mx1 = wheatWorldPage.querySelector('matrix1');
    const mx2 = wheatWorldPage.querySelector('matrix2');
    const flat23 = mx1 ? parseWorldFlat(mx1, '1') : new Map();
    const flat24 = mx2 ? parseWorldFlat(mx2, '2') : new Map();
    let proj26 = new Map();
    if (wheatProjPage) {
      const pmx = wheatProjPage.querySelector('matrix1');
      if (pmx) proj26 = parseWorldProj(pmx, '1');
    }
    wheatWM = mergeWorldData(flat23, flat24, proj26);
  }

  const wheatWorldRows = [
    { label:'MUNDO - PRODUÇÃO',      values: wv(wheatWM,'World','Production'),       hl:true  },
    { label:'MUNDO - CONSUMO',       values: wv(wheatWM,'World','Domestic Total 2/'), hl:true  },
    { label:'MUNDO - ESTOQUE F.',    values: wv(wheatWM,'World','Ending Stocks'),     hl:true  },
    { label:'EUA - PRODUÇÃO',        values: wuv('Production'),                       hl:false },
    { label:'EUA - EXPORTAÇÃO',      values: wuv('Exports'),                          hl:false },
    { label:'BRASIL - IMPORTAÇÃO',   values: wv(wheatWM,'Brazil','Imports'),          hl:false },
    { label:'UCRÂNIA - EXPORT.',     values: wv(wheatWM,'Ukraine','Exports'),         hl:false },
    { label:'ARGENTINA - EXPORT.',   values: wv(wheatWM,'Argentina','Exports'),       hl:false },
    { label:'RUSSIA - EXPORT.',      values: wv(wheatWM,'Russia','Exports'),          hl:false },
    { label:'UE - EXPORTAÇÃO',       values: wv(wheatWM,'European Union','Exports'),  hl:false },
  ];

  return {
    cols,
    soja:  { cols, commodity:'SOJA',  sections:[
      { key:'soyUS',    title:'ESTADOS UNIDOS', rows:soyUSRows    },
      { key:'soyWorld', title:'MUNDO',          rows:soyWorldRows },
    ]},
    milho: { cols, commodity:'MILHO', sections:[
      { key:'cornUS',    title:'MILHO EUA',   rows:cornUSRows    },
      { key:'cornWorld', title:'MILHO MUNDO', rows:cornWorldRows },
    ]},
    trigo: { cols, commodity:'TRIGO', sections:[
      { key:'wheatUS',    title:'TRIGO EUA',   rows:[
        { label:'PRODUÇÃO',      values: wuv('Production'),   hl:true  },
        { label:'EXPORTAÇÃO',    values: wuv('Exports'),      hl:true  },
        { label:'ESTOQUE FINAL', values: wuv('Ending Stocks'),hl:true  },
      ]},
      { key:'wheatWorld', title:'TRIGO MUNDO', rows:wheatWorldRows },
    ]},
  };
}

// ── Constantes de layout (espelham exatamente WasdeRow) ──────────────────────
const CW = { label: 190, h0: 76, h1: 76, p0: 80, p1: 92, ex: 76 };
const CW_LABEL_TOTAL = CW.label + 16; // +16 = paddingLeft das linhas
const DIV_W  = 9;                      // 1px + 4px margin cada lado
const CUR_BG = 'rgba(175,150,93,0.11)';
const CUR_BL = '1px solid rgba(175,150,93,0.28)';

function ColDivider({ color }) {
  return (
    <div style={{ width: DIV_W, flexShrink: 0, display: 'flex',
      alignItems: 'stretch', justifyContent: 'center' }}>
      <div style={{ width: 1, background: color }} />
    </div>
  );
}

function WasdeColHeader({ cols, B }) {
  const col = (w, safra, month, color, size=11) => (
    <div style={{ width: w, flexShrink: 0, textAlign: 'right',
      paddingRight: 8, paddingTop: 8, paddingBottom: 6 }}>
      <div style={{ fontSize: 9, color: `${B.cardGold}55`,
        fontFamily: 'Arial,sans-serif', lineHeight: 1.3 }}>{safra}</div>
      <div style={{ fontSize: size, fontWeight: 700, color,
        fontFamily: 'Arial,sans-serif' }}>{month}</div>
    </div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'stretch',
      borderBottom: `1px solid ${B.cardGold}44`, background: '#001a17' }}>
      {/* Espaço do rótulo — width + paddingLeft iguais às linhas */}
      <div style={{ width: CW_LABEL_TOTAL, flexShrink: 0 }} />
      {col(CW.h0, cols[0]?.safra, cols[0]?.month, `${B.cardGold}55`)}
      {col(CW.h1, cols[1]?.safra, cols[1]?.month, `${B.cardGold}77`)}
      <ColDivider color={`${B.cardGold}33`} />
      {col(CW.p0, cols[2]?.safra, cols[2]?.month, `${B.cardGold}99`)}
      {/* Coluna ABR atual — fundo que percorre todo o card */}
      <div style={{ width: CW.p1, flexShrink: 0, textAlign: 'right',
        paddingRight: 10, paddingTop: 8, paddingBottom: 6,
        background: CUR_BG, borderLeft: CUR_BL, borderRight: CUR_BL }}>
        <div style={{ fontSize: 9, color: `${B.cardGold}99`,
          fontFamily: 'Arial,sans-serif', lineHeight: 1.3 }}>{cols[3]?.safra}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: B.cardGold,
          fontFamily: 'Arial,sans-serif', letterSpacing: '0.06em' }}>{cols[3]?.month}</div>
      </div>
      <ColDivider color="#6fcf9733" />
      <div style={{ width: CW.ex, flexShrink: 0, textAlign: 'right',
        paddingRight: 8, paddingTop: 8, paddingBottom: 6 }}>
        <div style={{ fontSize: 9, lineHeight: 1.3 }}>&nbsp;</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6fcf97',
          fontFamily: 'Arial,sans-serif', letterSpacing: '0.06em' }}>EXPEC</div>
      </div>
    </div>
  );
}

function WasdeRow({ label, values, hl, expVal, editing, onExpec, B, rowIdx }) {
  const fmt = v => v == null
    ? '—'
    : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const isEven = rowIdx % 2 === 0;
  const rowBg  = hl ? `${B.cardGold}12` : isEven ? 'rgba(255,255,255,0.018)' : 'transparent';

  const cfg = [
    { w: CW.h0, color: hl ? '#999' : '#666',       size: 11, weight: hl ? 500 : 400 },
    { w: CW.h1, color: hl ? '#aaa' : '#777',       size: 11, weight: hl ? 500 : 400 },
    { w: CW.p0, color: hl ? '#c8a840' : '#8e7e50', size: hl ? 12 : 11, weight: hl ? 600 : 400 },
    { w: CW.p1, color: hl ? '#ffffff' : '#ddd4bc', size: hl ? 15 : 13, weight: hl ? 700 : 600 },
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'center', background: rowBg,
      borderBottom: `1px solid ${hl ? B.cardGold + '1a' : 'rgba(255,255,255,0.03)'}`,
      minHeight: hl ? 38 : 32 }}>
      {/* Rótulo — paddingLeft fixo para alinhar com WasdeColHeader */}
      <div style={{ width: CW.label, flexShrink: 0,
        fontSize: hl ? 12 : 11, fontFamily: 'Arial,sans-serif',
        fontWeight: hl ? 700 : 400, color: hl ? B.cardGold : '#b8ccb8',
        letterSpacing: hl ? '0.06em' : '0.01em',
        textTransform: hl ? 'uppercase' : 'none',
        paddingLeft: 16 }}>{label}</div>

      {/* h0 */}
      <div style={{ width: cfg[0].w, flexShrink: 0, textAlign: 'right', paddingRight: 8,
        fontFamily: "'Courier New',monospace", fontSize: cfg[0].size,
        color: cfg[0].color, fontWeight: cfg[0].weight }}>{fmt(values[0])}</div>
      {/* h1 */}
      <div style={{ width: cfg[1].w, flexShrink: 0, textAlign: 'right', paddingRight: 8,
        fontFamily: "'Courier New',monospace", fontSize: cfg[1].size,
        color: cfg[1].color, fontWeight: cfg[1].weight }}>{fmt(values[1])}</div>

      <ColDivider color={`${B.cardGold}22`} />

      {/* p0 */}
      <div style={{ width: cfg[2].w, flexShrink: 0, textAlign: 'right', paddingRight: 8,
        fontFamily: "'Courier New',monospace", fontSize: cfg[2].size,
        color: cfg[2].color, fontWeight: cfg[2].weight }}>{fmt(values[2])}</div>
      {/* p1 — coluna ABR com fundo contínuo */}
      <div style={{ width: CW.p1, flexShrink: 0, textAlign: 'right', paddingRight: 10,
        fontFamily: "'Courier New',monospace", fontSize: cfg[3].size,
        color: cfg[3].color, fontWeight: cfg[3].weight,
        background: CUR_BG, borderLeft: CUR_BL, borderRight: CUR_BL,
        alignSelf: 'stretch', display: 'flex', alignItems: 'center',
        justifyContent: 'flex-end' }}>{fmt(values[3])}</div>

      <ColDivider color="#6fcf9722" />

      {/* EXPEC */}
      <div style={{ width: CW.ex, flexShrink: 0, textAlign: 'right', paddingRight: 8 }}>
        {editing ? (
          <input type="text"
            defaultValue={expVal != null ? String(expVal).replace('.', ',') : ''}
            onBlur={e => {
              const num = parseFloat(e.target.value.replace(',', '.'));
              onExpec && onExpec(label, isNaN(num) ? null : num);
            }}
            style={{ width: 68, textAlign: 'right', fontSize: 12,
              background: '#6fcf9715', border: '1px solid #6fcf9755',
              borderRadius: 2, color: '#6fcf97',
              fontFamily: "'Courier New',monospace",
              padding: '2px 4px', outline: 'none' }}
            placeholder="—" />
        ) : (
          <div style={{ fontFamily: "'Courier New',monospace",
            fontSize: hl ? 14 : 12,
            color: expVal != null ? '#6fcf97' : 'rgba(111,207,151,0.18)',
            fontWeight: hl ? 700 : 400 }}>
            {expVal != null ? fmt(expVal) : '—'}
          </div>
        )}
      </div>
    </div>
  );
}

function WasdeSection({ title, rows, cols, expec, onExpec, brand, editing }) {
  const B = brand || BRANDS.granara;
  return (
    <div style={{ marginBottom: 0 }}>
      {/* Cabeçalho da seção */}
      <div style={{
        display: 'flex', alignItems: 'center',
        background: `linear-gradient(90deg,${B.cardMid},${B.cardBg}cc)`,
        borderTop: `2px solid ${B.cardGold}22`,
        borderBottom: `1px solid ${B.cardGold}33`,
        padding: '7px 0 7px 13px',
        borderLeft: `3px solid ${B.cardGold}`,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: B.cardGold,
          letterSpacing: '0.16em', fontFamily: "'Cinzel',serif",
          flex: 1,
        }}>{title}</div>
        {/* Mini cabeçalho de colunas repetido — apenas meses */}
        <div style={{ display: 'flex', alignItems: 'center', paddingRight: 4 }}>
          <div style={{ width: CW.h0, textAlign: 'right', paddingRight: 8, fontSize: 9, color: `${B.cardGold}44`, fontFamily: 'Arial,sans-serif' }}>{cols[0]?.month}</div>
          <div style={{ width: CW.h1, textAlign: 'right', paddingRight: 8, fontSize: 9, color: `${B.cardGold}55`, fontFamily: 'Arial,sans-serif' }}>{cols[1]?.month}</div>
          <div style={{ width: 1, background: `${B.cardGold}22`, alignSelf: 'stretch', margin: '0 4px' }} />
          <div style={{ width: CW.p0, textAlign: 'right', paddingRight: 8, fontSize: 9, color: `${B.cardGold}77`, fontFamily: 'Arial,sans-serif' }}>{cols[2]?.month}</div>
          <div style={{ width: CW.p1, textAlign: 'right', paddingRight: 10, fontSize: 10, color: B.cardGold, fontWeight: 700, fontFamily: 'Arial,sans-serif', background: CUR_BG, borderLeft: CUR_BL, borderRight: CUR_BL, alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>{cols[3]?.month}</div>
          <div style={{ width: 1, background: '#6fcf9722', alignSelf: 'stretch', margin: '0 4px' }} />
          <div style={{ width: CW.ex, textAlign: 'right', paddingRight: 8, fontSize: 9, color: '#6fcf9966', fontFamily: 'Arial,sans-serif' }}>EXPEC</div>
        </div>
      </div>
      {/* Linhas */}
      {rows.map(({ label, values, hl }, i) => (
        <WasdeRow key={label} label={label} values={values} hl={hl}
          expVal={expec?.[label]} editing={editing}
          onExpec={onExpec} B={B} rowIdx={i} />
      ))}
    </div>
  );
}

function WasdeShell({ children, brand, logo, logoFooter, title, reportLabel, cols }) {
  const B = brand || BRANDS.granara;
  return (
    <div style={{
      background: B.cardBg,
      border: `2px solid ${B.cardGold}`,
      borderRadius: 6,
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      display: 'inline-block',
      minWidth: CW.label + CW.h0 + CW.h1 + CW.p0 + CW.p1 + CW.ex + 40,
    }}>
      {/* Header */}
      <div style={{
        background: B.headerGrad,
        borderBottom: `2px solid ${B.cardGold}66`,
        padding: '11px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <img src={logo || B.logoHeader} alt={B.name}
          style={{ height: B.logoHeaderH || 44, objectFit: 'contain',
            filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.4))' }} />
        <div style={{ fontSize: 10, color: `${B.cardGold}88`, letterSpacing: '0.18em', fontFamily: "'Cinzel',serif" }}>
          FONTE: USDA · WASDE
        </div>
      </div>

      {/* Commodity strip */}
      <div style={{
        ...B.commodityStyle,
        padding: '13px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '0.2em', color: '#EFE8D8', fontFamily: "'Cinzel',serif" }}>
            {title}
          </div>
          <div style={{ fontSize: 9, color: `${B.cardGold}aa`, letterSpacing: '0.14em', marginTop: 3, fontFamily: "'Cinzel',serif" }}>
            RELATÓRIO MENSAL USDA · OFERTA E DEMANDA
          </div>
        </div>
        {reportLabel && (
          <div style={{
            fontSize: 13, color: B.cardGold, fontWeight: 700,
            letterSpacing: '0.08em', fontFamily: "'Cinzel',serif",
            background: `${B.cardGold}18`, border: `1px solid ${B.cardGold}55`,
            borderRadius: 3, padding: '5px 12px',
          }}>{reportLabel}</div>
        )}
      </div>

      {/* Cabeçalho global de colunas com safra completa */}
      {cols && <WasdeColHeader cols={cols} B={B} />}

      {/* Seções */}
      <div>{children}</div>

      {/* Footer */}
      <div style={{
        borderTop: `1px solid ${B.cardGold}22`,
        background: `${B.cardMid}22`,
        padding: '7px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ fontSize: 9, color: `${B.cardGold}44`, fontFamily: 'monospace', fontStyle: 'italic' }}>
          Em milhões de toneladas · *Área em milhões de ha · *Produtividade bu/ha
        </div>
        <img src={logoFooter || B.logoFooter} alt={B.name}
          style={{ height: B.logoFooterH || 36, objectFit: 'contain' }} />
      </div>
    </div>
  );
}

// ── WASDE Card (full commodity) ───────────────────────────────────────────────
function WasdeCard({ data, expec, onExpec, brand, logo, logoFooter, reportLabel, editing }) {
  const B = brand || BRANDS.granara;
  if (!data) return null;
  return (
    <WasdeShell brand={B} logo={logo} logoFooter={logoFooter}
      title={data.title} reportLabel={reportLabel} cols={data.cols}>
      {data.sections.map(sec => (
        <WasdeSection key={sec.key} title={sec.title} rows={sec.rows}
          cols={data.cols} expec={expec?.[sec.key] || {}}
          onExpec={(label, val) => onExpec && onExpec(sec.key, label, val)}
          brand={B} editing={editing} />
      ))}
    </WasdeShell>
  );
}

// ── WASDE Tab ─────────────────────────────────────────────────────────────────
function WasdeTab({ brand }) {
  const B = brand || BRANDS.granara;
  const logo       = B.logoHeader;
  const logoFooter = B.logoFooter;

  const [parsed,   setParsed]  = useState(null);
  const [status,   setStatus]  = useState('');
  const [editing,  setEditing] = useState(false);
  const [expec,    setExpec]   = useState({
    soyUS:{}, soyWorld:{}, cornUS:{}, cornWorld:{}, wheatWorld:{}
  });
  const [dl, setDl] = useState({});
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus('Processando...');
    const isXML = file.name.toLowerCase().endsWith('.xml');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        let p;
        if (isXML) {
          p = parseWASDE(ev.target.result);
        } else {
          const data = new Uint8Array(ev.target.result);
          // Legacy XLS path — kept for backward compat but XML is preferred
          const XLSX2 = window.XLSX || (typeof XLSX !== 'undefined' ? XLSX : null);
          if (!XLSX2) throw new Error('XLSX não disponível para .xls');
          const wb = XLSX2.read(data, {type:'array'});
          p = parseWASDE(wb); // will fail gracefully — old parser removed
        }
        setParsed(p);
        setStatus(`✓ WASDE carregado`);
      } catch(err) {
        setStatus(`✗ Erro: ${err.message}`);
        console.error(err);
      }
    };
    if (isXML) {
      reader.readAsText(file, 'UTF-8');
    } else {
      reader.readAsArrayBuffer(file);
    }
  };

  const setE = (sec, label, val) =>
    setExpec(prev => ({...prev, [sec]:{...prev[sec], [label]:val}}));

  async function handleDL(id, filename) {
    setEditing(false);
    setTimeout(async () => {
      setDl(p=>({...p,[id]:true}));
      try { await downloadCardPNG(id, filename); }
      catch(e) { alert('Erro ao gerar PNG: '+e.message); }
      finally { setDl(p=>({...p,[id]:false})); }
    }, 100);
  }

  const reportLabel = parsed ? `WASDE · ${parsed.cols?.[3]?.month||''} ${parsed.cols?.[3]?.safra?.split('/')[1]||''}` : '';

  const Section = ({id, title, filename, cardData}) => (
    <div style={{marginBottom:40}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
        <div style={{fontSize:12, color:G.gold, fontFamily:"'Cinzel',serif", letterSpacing:'0.18em'}}>{title}</div>
        <div style={{display:'flex', gap:8}}>
          <button onClick={()=>setEditing(e=>!e)} style={{
            background:'transparent', border:`1px solid ${G.goldDark}`, borderRadius:2,
            color:editing?G.gold:G.cream+'88',
            fontFamily:"'Cinzel',serif", fontSize:9, letterSpacing:'0.1em',
            padding:'6px 12px', cursor:'pointer',
          }}>{editing ? '✓ FECHAR EDIÇÃO' : '✎ EDITAR EXPEC'}</button>
          <button onClick={()=>handleDL(id,filename)} disabled={dl[id]} style={{
            background:dl[id]?'transparent':G.gold,
            border:`1px solid ${G.goldDark}`, borderRadius:2,
            color:dl[id]?G.gold:G.darkGreen,
            fontFamily:"'Cinzel',serif", fontSize:9, letterSpacing:'0.12em',
            padding:'6px 14px', cursor:dl[id]?'wait':'pointer', fontWeight:'bold',
          }}>{dl[id]?'⏳ GERANDO...':'⬇ BAIXAR PNG'}</button>
        </div>
      </div>
      <div id={id} style={{display:'inline-block'}}>
        <WasdeCard data={{...cardData, title:cardData?.commodity}}
          expec={expec} onExpec={setE}
          brand={B} logo={logo} logoFooter={logoFooter}
          reportLabel={reportLabel} editing={editing}/>
      </div>
    </div>
  );

  return (
    <div>
      {/* Upload bar */}
      <div style={{display:'flex', gap:14, alignItems:'center', marginBottom:24, flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:9, color:G.gold, fontFamily:"'Cinzel',serif", letterSpacing:'0.1em', marginBottom:4}}>
            ARQUIVO WASDE (.XML · .XLS)
          </div>
          <div style={{display:'flex', gap:10, alignItems:'center'}}>
            <button onClick={()=>fileRef.current?.click()} style={{
              background:G.gold, border:'none', borderRadius:2, color:G.darkGreen,
              fontFamily:"'Cinzel',serif", fontSize:10, letterSpacing:'0.12em',
              padding:'8px 18px', cursor:'pointer', fontWeight:'bold',
            }}>⬆ CARREGAR WASDE</button>
            <input ref={fileRef} type="file" accept=".xml,.xls,.xlsx" onChange={handleFile} style={{display:'none'}}/>
            {status && (
              <div style={{fontSize:10, fontFamily:'monospace',
                color:status.startsWith('✓')?'#6fcf97':status.startsWith('✗')?'#eb5757':G.cream+'88'}}>
                {status}
              </div>
            )}
          </div>
        </div>
        {parsed && (
          <div style={{
            background:`${G.midGreen}44`, border:`1px solid ${G.goldDark}`,
            borderRadius:4, padding:'8px 14px', display:'flex', gap:16, alignItems:'center',
          }}>
            <div style={{fontSize:9, color:G.gold, fontFamily:"'Cinzel',serif", letterSpacing:'0.1em'}}>COLUNAS:</div>
            {parsed.cols.map((c,i)=>(
              <div key={i} style={{fontSize:10, fontFamily:'monospace', color:G.cream}}>
                <span style={{color:G.goldDark}}>{c.safra}</span>{' '}
                <span style={{color:G.gold, fontWeight:'bold'}}>{c.month}</span>
              </div>
            ))}
            <div style={{fontSize:10, fontFamily:'monospace', color:'#6fcf97'}}>EXPEC</div>
          </div>
        )}
      </div>

      {parsed ? (
        <>
          <Section id="wasde-soja"  title="SOJA · OFERTA E DEMANDA"  filename="wasde-soja.png"
            cardData={{...parsed.soja,  commodity:'SOJA'}}  />
          <Section id="wasde-milho" title="MILHO · OFERTA E DEMANDA" filename="wasde-milho.png"
            cardData={{...parsed.milho, commodity:'MILHO'}} />
          <Section id="wasde-trigo" title="TRIGO · OFERTA E DEMANDA" filename="wasde-trigo.png"
            cardData={{...parsed.trigo, commodity:'TRIGO'}} />
        </>
      ) : (
        <div style={{
          textAlign:'center', padding:'60px 20px',
          color:`${G.cream}33`, fontFamily:"'Cinzel',serif",
          fontSize:13, letterSpacing:'0.15em',
        }}>
          CARREGUE O ARQUIVO WASDE PARA VISUALIZAR OS CARDS
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]       = useState("export");
  const [brandId, setBrandId] = useState("granara");
  const brand = BRANDS[brandId];
  const T = brand;
  const cardLogo = brand.logoHeader;
  const cardLogoFooter = brand.logoFooter;
  const [reportDate, setRD] = useState("");
  const [cropDate,   setCD] = useState("");
  const [loading,  setLd]   = useState({ams:false, crop:false, sales:false});
  const [status,   setSt]   = useState({ams:"", crop:"", sales:""});

  const [exportData, setED] = useState({
    corn:{semanaAtual:"",semanaAnterior:"",anoAnterior:"",acumulado2526:"",acumulado2425:"",expectativa:"",semanas:""},
    soy: {semanaAtual:"",semanaAnterior:"",anoAnterior:"",acumulado2526:"",acumulado2425:"",expectativa:"",semanas:""},
  });
  const [cropData, setCD2] = useState({corn:{}, soy:{}});

  const upExp  = (c,f,v) => setED(p=>({...p,[c]:{...p[c],[f]:v}}));
  const upCrop = (c,s,f,v) => setCD2(p=>({...p,[c]:{...p[c],[s]:{...(p[c][s]||{}),[f]:v}}}));

  const fetchAMS = useCallback(async () => {
    setLd(p=>({...p,ams:true})); setSt(p=>({...p,ams:"Buscando..."}));
    try {
      const res  = await fetch("/api/proxy-ams");
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const data = parseAMS(text);
      if(!data.corn.semanaAtual) throw new Error("Não foi possível extrair dados de milho");
      setED(p=>({
        corn:{...p.corn,...data.corn},
        soy: {...p.soy, ...data.soy},
      }));
      if(data.weekEnding) setRD(data.weekEnding);
      setSt(p=>({...p,ams:`✓ Atualizado · ${data.weekEnding||data.reportDate}`}));
    } catch(e) {
      setSt(p=>({...p,ams:`✗ Erro: ${e.message}`}));
    } finally {
      setLd(p=>({...p,ams:false}));
    }
  },[]);

  const [cropManualUrl, setCropManualUrl] = useState("");
  const [showCropUrl,   setShowCropUrl]   = useState(false);
  const [salesData,    setSalesData]   = useState({corn:{}, soy:{}});
  const [salesDate,    setSalesDate]   = useState("");

  const fetchCrop = useCallback(async (manualUrl) => {
    setLd(p=>({...p,crop:true})); setSt(p=>({...p,crop:"Buscando..."}));
    try {
      const url = manualUrl
        ? `/api/proxy-crop?url=${encodeURIComponent(manualUrl)}`
        : "/api/proxy-crop";
      const res  = await fetch(url);
      const text = await res.text();
      if(!res.ok) {
        // Show manual URL input on 404
        setShowCropUrl(true);
        throw new Error(text.split("\n")[0]);
      }
      setShowCropUrl(false);
      const data = parseCropProgress(text);
      setCD2({corn:data.corn, soy:data.soy});
      if(data.date) setCD(data.date);
      setSt(p=>({...p,crop:`✓ Atualizado · ${data.date}`}));
    } catch(e) {
      setSt(p=>({...p,crop:`✗ ${e.message}`}));
    } finally {
      setLd(p=>({...p,crop:false}));
    }
  },[]);


  const fetchSales = useCallback(async () => {
    setLd(p=>({...p,sales:true})); setSt(p=>({...p,sales:"Buscando..."}));
    try {
      const res  = await fetch("/api/proxy-sales");
      const text = await res.text();
      if (!res.ok) throw new Error(text.split("\n")[0]);
      const data = parseSales(text);
      setSalesData({corn:data.corn, soy:data.soy});
      if (data.date) setSalesDate(data.date);
      setSt(p=>({...p,sales:`✓ Atualizado · ${data.date}`}));
    } catch(e) {
      setSt(p=>({...p,sales:`✗ ${e.message}`}));
    } finally {
      setLd(p=>({...p,sales:false}));
    }
  },[]);

  const today = new Date().toLocaleDateString("pt-BR");

  const BtnFetch = ({onClick,loading,status,label}) => (
    <div>
      <button onClick={onClick} disabled={loading} style={{
        background:loading?"transparent":G.gold, border:`1px solid ${G.gold}`,
        borderRadius:2, color:loading?G.gold:G.darkGreen,
        fontFamily:"'Cinzel',serif", fontSize:10, letterSpacing:"0.12em",
        padding:"8px 16px", cursor:loading?"wait":"pointer", fontWeight:"bold",
        transition:"all 0.2s",
      }}>
        {loading ? "⏳ Buscando..." : `⬇ ${label}`}
      </button>
      {status && (
        <div style={{fontSize:10,marginTop:4,fontFamily:"monospace",
          color:status.startsWith("✓")?G.gold:status.startsWith("✗")?"#eb5757":G.cream+"88"}}>
          {status}
        </div>
      )}
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:`linear-gradient(170deg,${G.darkGreen},${G.midGreen} 60%,${G.darkGreen})`,color:G.cream}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        input::placeholder{color:#333}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:${G.darkGreen}}
        ::-webkit-scrollbar-thumb{background:${G.goldDark};border-radius:2px}
      `}</style>

      {/* Header */}
      <div style={{borderBottom:`1px solid ${G.goldDark}88`,
        background:`linear-gradient(90deg,${G.darkGreen},${G.slateGreen}44,${G.darkGreen})`,
        padding:"14px 26px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <img src={LOGO} style={{height:48,objectFit:"contain"}} alt="Granara"/>
          <div>
            <div style={{fontSize:8,color:G.gold,fontFamily:"'Cinzel',serif",letterSpacing:"0.2em"}}>1889 · O AGRO MAIS INTELIGENTE E SEGURO</div>
            <div style={{fontSize:20,fontFamily:"'Cinzel',serif",fontWeight:700,letterSpacing:"0.15em",color:G.cream}}>PAINEL DE SEGUNDA-FEIRA</div>
            <div style={{fontSize:9,color:G.goldDark,letterSpacing:"0.08em"}}>FONTE: USDA · {today}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          {/* Brand Toggle */}
          <div style={{
            display:"flex", background:"rgba(0,0,0,0.3)",
            border:`1px solid ${G.goldDark}`, borderRadius:3, overflow:"hidden", marginRight:4,
          }}>
            {["granara","getreide"].map(b => (
              <button key={b} onClick={()=>setBrandId(b)} style={{
                background: brandId===b ? G.gold : "transparent",
                border:"none", cursor:"pointer",
                color: brandId===b ? G.darkGreen : G.cream+"88",
                fontFamily:"'Cinzel',serif", fontSize:9, letterSpacing:"0.1em",
                padding:"5px 12px", fontWeight: brandId===b ? "bold" : "normal",
                transition:"all 0.2s",
              }}>{b.toUpperCase()}</button>
            ))}
          </div>
          <a href="https://www.ams.usda.gov/mnreports/wa_gr101.txt" target="_blank" rel="noreferrer"
            style={{fontSize:9,color:G.gold,textDecoration:"none",border:`1px solid ${G.goldDark}`,
              borderRadius:2,padding:"5px 10px",fontFamily:"'Cinzel',serif",letterSpacing:"0.1em"}}>
            ↗ AMS USDA
          </a>
          <a href="https://esmis.nal.usda.gov/publication/crop-progress" target="_blank" rel="noreferrer"
            style={{fontSize:9,color:G.gold,textDecoration:"none",border:`1px solid ${G.goldDark}`,
              borderRadius:2,padding:"5px 10px",fontFamily:"'Cinzel',serif",letterSpacing:"0.1em"}}>
            ↗ CROP PROGRESS
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",borderBottom:`1px solid ${G.goldDark}44`,padding:"0 26px"}}>
        {[["export","📦  INSPEÇÕES · SEGUNDA"],["quinta","📊  VENDAS E EMBARQUES · QUINTA"],["crop","🌿  PROGRESSO DAS LAVOURAS"],["wasde","📋  OFERTA E DEMANDA · WASDE"],["share","🖼  EXPORTAR CARDS"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)} style={{
            background:"none",border:"none",cursor:"pointer",
            fontFamily:"'Cinzel',serif",fontSize:11,letterSpacing:"0.12em",
            color:tab===id?G.gold:G.cream+"44",
            borderBottom:tab===id?`2px solid ${G.gold}`:"2px solid transparent",
            padding:"11px 16px",transition:"all 0.2s",
          }}>{lbl}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{padding:"20px 26px 60px",maxWidth:1300,margin:"0 auto"}}>

        {tab==="export" && (
          <div>
            <div style={{display:"flex",gap:14,alignItems:"flex-end",marginBottom:18,flexWrap:"wrap"}}>
              <BtnFetch onClick={fetchAMS} loading={loading.ams} status={status.ams} label="CARREGAR DADOS AMS" />
              <div style={{display:"flex",flexDirection:"column",gap:3}}>
                <div style={{fontSize:9,color:G.gold,fontFamily:"'Cinzel',serif",letterSpacing:"0.1em"}}>DATA DO RELATÓRIO</div>
                <input value={reportDate} onChange={e=>setRD(e.target.value)} placeholder="Ex: MAR 26, 2026"
                  style={{background:"rgba(0,0,0,0.3)",border:`1px solid ${G.goldDark}`,borderRadius:2,
                    padding:"7px 12px",color:"#ffffff",fontFamily:"monospace",fontSize:12}}/>
              </div>
            </div>
            <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
              <ExportCard label="MILHO" icon={ICON_CORN} data={exportData.corn} onUpdate={(f,v)=>upExp("corn",f,v)} reportDate={reportDate}/>
              <ExportCard label="SOJA"  icon={ICON_SOY}  data={exportData.soy}  onUpdate={(f,v)=>upExp("soy",f,v)}  reportDate={reportDate}/>
            </div>
          </div>
        )}


        {tab==="quinta" && (
          <div>
            <div style={{display:"flex",gap:14,alignItems:"flex-end",marginBottom:18,flexWrap:"wrap"}}>
              <BtnFetch onClick={fetchSales} loading={loading.sales} status={status.sales} label="CARREGAR VENDAS FAS" />
              <div style={{display:"flex",flexDirection:"column",gap:3}}>
                <div style={{fontSize:9,color:G.gold,fontFamily:"'Cinzel',serif",letterSpacing:"0.1em"}}>DATA DO RELATÓRIO</div>
                <input value={salesDate} onChange={e=>setSalesDate(e.target.value)} placeholder="Ex: 04/09/2026"
                  style={{background:"rgba(0,0,0,0.3)",border:`1px solid ${G.goldDark}`,borderRadius:2,
                    padding:"7px 12px",color:"#ffffff",fontFamily:"monospace",fontSize:12}}/>
              </div>
            </div>
            <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
              <SalesCardExport label="MILHO" icon={ICON_CORN} data={salesData.corn} salesDate={salesDate}
                logo={cardLogo} logoFooter={cardLogoFooter} brand={T} />
              <SalesCardExport label="SOJA"  icon={ICON_SOY}  data={salesData.soy}  salesDate={salesDate}
                logo={cardLogo} logoFooter={cardLogoFooter} brand={T} />
            </div>
          </div>
        )}

        {tab==="share" && (
          <ExportTab exportData={exportData} cropData={cropData} reportDate={reportDate} cropDate={cropDate} salesData={salesData} salesDate={salesDate} brand={brand} />
        )}

        {tab==="wasde" && (
          <WasdeTab brand={brand} />
        )}

        {tab==="crop" && (
          <div>
            <div style={{display:"flex",gap:14,alignItems:"flex-end",marginBottom:18,flexWrap:"wrap"}}>
              <BtnFetch onClick={()=>fetchCrop()} loading={loading.crop} status={status.crop} label="CARREGAR CROP PROGRESS" />
              <div style={{display:"flex",flexDirection:"column",gap:3}}>
                <div style={{fontSize:9,color:G.gold,fontFamily:"'Cinzel',serif",letterSpacing:"0.1em"}}>DATA DO RELATÓRIO</div>
                <input value={cropDate} onChange={e=>setCD(e.target.value)} placeholder="Ex: April 20, 2026"
                  style={{background:"rgba(0,0,0,0.3)",border:`1px solid ${G.goldDark}`,borderRadius:2,
                    padding:"7px 12px",color:"#ffffff",fontFamily:"monospace",fontSize:12}}/>
              </div>
            </div>
            {showCropUrl && (
              <div style={{display:"flex",gap:8,alignItems:"flex-end",marginBottom:14,
                background:`${G.midGreen}88`,border:`1px solid ${G.goldDark}`,borderRadius:4,padding:"10px 14px"}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:9,color:G.gold,fontFamily:"'Cinzel',serif",letterSpacing:"0.1em",marginBottom:4}}>
                    COLE O LINK DO .TXT DO ESMIS
                  </div>
                  <input value={cropManualUrl} onChange={e=>setCropManualUrl(e.target.value)}
                    placeholder="https://esmis.nal.usda.gov/sites/default/release-files/.../prog1626.txt"
                    style={{width:"100%",background:"rgba(0,0,0,0.3)",border:`1px solid ${G.gold}`,borderRadius:2,
                      padding:"7px 12px",color:"#ffffff",fontFamily:"monospace",fontSize:11,boxSizing:"border-box"}}/>
                </div>
                <button onClick={()=>fetchCrop(cropManualUrl)} disabled={!cropManualUrl||loading.crop}
                  style={{background:G.gold,border:"none",borderRadius:2,color:G.darkGreen,
                    fontFamily:"'Cinzel',serif",fontSize:10,letterSpacing:"0.1em",
                    padding:"8px 14px",cursor:"pointer",fontWeight:"bold",whiteSpace:"nowrap"}}>
                  ⬇ BUSCAR
                </button>
              </div>
            )}
            <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
              <CropCard label="MILHO" icon={ICON_CORN} isSoy={false} data={cropData.corn} onUpdate={(s,f,v)=>upCrop("corn",s,f,v)} cropDate={cropDate}/>
              <CropCard label="SOJA"  icon={ICON_SOY}  isSoy={true}  data={cropData.soy}  onUpdate={(s,f,v)=>upCrop("soy",s,f,v)}  cropDate={cropDate}/>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
