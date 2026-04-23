import { useState, useCallback, useRef } from "react";

// ── Brand Assets (embedded) ───────────────────────────────────────────────────
const LOGO             = "/logos/shield-green.png";
const LOGO_SHIELD_GOLD = "/logos/shield-gold.png";
const LOGO_WORDMARK    = "/logos/wordmark-gold.png";
const ICON_CORN        = "/logos/icon-corn.png";
const ICON_SOY         = "/logos/icon-soy.png";

// ── Brand Colors ──────────────────────────────────────────────────────────────
const G = {
  darkGreen: "#002621", midGreen: "#013A34", slateGreen: "#2F3F3C",
  cream: "#EFE8D8", gold: "#AF965D", goldDark: "#65562E",
};

// ── Parsers ───────────────────────────────────────────────────────────────────
function parseAMS(text) {
  // Find the main summary table and extract CORN and SOYBEANS rows
  const lines = text.split("\n").map(l => l.replace(/\r/g, ""));
  let result = { corn: {}, soy: {}, reportDate: "", weekEnding: "" };

  // Extract week ending date from header
  const weekMatch = text.match(/REPORTED IN WEEK ENDING\s+(\w+\s+\d+,?\s*\d+)/i);
  if (weekMatch) result.weekEnding = weekMatch[1].trim();

  // Find the date line for report date
  const dateMatch = text.match(/Washington.*?\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\w+\s+\d+,\s*\d+)/i);
  if (dateMatch) result.reportDate = dateMatch[2];

  // Parse the main grain table
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // CORN row: CORN  1,789,524   1,702,651   1,718,304   46,372,846   34,071,068
    const cornMatch = line.match(/^CORN\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/i) || line.match(/CORN\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/);
    if (cornMatch) {
      result.corn = {
        semanaAtual:   cornMatch[1].replace(/,/g, ""),
        semanaAnterior:cornMatch[2].replace(/,/g, ""),
        anoAnterior:   cornMatch[3].replace(/,/g, ""),
        acumulado2526: cornMatch[4].replace(/,/g, ""),
        acumulado2425: cornMatch[5].replace(/,/g, ""),
      };
    }
    // SOYBEANS row
    const soyMatch = line.match(/^SOYBEANS\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/i) || line.match(/SOYBEANS\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/);
    if (soyMatch) {
      result.soy = {
        semanaAtual:   soyMatch[1].replace(/,/g, ""),
        semanaAnterior:soyMatch[2].replace(/,/g, ""),
        anoAnterior:   soyMatch[3].replace(/,/g, ""),
        acumulado2526: soyMatch[4].replace(/,/g, ""),
        acumulado2425: soyMatch[5].replace(/,/g, ""),
      };
    }
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
          <Row label="Pendente"       value={exp&&acum?fmtBR(pend):"—"} bold />
          <Row label="Sem. Restantes" value={data.semanas||"—"} />
          <Row label="Sem. Esperado"  value={exp&&acum&&sem?fmtBR(semEsp):"—"} bold accent />
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
function CardShellExport({ children, logo, logoFooter }) {
  return (
    <div style={{
      background:"#002621",
      width:520,
      fontFamily:"'Helvetica Neue',Arial,sans-serif",
      borderRadius:6,
      overflow:"hidden",
      boxShadow:"0 4px 24px rgba(0,0,0,0.5)",
    }}>
      {/* logo header */}
      <div style={{
        background:"linear-gradient(90deg,#001a17 0%,#013A34 100%)",
        borderBottom:"2px solid #AF965D",
        padding:"12px 20px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        <img src={logo} style={{height:56, objectFit:"contain", filter:"drop-shadow(0 2px 6px rgba(0,0,0,0.5))"}} alt="Granara" />
        <div style={{fontSize:8, color:"#AF965D88", letterSpacing:"0.2em"}}>FONTE: USDA</div>
      </div>

      {children}

      {/* logo footer */}
      <div style={{
        background:"#001a17",
        borderTop:"1px solid #65562E44",
        padding:"8px 20px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        <span style={{fontSize:9, color:"#65562E", letterSpacing:"0.12em", fontStyle:"italic"}}>
          app.gtrd.com.br/relatorios
        </span>
        <img src={logoFooter||LOGO_WORDMARK} style={{height:28, objectFit:"contain"}} alt="Granara" />
      </div>
    </div>
  );
}

function ExportCardExport({ label, icon, data, reportDate, logo, logoFooter }) {
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
        fontSize:10, color: accent ? "#AF965D" : "#b8c8b8",
        letterSpacing:"0.07em", textTransform:"uppercase",
        fontWeight: bold ? "600" : "normal",
      }}>{l}</span>
      <span style={{
        fontSize: bold ? 22 : 15,
        fontFamily:"'Courier New',monospace",
        fontWeight: bold ? "bold" : "normal",
        color: "#ffffff",
      }}>{value}</span>
    </div>
  );

  return (
    <CardShellExport logo={logo} logoFooter={logoFooter}>
      {/* commodity header */}
      <div style={{
        background:"linear-gradient(90deg,#013A34,#002621)",
        padding:"14px 20px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        borderBottom:"1px solid #AF965D44",
      }}>
        <div style={{display:"flex", alignItems:"center", gap:12}}>
          <img src={icon} style={{
            width:36, height:36,
            filter:"invert(1) sepia(1) saturate(2) hue-rotate(5deg)", opacity:.9,
          }} alt={label} />
          <div>
            <div style={{fontSize:22, fontWeight:"bold", letterSpacing:"0.2em", color:"#EFE8D8"}}>{label}</div>
            <div style={{fontSize:9, color:"#AF965D", letterSpacing:"0.15em"}}>EM TONELADAS MÉTRICAS</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:9, color:"#65562E", letterSpacing:"0.1em"}}>RELATÓRIO SEMANAL</div>
          <div style={{fontSize:11, color:"#AF965D", fontWeight:"bold", letterSpacing:"0.1em"}}>ATÉ {reportDate||"—"}</div>
        </div>
      </div>

      {/* body */}
      <div style={{padding:"14px 20px 10px"}}>
        <Row label="Semana Atual"       value={fmtE(data.semanaAtual)}    bold />
        <Row label="Semana Anterior"    value={fmtE(data.semanaAnterior)} />
        {dSem !== null && (
          <div style={{textAlign:"right", fontSize:11, fontFamily:"monospace",
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
          background:"#013A3444", border:"1px solid #AF965D22",
          borderRadius:4, padding:"10px 14px", marginTop:10,
        }}>
          <div style={{fontSize:9, color:"#AF965D", letterSpacing:"0.15em",
            marginBottom:8, borderBottom:"1px solid #AF965D33", paddingBottom:4}}>
            EMBARQUE
          </div>
          {[
            ["Expectativa de Embarque",   data.expectativa ? Number(data.expectativa).toLocaleString("pt-BR") : "—", false],
            ["Embarque Acumulado",         fmtE(data.acumulado2526), false],
            ["Embarque Pendente",          exp&&acum ? fmtE(pend) : "—", true],
            ["Semanas Restantes",          data.semanas||"—", false],
            ["Embarque Semanal Esperado",  exp&&acum&&sem ? Math.round(semEsp).toLocaleString("pt-BR") : "—", true],
          ].map(([l,v,b]) => (
            <div key={l} style={{
              display:"flex", justifyContent:"space-between",
              padding:"4px 0", borderBottom:"1px solid #ffffff08",
            }}>
              <span style={{fontSize:10, color:"#b8c8b8", letterSpacing:"0.05em"}}>{l}</span>
              <span style={{
                fontSize: b ? 13 : 11,
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

function CropCardExport({ label, icon, data, cropDate, logo, logoFooter, isSoy }) {
  const stageLabels = isSoy ? SOY_STAGES_LABELS : CORN_STAGES_LABELS;
  const activeStages = Object.entries(stageLabels).filter(([k]) => data[k]?.atual || data[k]?.anoPassado);

  return (
    <CardShellExport logo={logo} logoFooter={logoFooter}>
      {/* commodity header */}
      <div style={{
        background:"linear-gradient(90deg,#013A34,#002621)",
        padding:"14px 20px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        borderBottom:"1px solid #AF965D44",
      }}>
        <div style={{display:"flex", alignItems:"center", gap:12}}>
          <img src={icon} style={{
            width:36, height:36,
            filter:"invert(1) sepia(1) saturate(2) hue-rotate(5deg)", opacity:.9,
          }} alt={label} />
          <div>
            <div style={{fontSize:22, fontWeight:"bold", letterSpacing:"0.2em", color:"#EFE8D8"}}>{label}</div>
            <div style={{fontSize:9, color:"#AF965D", letterSpacing:"0.15em"}}>PROGRESSO DAS LAVOURAS EUA</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:9, color:"#65562E", letterSpacing:"0.1em"}}>USDA CROP PROGRESS</div>
          <div style={{fontSize:11, color:"#AF965D", fontWeight:"bold", letterSpacing:"0.1em"}}>ATÉ {cropDate||"—"}</div>
        </div>
      </div>

      {/* stages */}
      <div style={{padding:"14px 20px 10px"}}>
        {activeStages.length === 0 && (
          <div style={{color:"#65562E", fontSize:12, textAlign:"center", padding:"24px 0"}}>
            Sem dados carregados
          </div>
        )}
        {activeStages.map(([k, lbl]) => (
          <div key={k} style={{marginBottom:10}}>
            <div style={{
              background:"#013A34", borderLeft:"3px solid #AF965D",
              padding:"4px 10px", marginBottom:6,
            }}>
              <span style={{fontSize:10, color:"#AF965D", letterSpacing:"0.14em", fontWeight:"bold"}}>{lbl}</span>
            </div>
            <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"2px 0", padding:"0 4px"}}>
              {[["Atual", data[k]?.atual], ["Ano Passado", data[k]?.anoPassado],
                ["Sem. Passada", data[k]?.semPassada], ["Média 5 Anos", data[k]?.media5]].map(([l,v])=>(
                <div key={l} style={{display:"flex", justifyContent:"space-between", padding:"3px 8px"}}>
                  <span style={{fontSize:10, color:"#b8c8b8", letterSpacing:"0.05em"}}>{l}</span>
                  <span style={{
                    fontSize: l==="Atual" ? 15 : 12,
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
            background:"#013A3444", border:"1px solid #AF965D22",
            borderRadius:4, padding:"10px 14px", marginTop:6,
          }}>
            <div style={{fontSize:9, color:"#AF965D", letterSpacing:"0.15em",
              marginBottom:8, borderBottom:"1px solid #AF965D33", paddingBottom:4}}>
              CONDIÇÕES
            </div>
            {CONDITIONS.map(c => (
              <div key={c.key} style={{
                display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"5px 0", borderBottom:"1px solid #ffffff08",
              }}>
                <span style={{fontSize:10, color: c.key==="bom"?"#6fcf97": c.key==="ruim"?"#eb5757":"#b8c8b8"}}>
                  {c.label}
                </span>
                <div style={{display:"flex", gap:8, alignItems:"center", fontFamily:"monospace"}}>
                  <span style={{fontSize:10, color:"#aaaaaa"}}>
                    {data[c.key]?.anterior ? data[c.key].anterior+"%" : "—"}
                  </span>
                  <span style={{color:"#65562E"}}>→</span>
                  <span style={{
                    fontSize:14, fontWeight:"bold",
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

// PNG download via canvas — inlines images first to avoid CORS issues
async function downloadCardPNG(elementId, filename) {
  const el = document.getElementById(elementId);
  if (!el) { alert("Elemento não encontrado: " + elementId); return; }

  // Use html2canvas from CDN via script tag injection (avoids ESM import issues)
  if (!window.html2canvas) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const canvas = await window.html2canvas(el, {
    scale: 2,
    backgroundColor: "#002621",
    useCORS: true,
    allowTaint: true,
    logging: false,
  });

  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function ExportTab({ exportData, cropData, reportDate, cropDate, salesData, salesDate }) {
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
        <div style={{fontSize:10, color:"#AF965D", fontFamily:"'Cinzel',serif", letterSpacing:"0.18em"}}>{title}</div>
        <button
          onClick={() => handleDL(id, filename)}
          disabled={dl[id]}
          style={{
            background: dl[id] ? "transparent" : "#AF965D",
            border:"1px solid #AF965D", borderRadius:2,
            color: dl[id] ? "#AF965D" : "#002621",
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
        CARDS PRONTOS PARA COMPARTILHAR · IDENTIDADE GRANARA
      </div>

      <Section title="INSPEÇÕES · MILHO" id="ec-corn" filename={`granara-milho-${date}.png`}>
        <ExportCardExport label="MILHO" icon={ICON_CORN} data={exportData.corn} reportDate={reportDate} logo={LOGO_SHIELD_GOLD} logoFooter={LOGO_WORDMARK} />
      </Section>

      <Section title="INSPEÇÕES · SOJA" id="ec-soy" filename={`granara-soja-${date}.png`}>
        <ExportCardExport label="SOJA" icon={ICON_SOY} data={exportData.soy} reportDate={reportDate} logo={LOGO_SHIELD_GOLD} logoFooter={LOGO_WORDMARK} />
      </Section>

      <Section title="INSPEÇÕES · MILHO + SOJA" id="ec-both" filename={`granara-exportacoes-${date}.png`}>
        <div style={{display:"flex", gap:16}}>
          <ExportCardExport label="MILHO" icon={ICON_CORN} data={exportData.corn} reportDate={reportDate} logo={LOGO_SHIELD_GOLD} logoFooter={LOGO_WORDMARK} />
          <ExportCardExport label="SOJA"  icon={ICON_SOY}  data={exportData.soy}  reportDate={reportDate} logo={LOGO_SHIELD_GOLD} logoFooter={LOGO_WORDMARK} />
        </div>
      </Section>


      <Section title="VENDAS · MILHO" id="sc-corn" filename={`granara-milho-vendas-${salesDate||"sales"}.png`}>
        <SalesCardExport label="MILHO" icon={ICON_CORN} data={salesData.corn} salesDate={salesDate}
          logo={LOGO_SHIELD_GOLD} logoFooter={LOGO_WORDMARK} />
      </Section>

      <Section title="VENDAS · SOJA" id="sc-soy" filename={`granara-soja-vendas-${salesDate||"sales"}.png`}>
        <SalesCardExport label="SOJA" icon={ICON_SOY} data={salesData.soy} salesDate={salesDate}
          logo={LOGO_SHIELD_GOLD} logoFooter={LOGO_WORDMARK} />
      </Section>

      <Section title="VENDAS · MILHO + SOJA" id="sc-both" filename={`granara-vendas-${salesDate||"sales"}.png`}>
        <div style={{display:"flex", gap:16}}>
          <SalesCardExport label="MILHO" icon={ICON_CORN} data={salesData.corn} salesDate={salesDate}
            logo={LOGO_SHIELD_GOLD} logoFooter={LOGO_WORDMARK} />
          <SalesCardExport label="SOJA"  icon={ICON_SOY}  data={salesData.soy}  salesDate={salesDate}
            logo={LOGO_SHIELD_GOLD} logoFooter={LOGO_WORDMARK} />
        </div>
      </Section>

      <Section title="LAVOURAS · MILHO" id="cc-corn" filename={`granara-milho-lavoura-${cdate}.png`}>
        <CropCardExport label="MILHO" icon={ICON_CORN} data={cropData.corn} cropDate={cropDate} logo={LOGO_SHIELD_GOLD} logoFooter={LOGO_WORDMARK} isSoy={false} />
      </Section>

      <Section title="LAVOURAS · SOJA" id="cc-soy" filename={`granara-soja-lavoura-${cdate}.png`}>
        <CropCardExport label="SOJA" icon={ICON_SOY} data={cropData.soy} cropDate={cropDate} logo={LOGO_SHIELD_GOLD} logoFooter={LOGO_WORDMARK} isSoy={true} />
      </Section>

      <Section title="LAVOURAS · MILHO + SOJA" id="cc-both" filename={`granara-lavouras-${cdate}.png`}>
        <div style={{display:"flex", gap:16}}>
          <CropCardExport label="MILHO" icon={ICON_CORN} data={cropData.corn} cropDate={cropDate} logo={LOGO_SHIELD_GOLD} logoFooter={LOGO_WORDMARK} isSoy={false} />
          <CropCardExport label="SOJA"  icon={ICON_SOY}  data={cropData.soy}  cropDate={cropDate} logo={LOGO_SHIELD_GOLD} logoFooter={LOGO_WORDMARK} isSoy={true}  />
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
function SalesCardExport({ label, icon, data, salesDate, logo, logoFooter }) {
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
    <CardShellExport logo={logo} logoFooter={logoFooter}>
      {/* commodity header */}
      <div style={{
        background:"linear-gradient(90deg,#013A34,#002621)",
        padding:"14px 20px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        borderBottom:"1px solid #AF965D44",
      }}>
        <div style={{display:"flex", alignItems:"center", gap:12}}>
          <img src={icon} style={{width:36,height:36,filter:"invert(1) sepia(1) saturate(2) hue-rotate(5deg)",opacity:.9}} alt={label}/>
          <div>
            <div style={{fontSize:22,fontWeight:"bold",letterSpacing:"0.2em",color:"#EFE8D8"}}>{label}</div>
            <div style={{fontSize:9,color:"#AF965D",letterSpacing:"0.15em"}}>EXPORTAÇÕES E VENDAS EUA · EM TONELADAS MÉTRICAS</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:9,color:"#65562E",letterSpacing:"0.1em"}}>RELATÓRIO SEMANAL</div>
          <div style={{fontSize:11,color:"#AF965D",fontWeight:"bold",letterSpacing:"0.1em"}}>ATÉ {salesDate||"—"}</div>
        </div>
      </div>

      <div style={{padding:"14px 20px 10px"}}>
        {/* VENDAS block */}
        <div style={{background:"#013A3444",border:"1px solid #AF965D22",borderRadius:4,padding:"10px 14px",marginBottom:10}}>
          <div style={{fontSize:9,color:"#AF965D",letterSpacing:"0.15em",marginBottom:8,
            borderBottom:"1px solid #AF965D33",paddingBottom:4,fontWeight:"bold"}}>VENDAS</div>
          {[
            ["Vendas da Semana 2025/26",   data.vendasSemana,   false],
            ["Vendas Acumuladas 2025/26",  data.vendasAcum2526, true],
            ["Vendas Acumuladas 2024/25",  data.vendasAcum2425, false],
          ].map(([l,v,b])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #ffffff08"}}>
              <span style={{fontSize:10,color:b?"#AF965D":"#b8c8b8",letterSpacing:"0.05em",fontWeight:b?"bold":"normal"}}>{l}</span>
              <span style={{fontSize:b?14:11,fontFamily:"monospace",fontWeight:b?"bold":"normal",color:"#ffffff"}}>{fmtS(v)}</span>
            </div>
          ))}
          {dVendas!==null&&(
            <div style={{textAlign:"right",fontSize:11,fontFamily:"monospace",color:arrowCol(dVendas),fontWeight:"bold",marginTop:2}}>
              {isPos(dVendas)?"▲":"▼"} {Math.abs(dVendas)}% acumulado
            </div>
          )}
        </div>

        {/* EMBARQUES block */}
        <div style={{background:"#013A3444",border:"1px solid #AF965D22",borderRadius:4,padding:"10px 14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            marginBottom:8,borderBottom:"1px solid #AF965D33",paddingBottom:4}}>
            <div style={{fontSize:9,color:"#AF965D",letterSpacing:"0.15em",fontWeight:"bold"}}>EMBARQUES</div>
            {data.expectativa && (
              <div style={{fontSize:10,color:"#AF965D",fontFamily:"monospace",fontWeight:"bold"}}>
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
              <span style={{fontSize:10,color:b?"#AF965D":"#b8c8b8",letterSpacing:"0.05em",fontWeight:b?"bold":"normal"}}>{l}</span>
              <span style={{fontSize:b?14:11,fontFamily:"monospace",fontWeight:b?"bold":"normal",color:"#ffffff"}}>{fmtS(v)}</span>
            </div>
          ))}
        </div>
      </div>
    </CardShellExport>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]       = useState("export");
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
      const res  = await fetch("/.netlify/functions/proxy-ams");
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
        ? `/.netlify/functions/proxy-crop?url=${encodeURIComponent(manualUrl)}`
        : "/.netlify/functions/proxy-crop";
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
      const res  = await fetch("/.netlify/functions/proxy-sales");
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
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
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
        {[["export","📦  INSPEÇÕES · SEGUNDA"],["quinta","📊  VENDAS E EMBARQUES · QUINTA"],["crop","🌿  PROGRESSO DAS LAVOURAS"],["share","🖼  EXPORTAR CARDS"]].map(([id,lbl])=>(
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
                logo={LOGO_SHIELD_GOLD} logoFooter={LOGO_WORDMARK} />
              <SalesCardExport label="SOJA"  icon={ICON_SOY}  data={salesData.soy}  salesDate={salesDate}
                logo={LOGO_SHIELD_GOLD} logoFooter={LOGO_WORDMARK} />
            </div>
          </div>
        )}

        {tab==="share" && (
          <ExportTab exportData={exportData} cropData={cropData} reportDate={reportDate} cropDate={cropDate} salesData={salesData} salesDate={salesDate} />
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
