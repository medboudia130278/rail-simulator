import { useState, useCallback, useMemo } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

// CONSTANTS

const RAIL_GRADES = {
  R200:   { label: "R200 (~200 BHN)",   f_wear: 1.34, f_rcf: 1.40 },
  R260:   { label: "R260 (~260 BHN)",   f_wear: 1.00, f_rcf: 1.00 },
  R320Cr: { label: "R320Cr (~320 BHN)", f_wear: 0.70, f_rcf: 0.75 },
  R350HT: { label: "R350HT (~350 BHN)", f_wear: 0.50, f_rcf: 0.55 },
  R400HT: { label: "R400HT (~400 BHN)", f_wear: 0.38, f_rcf: 0.40 },
};

const RAIL_TYPES = {
  vignole: { label: "Vignole Rail",       f_v: 1.00, f_l: 1.00 },
  groove:  { label: "Groove Rail (Tram)", f_v: 1.20, f_l: 1.80 },
};

const TRACK_MODES = {
  ballast:  { label: "Ballasted Track",       f_v: 1.00, f_l: 1.00 },
  slab:     { label: "Concrete Slab Track",   f_v: 1.10, f_l: 1.15 },
  embedded: { label: "Embedded Track (Tram)", f_v: 1.15, f_l: 1.20 },
};

const CONTEXTS = {
  tram:  { label: "Tram",        qRef: 10,   baseWearV: 0.82, baseWearL: 1.00, rcfRate: [0.002,0.010,0.018,0.012,0.004] },
  metro: { label: "Metro / LRT", qRef: 15,   baseWearV: 0.82, baseWearL: 1.00, rcfRate: [0.002,0.010,0.016,0.010,0.003] },
  heavy: { label: "Heavy Rail",  qRef: 22.5, baseWearV: 0.82, baseWearL: 1.00, rcfRate: [0.002,0.008,0.014,0.009,0.003] },
};

const BANDS = [
  { id:"r1", label:"R < 100 m",        rMin:0,   rMax:100,   f_v:6.0, f_l:15.0, grind:{ tram:0.5, metro:3,  heavy:999 } },
  { id:"r2", label:"100 to 200 m",     rMin:100, rMax:200,   f_v:4.0, f_l:9.0,  grind:{ tram:1.0, metro:5,  heavy:20  } },
  { id:"r3", label:"200 to 400 m",     rMin:200, rMax:400,   f_v:2.5, f_l:5.0,  grind:{ tram:2.0, metro:8,  heavy:30  } },
  { id:"r4", label:"400 to 800 m",     rMin:400, rMax:800,   f_v:1.5, f_l:2.5,  grind:{ tram:3.5, metro:12, heavy:50  } },
  { id:"r5", label:"R >= 800 m",       rMin:800, rMax:99999, f_v:1.0, f_l:1.0,  grind:{ tram:5.0, metro:20, heavy:80  } },
];

const SPEED_BANDS = [
  { max:40,   f_v:0.90, f_l:1.10 },
  { max:80,   f_v:1.00, f_l:1.00 },
  { max:120,  f_v:1.10, f_l:0.95 },
  { max:160,  f_v:1.20, f_l:0.90 },
  { max:9999, f_v:1.35, f_l:0.85 },
];

const LUBRICATION = {
  none:     { label: "No lubrication",                 f: [1.00,1.00,1.00,1.00,1.00] },
  poor:     { label: "Poor (badly maintained)",        f: [0.80,0.82,0.88,0.95,1.00] },
  standard: { label: "Standard (wayside lubrication)", f: [0.55,0.60,0.72,0.90,1.00] },
  good:     { label: "Good (wayside + onboard)",       f: [0.35,0.40,0.60,0.85,1.00] },
  optimal:  { label: "Optimal (lab conditions only)",  f: [0.10,0.15,0.35,0.75,1.00] },
};

const LIMITS = { tram:{v:7,l:8}, metro:{v:9,l:11}, heavy:{v:12,l:14} };
const RESERVE = { R200:13, R260:15, R320Cr:16, R350HT:17, R400HT:18 };
const RCF_MAX = 0.70;

// ENGINE

function calcMGT(trains) {
  return trains.reduce(function(s,t) {
    return s + (t.trainsPerDay * t.axleLoad * t.bogies * t.axlesPerBogie * 365) / 1e6;
  }, 0);
}

function calcEqMGT(trains, ctx) {
  var qRef = CONTEXTS[ctx].qRef;
  return trains.reduce(function(s,t) {
    var mgt = (t.trainsPerDay * t.axleLoad * t.bogies * t.axlesPerBogie * 365) / 1e6;
    return s + mgt * Math.pow(t.axleLoad / qRef, 3);
  }, 0);
}

function runSim(params) {
  var context = params.context;
  var trains = params.trains;
  var segments = params.segments;
  var strategy = params.strategy;
  var railType = params.railType;
  var trackMode = params.trackMode;
  var speed = params.speed;
  var lubrication = params.lubrication;
  var horizonYears = params.horizonYears;

  var ctx = CONTEXTS[context];
  var rt = RAIL_TYPES[railType];
  var tm = TRACK_MODES[trackMode];
  var sf = SPEED_BANDS.find(function(s) { return speed <= s.max; }) || SPEED_BANDS[4];
  var lubKey = lubrication || "none";
  var mgtPY = calcMGT(trains);
  var eqPY = calcEqMGT(trains, context);
  var limits = LIMITS[context];

  var results = segments.map(function(seg) {
    var rb = BANDS.find(function(b) { return seg.radius >= b.rMin && seg.radius < b.rMax; }) || BANDS[4];
    var rbIdx = BANDS.indexOf(rb);
    var grade = RAIL_GRADES[seg.railGrade] || RAIL_GRADES["R260"];
    var lubF = (LUBRICATION[lubKey] || LUBRICATION.none).f[rbIdx];

    var he = Math.min(1.0 - (1.0 - grade.f_wear) / (1.0 + rb.f_l * 0.3), 1.0);
    var wrV = ctx.baseWearV * rb.f_v * he * rt.f_v * tm.f_v * sf.f_v;
    var wrL = ctx.baseWearL * 1.5 * rb.f_l * he * rt.f_l * tm.f_l * sf.f_l * lubF;
    var rcfBase = ctx.rcfRate[rbIdx] * grade.f_rcf * sf.f_v;

    var gi = rb.grind[context] || 999;
    var gMGT = strategy === "preventive" ? gi : gi * 3.0;
    var resI = railType === "groove" ? 12 : (RESERVE[seg.railGrade] || 15);

    var gp = strategy === "preventive"
      ? { passes:1, rem:0.20, rcfR:0.30, pwf:0.75, pmgt: gi * 0.85 }
      : { passes:4, rem:0.55, rcfR:0.18, pwf:0.92, pmgt: gi * 0.40 };

    // Brownfield initial conditions
    var initWV  = seg.initWearV  || 0;
    var initWL  = seg.initWearL  || 0;
    var initRCF = Math.min(seg.initRCF || 0, 0.99);
    var initMGT = seg.initMGT    || 0;
    var initRes = Math.max(2.1, resI - initWV * 0.8);

    var wV = initWV;
    var wL = initWL;
    var rcf = initRCF;
    var res = initRes;
    var mgtSG = 0;
    var totMGT = initMGT;
    var pgLeft = 0;
    var gCount = 0;
    var repY = null;
    var data = [];

    for (var y = 1; y <= horizonYears; y++) {
      totMGT += mgtPY;
      mgtSG  += mgtPY;

      var wf = pgLeft > 0 ? gp.pwf : 1.0;
      pgLeft = Math.max(0, pgLeft - mgtPY);

      wV += (mgtPY / 100) * wrV * wf;
      wL += (mgtPY / 100) * wrL * wf;

      var wp = Math.min(0.80, wrV * wf / 5.0);
      rcf = Math.min(1.0, rcf + rcfBase * mgtPY * (1.0 - wp));

      var ground = false;
      if (mgtSG >= gMGT && rcf < RCF_MAX && res > 3) {
        var passes = strategy === "corrective" ? Math.max(1, Math.min(gp.passes, Math.ceil(rcf/0.12))) : gp.passes;
        var rem = passes * gp.rem;
        res -= rem;
        rcf  = Math.max(0, rcf - passes * gp.rcfR * (1.0 + (1.0 - rcf) * 0.5));
        wV   = Math.max(0, wV - rem * 0.2);
        pgLeft = gp.pmgt;
        mgtSG  = 0;
        gCount++;
        ground = true;
      }

      var repl = wV >= limits.v || wL >= limits.l || res <= 2 || rcf >= RCF_MAX;
      data.push({
        year:y, mgt:+totMGT.toFixed(2),
        wearV:+Math.min(wV,limits.v).toFixed(3),
        wearL:+Math.min(wL,limits.l).toFixed(3),
        rcf:+Math.min(rcf,1).toFixed(3),
        reserve:+Math.max(res,0).toFixed(2),
        ground:ground?1:0,
        replaced:(repl&&!repY)?1:0,
        lv:limits.v, ll:limits.l,
      });
      if (repl && !repY) { repY = y; break; }
    }

    return { seg:seg, rb:rb, rbIdx:rbIdx, wrV:wrV, wrL:wrL, he:he, mgtPY:mgtPY, eqPY:eqPY, gCount:gCount, repY:repY, data:data, limits:limits };
  });

  return { results:results, mgtPY:mgtPY, eqPY:eqPY };
}

// UI HELPERS

var cl = {
  teal:"#7dd3c8", text:"#c8ddd9", dim:"#6bb5af", muted:"#8899aa",
  warn:"#f87171", amber:"#fbbf24", green:"#4ade80", purple:"#a78bfa",
  dark:"#0a1a22",
};

var inputStyle = {
  background:"rgba(255,255,255,0.06)",
  border:"1px solid rgba(255,255,255,0.12)",
  borderRadius:6, color:"#e8f4f3", padding:"7px 10px",
  fontSize:13, width:"100%", outline:"none",
  fontFamily:"monospace", boxSizing:"border-box",
};

function Lbl(props) {
  return (
    <div style={{fontSize:11,color:cl.muted,marginBottom:4,fontWeight:500}}>
      {props.children}
    </div>
  );
}

function Inp(props) {
  var type = props.type || "number";
  return (
    <input
      type={type}
      value={props.value}
      placeholder={props.ph || ""}
      onChange={function(e) { props.onChange(type === "number" ? +e.target.value : e.target.value); }}
      min={props.min} max={props.max} step={props.step || 1}
      style={inputStyle}
    />
  );
}

function Sel(props) {
  return (
    <select
      value={props.value}
      onChange={function(e) { props.onChange(e.target.value); }}
      style={{background:"#1a2830",border:"1px solid rgba(255,255,255,0.12)",borderRadius:6,color:"#e8f4f3",padding:"7px 10px",fontSize:13,width:"100%",outline:"none",cursor:"pointer"}}
    >
      {props.opts.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option>; })}
    </select>
  );
}

function Btn(props) {
  return (
    <button
      onClick={props.onClick}
      style={{
        background:props.active?cl.teal:"rgba(255,255,255,0.06)",
        color:props.active?"#0d1f26":cl.text,
        border:"1px solid " + (props.active?cl.teal:"rgba(255,255,255,0.15)"),
        borderRadius:6, padding:props.sm?"5px 12px":"8px 18px",
        fontSize:props.sm?12:13, fontWeight:600, cursor:"pointer",
      }}
    >
      {props.children}
    </button>
  );
}

function Card(props) {
  return (
    <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:"18px 20px",marginBottom:16}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:3,color:cl.teal,textTransform:"uppercase",marginBottom:14}}>
        {props.title}
      </div>
      {props.children}
    </div>
  );
}

function Kpi(props) {
  var col = props.warn ? cl.warn : cl.teal;
  var bg  = props.warn ? "rgba(248,113,113,0.08)" : "rgba(125,211,200,0.05)";
  var brd = props.warn ? "rgba(248,113,113,0.25)" : "rgba(125,211,200,0.15)";
  return (
    <div style={{background:bg,border:"1px solid "+brd,borderRadius:8,padding:"10px 14px",flex:1,minWidth:110}}>
      <div style={{fontSize:10,color:props.warn?cl.warn:cl.dim,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>
        {props.label}
      </div>
      <div style={{fontSize:20,fontWeight:700,color:col,fontFamily:"monospace"}}>
        {props.value}
        <span style={{fontSize:11,fontWeight:400,marginLeft:4,color:cl.muted}}>{props.unit}</span>
      </div>
    </div>
  );
}

function RCFBadge(props) {
  var v = props.v;
  var col = v < 0.3 ? cl.green : v < 0.7 ? cl.amber : cl.warn;
  var lbl = v < 0.3 ? "HEALTHY" : v < 0.7 ? "MODERATE" : "CRITICAL";
  return (
    <span style={{background:col+"22",color:col,border:"1px solid "+col+"55",borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700}}>
      {lbl}
    </span>
  );
}

function ChartTip(props) {
  if (!props.active || !props.payload || !props.payload.length) return null;
  return (
    <div style={{background:"#0d1f26",border:"1px solid rgba(125,211,200,0.25)",borderRadius:8,padding:"10px 14px",fontSize:12}}>
      <div style={{color:cl.teal,marginBottom:6,fontWeight:700}}>Year {props.label}</div>
      {props.payload.map(function(p) {
        return (
          <div key={p.name} style={{color:p.color,marginBottom:2}}>
            {p.name}: <b>{typeof p.value === "number" ? p.value.toFixed(3) : p.value}</b>
          </div>
        );
      })}
    </div>
  );
}

// VALIDATION DATA

var REF = [
  { id:"BE1", source:"Infrabel/TU Delft 2023", ctx:"heavy", desc:"Heavy rail - tangent - R260", r:9999, grade:"R260", mgt:25, wV:0.82, wL:null,  note:"Big-data, 5338 km, 2012-2019" },
  { id:"BE2", source:"Infrabel/TU Delft 2023", ctx:"heavy", desc:"Heavy rail - R500m - R260",   r:500,  grade:"R260", mgt:25, wV:1.40, wL:2.80,  note:"Outer rail, preventive grinding since 2016" },
  { id:"BE3", source:"Infrabel/TU Delft 2023", ctx:"heavy", desc:"Heavy rail - tangent - R200", r:9999, grade:"R200", mgt:25, wV:1.10, wL:null,  note:"R200 = +34% wear vs R260 on tangent" },
  { id:"GZ1", source:"ScienceDirect Wear 2021",ctx:"metro", desc:"Guangzhou Metro - R300m",     r:300,  grade:"R260", mgt:15, wV:2.10, wL:6.50,  note:"Outer rail, Line 1, 12 curves R300" },
  { id:"GZ2", source:"Railway Sciences 2022",  ctx:"heavy", desc:"EMU depot - R350m ~30km/h",   r:350,  grade:"R260", mgt:5,  wV:null, wL:null,
    incomparable:true, rawWearL:10.1,
    note:"Unit mismatch: 10.1mm lateral is absolute after 1M passes, not mm/100MGT. Cannot compare without gross tonnage per pass." },
];

function getRefPred(ref, gp) {
  if (!gp || ref.incomparable) return null;
  var rType = gp.railType || "vignole";
  var tMode = gp.trackMode || "ballast";
  var spd   = gp.speed    || 80;
  var lubr  = gp.lubrication || "none";
  var strat = gp.strategy || "preventive";
  var grossTons = (ref.mgt * 1e6) / 365;
  var axleLoad  = Math.max(5, Math.min(35, grossTons / 4));
  var trains = [{ id:"s", label:"s", trainsPerDay:1, axleLoad:axleLoad, bogies:2, axlesPerBogie:2 }];
  var segs   = [{ id:"s", label:ref.desc, radius: ref.r >= 9999 ? 9000 : ref.r, railGrade:ref.grade }];
  try {
    var res = runSim({ context:ref.ctx, trains:trains, segments:segs, strategy:strat, railType:rType, trackMode:tMode, speed:spd, lubrication:lubr, horizonYears:1 });
    var seg = res && res.results && res.results[0];
    if (!seg) return null;
    return { v:+seg.wrV.toFixed(3), l:+seg.wrL.toFixed(3) };
  } catch(e) { return null; }
}

function devPct(pred, real) {
  if (real == null || pred == null) return null;
  return (((pred - real) / real) * 100).toFixed(1);
}

function devCol(p) {
  var a = Math.abs(+p);
  return a <= 15 ? cl.green : a <= 30 ? cl.amber : cl.warn;
}

function ValidationPanel(props) {
  var context = props.context;
  var gp = props.gp;

  var [userCases, setUserCases] = useState([]);
  var [form, setForm] = useState({label:"",source:"",radius:300,grade:"R260",mgt:15,wV:"",wL:"",note:""});
  var [showForm, setShowForm] = useState(false);

  var cases = useMemo(function() {
    return REF.filter(function(r) { return r.ctx === context; }).concat(userCases);
  }, [context, userCases]);

  var preds = useMemo(function() {
    return cases.map(function(r) {
      return getRefPred(r, gp);
    });
  }, [cases, gp && gp.railType, gp && gp.trackMode, gp && gp.speed, gp && gp.lubrication, gp && gp.strategy]);

  var chartData = cases.map(function(r, i) {
    var p = preds[i];
    if (r.wV == null || p == null) return null;
    return { name:r.id, sim:p.v, real:r.wV };
  }).filter(Boolean);

  function addCase() {
    if (!form.label) return;
    setUserCases(function(u) {
      return u.concat([{
        id:"u"+Date.now(), source:form.source||"User", ctx:context,
        desc:form.label, r:form.radius, grade:form.grade, mgt:form.mgt,
        wV:form.wV!==""?+form.wV:null, wL:form.wL!==""?+form.wL:null,
        note:form.note, isUser:true,
      }]);
    });
    setForm({label:"",source:"",radius:300,grade:"R260",mgt:15,wV:"",wL:"",note:""});
    setShowForm(false);
  }

  return (
    <div style={{maxWidth:1400,margin:"32px auto 0",padding:"0 20px 60px"}}>
      <div style={{borderTop:"1px solid rgba(125,211,200,0.12)",paddingTop:28,marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
        <div>
          <div style={{fontSize:11,letterSpacing:3,color:cl.teal,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>Validation and Calibration</div>
          <div style={{fontSize:18,fontWeight:700,color:"#e8f4f3"}}>Simulator vs Real-World Measurement Data</div>
          <div style={{fontSize:12,color:cl.dim,marginTop:4}}>Sources: Belgian Network (Infrabel/TU Delft 2023), Guangzhou Metro (2021-2022)</div>
          {gp && (
            <div style={{fontSize:11,color:"#4a6a74",marginTop:6,padding:"4px 10px",background:"rgba(125,211,200,0.04)",borderRadius:6,display:"inline-block"}}>
              Predictions use: {RAIL_TYPES[gp.railType] && RAIL_TYPES[gp.railType].label} / {TRACK_MODES[gp.trackMode] && TRACK_MODES[gp.trackMode].label} / {gp.speed} km/h / {gp.strategy}
            </div>
          )}
        </div>
        <Btn onClick={function() { setShowForm(function(v) { return !v; }); }} sm={true} active={showForm}>
          {showForm ? "Cancel" : "+ Add real measurement"}
        </Btn>
      </div>

      {showForm && (
        <div style={{background:"rgba(125,211,200,0.04)",border:"1px solid rgba(125,211,200,0.2)",borderRadius:10,padding:20,marginBottom:20}}>
          <div style={{fontSize:12,color:cl.teal,fontWeight:700,marginBottom:12}}>ADD REAL MEASUREMENT</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
            <div><Lbl>Label</Lbl><Inp value={form.label} onChange={function(v){setForm(function(f){return {...f,label:v};});}} type="text" ph="e.g. Line 2 curve"/></div>
            <div><Lbl>Source</Lbl><Inp value={form.source} onChange={function(v){setForm(function(f){return {...f,source:v};});}} type="text" ph="e.g. Project name"/></div>
            <div><Lbl>Radius (m)</Lbl><Inp value={form.radius} onChange={function(v){setForm(function(f){return {...f,radius:v};});}} min={50}/></div>
            <div><Lbl>Rail grade</Lbl><Sel value={form.grade} onChange={function(v){setForm(function(f){return {...f,grade:v};});}} opts={Object.keys(RAIL_GRADES).map(function(k){return {v:k,l:k};})}/></div>
            <div><Lbl>MGT/yr</Lbl><Inp value={form.mgt} onChange={function(v){setForm(function(f){return {...f,mgt:v};});}} min={0.1} step={0.5}/></div>
            <div><Lbl>Vertical wear (mm/100MGT)</Lbl><input value={form.wV} onChange={function(e){setForm(function(f){return {...f,wV:e.target.value};});}} type="number" step="0.01" placeholder="e.g. 1.2" style={inputStyle}/></div>
            <div><Lbl>Lateral wear (mm/100MGT)</Lbl><input value={form.wL} onChange={function(e){setForm(function(f){return {...f,wL:e.target.value};});}} type="number" step="0.01" placeholder="e.g. 4.5" style={inputStyle}/></div>
            <div><Lbl>Notes</Lbl><Inp value={form.note} onChange={function(v){setForm(function(f){return {...f,note:v};});}} type="text" ph="conditions, method..."/></div>
          </div>
          <Btn onClick={addCase} active={true} sm={true}>Add measurement</Btn>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:20}}>
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:12,padding:20,border:"1px solid rgba(125,211,200,0.1)"}}>
          <div style={{fontSize:11,color:cl.teal,letterSpacing:2,textTransform:"uppercase",fontWeight:700,marginBottom:14}}>Vertical Wear - Simulator vs Measured (mm/100MGT)</div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} layout="vertical" margin={{left:10,right:20}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                <XAxis type="number" stroke="#4a6a74" tick={{fontSize:10}} unit=" mm"/>
                <YAxis type="category" dataKey="name" stroke="#4a6a74" tick={{fontSize:10}} width={80}/>
                <Tooltip content={<ChartTip/>}/>
                <Legend wrapperStyle={{fontSize:11}}/>
                <Bar dataKey="real" name="Measured" fill={cl.amber} opacity={0.85} radius={[0,3,3,0]}/>
                <Bar dataKey="sim"  name="Simulator" fill={cl.teal}  opacity={0.85} radius={[0,3,3,0]}/>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{textAlign:"center",color:"#4a6a74",padding:"40px 0",fontSize:13}}>No data for this context</div>
          )}
        </div>

        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:12,padding:20,border:"1px solid rgba(125,211,200,0.1)"}}>
          <div style={{fontSize:11,color:cl.teal,letterSpacing:2,textTransform:"uppercase",fontWeight:700,marginBottom:14}}>Deviation - Simulator vs Field</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {chartData.map(function(d) {
              var ep = devPct(d.sim, d.real);
              if (ep == null) return null;
              var col = devCol(ep);
              return (
                <div key={d.name}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
                    <span style={{color:cl.text}}>{d.name}</span>
                    <span style={{color:col,fontFamily:"monospace",fontWeight:700}}>{+ep>0?"+":""}{ep}%</span>
                  </div>
                  <div style={{height:5,background:"rgba(255,255,255,0.06)",borderRadius:3}}>
                    <div style={{height:"100%",width:Math.min(100,Math.abs(+ep))+"%",background:col,borderRadius:3}}/>
                  </div>
                </div>
              );
            })}
            <div style={{marginTop:6,fontSize:11,color:cl.dim,borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:8}}>
              Green &lt;15% good / Yellow 15-30% acceptable / Red &gt;30% recalibrate
            </div>
          </div>
        </div>
      </div>

      <div style={{background:"rgba(0,0,0,0.15)",borderRadius:12,border:"1px solid rgba(125,211,200,0.08)",overflow:"hidden"}}>
        <div style={{padding:"12px 18px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",justifyContent:"space-between"}}>
          <div style={{fontSize:11,letterSpacing:2,color:cl.teal,textTransform:"uppercase",fontWeight:700}}>Reference Cases</div>
          <div style={{fontSize:11,color:cl.dim}}>{cases.length} cases loaded</div>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:"rgba(255,255,255,0.03)"}}>
                {["Source","Description","Radius","Grade","MGT/yr","V.Wear Real","V.Wear Sim.","Dev.V","L.Wear Real","L.Wear Sim.","Dev.L","Notes"].map(function(h) {
                  return <th key={h} style={{padding:"8px 12px",textAlign:"left",color:cl.dim,fontWeight:600,whiteSpace:"nowrap",fontSize:11}}>{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {cases.map(function(r, i) {
                var p  = preds[i];
                var eV = r.incomparable ? null : devPct(p && p.v, r.wV);
                var eL = r.incomparable ? null : devPct(p && p.l, r.wL);
                return (
                  <tr key={r.id} style={{borderTop:"1px solid rgba(255,255,255,0.04)",background:r.isUser?"rgba(125,211,200,0.04)":r.incomparable?"rgba(251,191,36,0.03)":"transparent"}}>
                    <td style={{padding:"8px 12px",color:r.isUser?cl.teal:r.incomparable?cl.amber:cl.muted,fontSize:11}}>{r.isUser?"U ":r.incomparable?"! ":"R "}{r.source}</td>
                    <td style={{padding:"8px 12px",color:cl.text,fontSize:11}}>{r.desc}</td>
                    <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{r.r>=9999?"tangent":r.r+"m"}</td>
                    <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.purple}}>{r.grade}</td>
                    <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{r.mgt}</td>
                    <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.amber}}>{r.wV != null ? r.wV : "-"}</td>
                    <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.teal}}>{r.incomparable?"-":(p?p.v:"-")}</td>
                    <td style={{padding:"8px 12px"}}>{eV!=null?<span style={{color:devCol(eV),fontWeight:700}}>{+eV>0?"+":""}{eV}%</span>:"-"}</td>
                    <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.amber}}>{r.incomparable?<span style={{color:cl.amber}}>{r.rawWearL} mm*</span>:(r.wL!=null?r.wL:"-")}</td>
                    <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.teal}}>{r.incomparable?"-":(p?p.l:"-")}</td>
                    <td style={{padding:"8px 12px"}}>{eL!=null?<span style={{color:devCol(eL),fontWeight:700}}>{+eL>0?"+":""}{eL}%</span>:(r.incomparable?<span style={{color:cl.amber,fontSize:10}}>unit mismatch</span>:"-")}</td>
                    <td style={{padding:"8px 12px",color:r.incomparable?cl.amber:cl.muted,fontSize:11}}>{r.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{marginTop:8,fontSize:11,color:cl.amber,padding:"8px 12px",background:"rgba(251,191,36,0.05)",borderRadius:6,border:"1px solid rgba(251,191,36,0.15)"}}>
        * Cases marked with ! cannot be compared: absolute wear value, not a rate. Divide by accumulated MGT to convert.
      </div>
    </div>
  );
}

// HELP MODAL

var HELP = [
  { id:"overview", title:"Overview",      body:"This simulator estimates rail wear, grinding cycles, and replacement timelines for tram, metro/LRT, and heavy rail. Based on Archard wear model, Eisenmann dynamic load formula, and real-world data from Infrabel/TU Delft (2023) and Guangzhou Metro (2021). Each radius band segment is simulated independently." },
  { id:"mgt",      title:"MGT Calculation", body:"MGT = (Passes/day x axle load x bogies x axles/bogie x 365) / 1,000,000. Equivalent MGT applies the cube law: MGT_eq = MGT x (Q_axle / Q_ref)^3. A 20t axle causes ~8x more damage than a 10t axle. Ref axle loads: tram=10t, metro=15t, heavy=22.5t." },
  { id:"wear",     title:"Wear Rate Model", body:"Base vertical wear rate: 0.82 mm/100MGT (R260, tangent) from Infrabel/TU Delft 2023 big-data study of 5338 km. Hardness effect is capped in tight curves because lateral contact forces dominate. R350HT saves ~38% wear on tangent but only ~14% on R150m curves." },
  { id:"rcf",      title:"RCF - Rolling Contact Fatigue", body:"Moderate curves (R400-800m) have HIGHER RCF than tight curves. This is the magic wear rate paradox: tight curves wear fast enough to remove surface cracks before they propagate. RCF index: Green<0.3 (preventive grinding effective), Orange 0.3-0.7 (corrective needed), Red>=0.7 (replacement)." },
  { id:"grind",    title:"Grinding Strategy", body:"Preventive: short intervals, 1 light pass (0.20mm), RCF kept low, restored profile means lower future wear rate and maximum rail life (400-600 MGT typical). Corrective: 3x longer intervals, up to 4 heavy passes (0.55mm each), RCF rises high before intervention, shorter rail life (200-350 MGT)." },
  { id:"lubr",     title:"Flange Lubrication", body:"Lubrication only reduces LATERAL wear, no effect on vertical crown wear. Effectiveness is highest on tight curves and zero on tangent track. Standard wayside lubrication reduces lateral wear by 28-45% on curves under 200m. Optimal level (lab conditions) is unrealistic in revenue service." },
  { id:"brown",    title:"Brownfield Mode", body:"Enable Brownfield mode to set initial rail condition for existing projects. Input measured vertical wear, lateral wear, RCF index, and already accumulated MGT for each segment. The simulation starts from these values and computes remaining service life." },
  { id:"repl",     title:"Replacement Criteria", body:"Replacement triggered when ANY condition is met: vertical wear >= limit (tram 7mm, metro 9mm, heavy 12mm); lateral wear >= limit (tram 8mm, metro 11mm, heavy 14mm); metal reserve <= 2mm; RCF index >= 0.70 (cracks too deep for grinding). Source: EN 13674-1, UIC 714R." },
];

function HelpModal(props) {
  var [tab, setTab] = useState("overview");
  var sec = HELP.find(function(h) { return h.id === tab; });
  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>
      <div style={{background:"linear-gradient(160deg,#0d1f2a,#0a1820)",border:"1px solid rgba(125,211,200,0.2)",borderRadius:16,width:"100%",maxWidth:860,maxHeight:"80vh",display:"flex",flexDirection:"column",boxShadow:"0 32px 80px rgba(0,0,0,0.6)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 24px",borderBottom:"1px solid rgba(125,211,200,0.12)",flexShrink:0}}>
          <div>
            <div style={{fontSize:10,letterSpacing:3,color:cl.teal,fontWeight:700,textTransform:"uppercase"}}>Rail Wear Simulator</div>
            <div style={{fontSize:18,fontWeight:800,color:"#e8f4f3"}}>Documentation and Methodology</div>
          </div>
          <button onClick={props.onClose} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,color:cl.text,cursor:"pointer",width:34,height:34,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>x</button>
        </div>
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>
          <div style={{width:180,flexShrink:0,borderRight:"1px solid rgba(125,211,200,0.08)",padding:"12px 8px",overflowY:"auto"}}>
            {HELP.map(function(h) {
              return (
                <div key={h.id} onClick={function(){setTab(h.id);}} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,cursor:"pointer",background:tab===h.id?"rgba(125,211,200,0.1)":"transparent",borderLeft:"3px solid "+(tab===h.id?cl.teal:"transparent"),marginBottom:3}}>
                  <span style={{fontSize:11,color:tab===h.id?"#e8f4f3":cl.dim,fontWeight:tab===h.id?600:400,lineHeight:1.3}}>{h.title}</span>
                </div>
              );
            })}
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"24px 28px"}}>
            <div style={{fontSize:22,fontWeight:700,color:"#e8f4f3",marginBottom:16}}>{sec && sec.title}</div>
            <p style={{fontSize:13,color:"#a0bfbb",lineHeight:1.9}}>{sec && sec.body}</p>
          </div>
        </div>
        <div style={{padding:"12px 24px",borderTop:"1px solid rgba(125,211,200,0.08)",fontSize:11,color:"#3a5a64",display:"flex",justifyContent:"space-between",flexShrink:0}}>
          <span>v1.1 - EN 13674 / UIC 714 / Infrabel/TU Delft 2023 / Guangzhou Metro 2021</span>
          <span style={{color:cl.dim,cursor:"pointer"}} onClick={props.onClose}>Close</span>
        </div>
      </div>
    </div>
  );
}

// MAIN APP

export default function App() {
  var [context,     setCon]  = useState("metro");
  var [trains,      setTr]   = useState([{id:1,label:"Type A",trainsPerDay:200,axleLoad:14,bogies:4,axlesPerBogie:2}]);
  var [segs,        setSegs] = useState([
    {id:"r1",label:"R < 100 m",    active:false,lengthKm:0,  grade:"R400HT",repr:75},
    {id:"r2",label:"100 to 200 m", active:false,lengthKm:0,  grade:"R350HT",repr:150},
    {id:"r3",label:"200 to 400 m", active:true, lengthKm:1.5,grade:"R320Cr",repr:300},
    {id:"r4",label:"400 to 800 m", active:true, lengthKm:2.0,grade:"R320Cr",repr:600},
    {id:"r5",label:"R >= 800 m",   active:true, lengthKm:6.5,grade:"R260",  repr:9999},
  ]);
  var [railType,    setRT]   = useState("vignole");
  var [trackMode,   setTM]   = useState("ballast");
  var [speed,       setSp]   = useState(80);
  var [lubr,        setLb]   = useState("none");
  var [strategy,    setSt]   = useState("preventive");
  var [horizon,     setHz]   = useState(30);
  var [isBF,        setBF]   = useState(false);
  var [initCond,    setIC]   = useState({r1:{wearV:0,wearL:0,rcf:0,mgt:0},r2:{wearV:0,wearL:0,rcf:0,mgt:0},r3:{wearV:0,wearL:0,rcf:0,mgt:0},r4:{wearV:0,wearL:0,rcf:0,mgt:0},r5:{wearV:0,wearL:0,rcf:0,mgt:0}});
  var [result,      setRes]  = useState(null);
  var [aidx,        setAi]   = useState(0);
  var [ctab,        setCt]   = useState("wear");
  var [hasRun,      setHR]   = useState(false);
  var [err,         setErr]  = useState(null);
  var [showHelp,    setHelp] = useState(false);

  function addTrain() {
    setTr(function(t) {
      return t.concat([{id:Date.now(),label:"Type "+String.fromCharCode(65+t.length),trainsPerDay:100,axleLoad:14,bogies:4,axlesPerBogie:2}]);
    });
  }
  function delTrain(id) { setTr(function(t){return t.filter(function(x){return x.id!==id;});}); }
  function updTrain(id,f,v) { setTr(function(t){return t.map(function(x){return x.id===id?Object.assign({},x,{[f]:v}):x;});}); }
  function updSeg(id,f,v)   { setSegs(function(s){return s.map(function(x){return x.id===id?Object.assign({},x,{[f]:v}):x;});}); }
  function togSeg(id)       { setSegs(function(s){return s.map(function(x){return x.id===id?Object.assign({},x,{active:!x.active,lengthKm:x.active?0:(x.lengthKm||1.0)}):x;});}); }
  function updIC(id,f,v)    { setIC(function(c){var seg=Object.assign({},c[id],{[f]:v});return Object.assign({},c,{[id]:seg});}); }

  var mgtPrev = useMemo(function(){return calcMGT(trains).toFixed(2);}, [trains]);
  var eqPrev  = useMemo(function(){return calcEqMGT(trains,context).toFixed(2);}, [trains,context]);

  var run = useCallback(function() {
    var active = segs.filter(function(s){return s.active&&s.lengthKm>0;}).map(function(s) {
      var base = Object.assign({}, s, {radius:s.repr, railGrade:s.grade});
      if (isBF && initCond[s.id]) {
        var ic = initCond[s.id];
        base.initWearV = ic.wearV || 0;
        base.initWearL = ic.wearL || 0;
        base.initRCF   = ic.rcf   || 0;
        base.initMGT   = ic.mgt   || 0;
      }
      return base;
    });
    if (active.length === 0) { setErr("Enable at least one radius band with length > 0."); return; }
    try {
      setErr(null);
      var r = runSim({context:context,trains:trains,segments:active,strategy:strategy,railType:railType,trackMode:trackMode,speed:speed,lubrication:lubr,horizonYears:horizon});
      setRes(r); setAi(0); setHR(true);
    } catch(e) { setErr("Simulation error: "+e.message); }
  }, [context,trains,segs,strategy,railType,trackMode,speed,lubr,horizon,isBF,initCond]);

  var asr = result && result.results[aidx];
  var gp = {railType:railType, trackMode:trackMode, speed:speed, lubrication:lubr, strategy:strategy};

  return (
    <div style={{fontFamily:"Segoe UI,sans-serif",background:"linear-gradient(135deg,#0a1a22,#0d2030,#091820)",minHeight:"100vh",color:cl.text}}>

      <div style={{borderBottom:"1px solid rgba(125,211,200,0.12)",padding:"16px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(0,0,0,0.2)",position:"sticky",top:0,zIndex:100}}>
        <div>
          <div style={{fontSize:10,letterSpacing:4,color:cl.teal,fontWeight:700,textTransform:"uppercase"}}>Rail Maintenance</div>
          <div style={{fontSize:20,fontWeight:800,color:"#e8f4f3"}}>Wear and Maintenance Simulator</div>
          <div style={{fontSize:11,color:"#4a6a74",marginTop:3,letterSpacing:1}}>Created by Mohamed BOUDIA</div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <span style={{fontSize:12,color:cl.dim}}>Gross MGT: <b style={{color:cl.teal}}>{mgtPrev}</b>/yr | Equiv. MGT: <b style={{color:cl.teal}}>{eqPrev}</b>/yr</span>
          <Btn onClick={function(){setHelp(true);}} sm={true}>Help and Methods</Btn>
          <Btn onClick={run} active={true}>Run Simulation</Btn>
        </div>
      </div>

      {showHelp && <HelpModal onClose={function(){setHelp(false);}}/>}

      <div style={{display:"grid",gridTemplateColumns:"360px 1fr",maxWidth:1400,margin:"0 auto",padding:"18px 18px 0"}}>

        <div style={{paddingRight:16}}>

          <Card title="Context">
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {Object.keys(CONTEXTS).map(function(k) {
                return <Btn key={k} onClick={function(){setCon(k);}} active={context===k}>{CONTEXTS[k].label}</Btn>;
              })}
            </div>
          </Card>

          <Card title="Train Fleet">
            {trains.map(function(tr) {
              return (
                <div key={tr.id} style={{background:"rgba(255,255,255,0.02)",borderRadius:8,padding:12,marginBottom:10,border:"1px solid rgba(255,255,255,0.05)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <Inp value={tr.label} onChange={function(v){updTrain(tr.id,"label",v);}} type="text"/>
                    {trains.length > 1 && (
                      <button onClick={function(){delTrain(tr.id);}} style={{background:"none",border:"none",color:cl.warn,cursor:"pointer",fontSize:18,marginLeft:8}}>x</button>
                    )}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div><Lbl>Passes/day (one track, one dir.)</Lbl><Inp value={tr.trainsPerDay} onChange={function(v){updTrain(tr.id,"trainsPerDay",v);}} min={1}/></div>
                    <div><Lbl>Axle load (t)</Lbl><Inp value={tr.axleLoad} onChange={function(v){updTrain(tr.id,"axleLoad",v);}} min={5} max={35} step={0.5}/></div>
                    <div><Lbl>No. of bogies</Lbl><Inp value={tr.bogies} onChange={function(v){updTrain(tr.id,"bogies",v);}} min={2} max={16}/></div>
                    <div><Lbl>Axles/bogie</Lbl><Inp value={tr.axlesPerBogie} onChange={function(v){updTrain(tr.id,"axlesPerBogie",v);}} min={2} max={4}/></div>
                  </div>
                  <div style={{marginTop:8,fontSize:11,color:cl.dim}}>
                    Gross tonnage: <b style={{color:cl.teal}}>{(tr.axleLoad*tr.bogies*tr.axlesPerBogie).toFixed(0)} t</b> - <b style={{color:cl.teal}}>{((tr.trainsPerDay*tr.axleLoad*tr.bogies*tr.axlesPerBogie*365)/1e6).toFixed(2)} MGT/yr</b>
                  </div>
                </div>
              );
            })}
            <Btn onClick={addTrain} sm={true}>+ Add train type</Btn>
          </Card>

          <Card title="Track Layout by Radius Band">
            <div style={{fontSize:11,color:cl.dim,marginBottom:10,lineHeight:1.6}}>Enable bands present on your line. Enter single-track km.</div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10,padding:"5px 8px",background:"rgba(125,211,200,0.06)",borderRadius:6}}>
              <span style={{fontSize:11,color:cl.dim}}>Total active length</span>
              <span style={{fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{segs.filter(function(s){return s.active;}).reduce(function(a,s){return a+(s.lengthKm||0);},0).toFixed(1)} km</span>
            </div>
            {segs.map(function(seg) {
              var rb = BANDS.find(function(b){return b.id===seg.id;});
              return (
                <div key={seg.id} style={{background:seg.active?"rgba(125,211,200,0.04)":"rgba(255,255,255,0.02)",borderRadius:8,padding:"10px 12px",marginBottom:8,border:"1px solid "+(seg.active?"rgba(125,211,200,0.18)":"rgba(255,255,255,0.05)")}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:seg.active?10:0}}>
                    <div onClick={function(){togSeg(seg.id);}} style={{width:30,height:17,borderRadius:9,background:seg.active?cl.teal:"rgba(255,255,255,0.08)",position:"relative",cursor:"pointer",flexShrink:0,border:"1px solid "+(seg.active?cl.teal:"rgba(255,255,255,0.15)")}}>
                      <div style={{width:11,height:11,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:seg.active?15:2,transition:"left 0.2s"}}/>
                    </div>
                    <span style={{fontSize:13,fontWeight:600,color:seg.active?"#e8f4f3":"#4a6a74",flex:1}}>{seg.label}</span>
                    {rb && (
                      <div style={{display:"flex",gap:5}}>
                        <span style={{fontSize:10,background:"rgba(125,211,200,0.1)",color:cl.teal,borderRadius:4,padding:"2px 6px"}}>fV x{rb.f_v}</span>
                        <span style={{fontSize:10,background:"rgba(251,191,36,0.1)",color:cl.amber,borderRadius:4,padding:"2px 6px"}}>fL x{rb.f_l}</span>
                      </div>
                    )}
                  </div>
                  {seg.active && (
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                      <div>
                        <Lbl>Length (km)</Lbl>
                        <Inp value={seg.lengthKm} onChange={function(v){updSeg(seg.id,"lengthKm",v);}} min={0.1} step={0.1}/>
                      </div>
                      <div>
                        <Lbl>Representative radius (m)</Lbl>
                        <Inp value={seg.repr} onChange={function(v){updSeg(seg.id,"repr",Math.max(rb?rb.rMin:1,Math.min((rb?rb.rMax:99999)-1,v)));}} min={rb?rb.rMin:1} max={rb?(rb.rMax-1):99998}/>
                        <div style={{fontSize:10,color:cl.dim,marginTop:2}}>{seg.repr>=9000?"tangent":"R = "+seg.repr+" m"}</div>
                      </div>
                      <div>
                        <Lbl>Grade / Hardness</Lbl>
                        <Sel value={seg.grade} onChange={function(v){updSeg(seg.id,"grade",v);}} opts={Object.keys(RAIL_GRADES).map(function(k){return {v:k,l:k};})}/>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{fontSize:10,color:"#4a6a74",marginTop:6}}>Default: R400HT (R&lt;100m) / R350HT (100-200m) / R320Cr (200-800m) / R260 (tangent)</div>
          </Card>

          <Card title="Rail Parameters">
            <div style={{display:"grid",gap:10}}>
              <div><Lbl>Rail Type</Lbl><Sel value={railType} onChange={setRT} opts={Object.keys(RAIL_TYPES).map(function(k){return {v:k,l:RAIL_TYPES[k].label};})}/></div>
              <div><Lbl>Track Form</Lbl><Sel value={trackMode} onChange={setTM} opts={Object.keys(TRACK_MODES).map(function(k){return {v:k,l:TRACK_MODES[k].label};})}/></div>
              <div><Lbl>Line speed (km/h)</Lbl><Inp value={speed} onChange={setSp} min={20} max={320}/></div>
              <div>
                <Lbl>Flange Lubrication</Lbl>
                <Sel value={lubr} onChange={setLb} opts={Object.keys(LUBRICATION).map(function(k){return {v:k,l:LUBRICATION[k].label};})}/>
                <div style={{fontSize:11,color:cl.dim,marginTop:5}}>
                  {lubr==="none"&&"No lateral wear reduction - dry conditions"}
                  {lubr==="poor"&&"Badly maintained - low reduction on curves"}
                  {lubr==="standard"&&"Correctly adjusted wayside - significant reduction on tight curves"}
                  {lubr==="good"&&"Wayside and onboard combined - good coverage"}
                  {lubr==="optimal"&&"Lab conditions only - unrealistic in revenue service"}
                </div>
              </div>
              <div style={{fontSize:11,color:cl.dim,background:"rgba(125,211,200,0.05)",borderRadius:6,padding:"8px 10px",border:"1px solid rgba(125,211,200,0.1)"}}>
                Rail hardness (grade) is set per segment in the section above
              </div>
            </div>
          </Card>

          <Card title="Initial Rail Condition">
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,padding:"10px 14px",background:isBF?"rgba(251,191,36,0.08)":"rgba(125,211,200,0.05)",borderRadius:8,border:"1px solid "+(isBF?"rgba(251,191,36,0.25)":"rgba(125,211,200,0.12)")}}>
              <div onClick={function(){setBF(function(v){return !v;});}} style={{width:36,height:20,borderRadius:10,background:isBF?cl.amber:"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",flexShrink:0,border:"1px solid "+(isBF?cl.amber:"rgba(255,255,255,0.2)")}}>
                <div style={{width:14,height:14,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:isBF?18:2,transition:"left 0.2s"}}/>
              </div>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:isBF?cl.amber:"#e8f4f3"}}>{isBF?"Brownfield - Existing rail":"Greenfield - New rail (default)"}</div>
                <div style={{fontSize:11,color:cl.dim,marginTop:2}}>{isBF?"Initial wear values applied at simulation start":"All segments start from new rail - wear = 0, RCF = 0"}</div>
              </div>
            </div>
            {isBF && (
              <div>
                <div style={{fontSize:11,color:cl.dim,marginBottom:12,lineHeight:1.6}}>Enter current measured values for each active segment. The simulation starts from these values and computes remaining service life.</div>
                {segs.filter(function(s){return s.active&&s.lengthKm>0;}).map(function(seg) {
                  var ic = initCond[seg.id] || {wearV:0,wearL:0,rcf:0,mgt:0};
                  var lim = LIMITS[context];
                  var health = Math.max(ic.wearV/lim.v, ic.wearL/lim.l, ic.rcf);
                  var hcol = health<0.4?cl.green:health<0.7?cl.amber:cl.warn;
                  var hlbl = health<0.4?"GOOD":health<0.7?"MODERATE":"POOR";
                  return (
                    <div key={seg.id} style={{background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"12px",marginBottom:10,border:"1px solid rgba(255,255,255,0.07)"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <span style={{fontSize:12,fontWeight:600,color:"#e8f4f3"}}>{seg.label}</span>
                        <span style={{fontSize:10,background:hcol+"22",color:hcol,border:"1px solid "+hcol+"55",borderRadius:4,padding:"2px 8px",fontWeight:700}}>
                          {hlbl} - {Math.round(health*100)}% consumed
                        </span>
                      </div>
                      <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2,marginBottom:10}}>
                        <div style={{height:"100%",width:Math.min(100,health*100)+"%",background:hcol,borderRadius:2}}/>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                        <div>
                          <Lbl>{"Vertical wear (mm) - limit "+lim.v+"mm"}</Lbl>
                          <Inp value={ic.wearV} onChange={function(v){updIC(seg.id,"wearV",Math.min(lim.v-0.1,Math.max(0,v)));}} min={0} max={lim.v-0.1} step={0.1}/>
                          {ic.wearV>0&&<div style={{fontSize:10,color:hcol,marginTop:3}}>{((ic.wearV/lim.v)*100).toFixed(0)}% of vertical limit</div>}
                        </div>
                        <div>
                          <Lbl>{"Lateral wear (mm) - limit "+lim.l+"mm"}</Lbl>
                          <Inp value={ic.wearL} onChange={function(v){updIC(seg.id,"wearL",Math.min(lim.l-0.1,Math.max(0,v)));}} min={0} max={lim.l-0.1} step={0.1}/>
                          {ic.wearL>0&&<div style={{fontSize:10,color:hcol,marginTop:3}}>{((ic.wearL/lim.l)*100).toFixed(0)}% of lateral limit</div>}
                        </div>
                        <div>
                          <Lbl>RCF index (0 = healthy, 1 = critical)</Lbl>
                          <Inp value={ic.rcf} onChange={function(v){updIC(seg.id,"rcf",Math.min(0.99,Math.max(0,v)));}} min={0} max={0.99} step={0.01}/>
                          <div style={{fontSize:10,color:ic.rcf<0.3?cl.green:ic.rcf<0.7?cl.amber:cl.warn,marginTop:3}}>
                            {ic.rcf<0.3?"Healthy":ic.rcf<0.7?"Moderate - corrective grinding needed":"Critical - near replacement"}
                          </div>
                        </div>
                        <div>
                          <Lbl>MGT already accumulated</Lbl>
                          <Inp value={ic.mgt} onChange={function(v){updIC(seg.id,"mgt",Math.max(0,v));}} min={0} step={0.5}/>
                          <div style={{fontSize:10,color:cl.dim,marginTop:3}}>For lifecycle tracking</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {segs.filter(function(s){return s.active&&s.lengthKm>0;}).length===0&&(
                  <div style={{fontSize:12,color:"#4a6a74",textAlign:"center",padding:"12px 0"}}>Enable radius bands above to enter initial conditions</div>
                )}
              </div>
            )}
          </Card>

          <Card title="Maintenance Strategy">
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <Btn onClick={function(){setSt("preventive");}} active={strategy==="preventive"}>Preventive</Btn>
              <Btn onClick={function(){setSt("corrective");}} active={strategy==="corrective"}>Corrective</Btn>
            </div>
            <div style={{fontSize:12,color:cl.dim,lineHeight:1.6}}>
              {strategy==="preventive"
                ?"Frequent grinding (short intervals). 1 light pass ~0.2mm. RCF kept low. Restored profile means lower future wear rate and maximum rail life."
                :"Threshold-triggered grinding (3x longer intervals). Up to 4 heavy passes ~2.2mm total. RCF rises before intervention. Metal reserve consumed faster. Shorter rail life."}
            </div>
            <div style={{marginTop:12}}>
              <Lbl>Simulation horizon (years)</Lbl>
              <Inp value={horizon} onChange={setHz} min={5} max={50}/>
            </div>
          </Card>
        </div>

        <div>
          {err&&<div style={{background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:16,color:cl.warn,fontSize:13}}>Error: {err}</div>}

          {!hasRun&&(
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:400,color:"#4a6a74",textAlign:"center",gap:16,border:"1px dashed rgba(125,211,200,0.15)",borderRadius:16}}>
              <div style={{fontSize:48}}>---</div>
              <div style={{fontSize:16,fontWeight:600,color:cl.dim}}>Configure parameters and run the simulation</div>
              <div style={{fontSize:13}}>The simulator computes wear, grinding cycles and replacement timelines for each segment</div>
              <Btn onClick={run} active={true}>Run Simulation</Btn>
            </div>
          )}

          {hasRun&&result&&(
            <div>
              <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                <Kpi label="Gross MGT / yr"  value={result.mgtPY.toFixed(2)}  unit="MGT"/>
                <Kpi label="Equiv. MGT / yr" value={result.eqPY.toFixed(2)}   unit="MGT eq."/>
                <Kpi label="Earliest replacement"
                  value={Math.min.apply(null,result.results.map(function(r){return r.repY||horizon+1;}))<=horizon?"Yr "+Math.min.apply(null,result.results.map(function(r){return r.repY||horizon+1;})):"> "+horizon+" yrs"}
                  unit=""
                  warn={Math.min.apply(null,result.results.map(function(r){return r.repY||horizon+1;}))<=horizon*0.5}
                />
                <Kpi label="Total grindings" value={result.results.reduce(function(a,r){return a+r.gCount;},0)} unit="passes"/>
              </div>

              <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
                {result.results.map(function(r,i) {
                  return (
                    <Btn key={i} onClick={function(){setAi(i);}} active={aidx===i} sm={true}>
                      {r.seg.label}{r.repY?" Yr "+r.repY:""}
                    </Btn>
                  );
                })}
              </div>

              {asr&&(
                <div>
                  <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                    <Kpi label="Radius"      value={asr.seg.radius>=9000?"tangent":asr.seg.radius} unit="m"/>
                    <Kpi label="Length"      value={asr.seg.lengthKm} unit="km"/>
                    <Kpi label="Wear rate V" value={asr.wrV.toFixed(3)} unit="mm/100MGT"/>
                    <Kpi label="Wear rate L" value={asr.wrL.toFixed(3)} unit="mm/100MGT"/>
                    <Kpi label="Replacement" value={asr.repY?"Yr "+asr.repY:"> "+horizon+" yrs"} unit="" warn={!!asr.repY&&asr.repY<horizon*0.6}/>
                    <Kpi label="Grindings"   value={asr.gCount} unit="passes"/>
                  </div>

                  <div style={{display:"flex",gap:6,marginBottom:12}}>
                    {[["wear","Wear V and L"],["rcf","RCF Index"],["reserve","Metal Reserve"],["plan","Schedule"]].map(function(item) {
                      return <Btn key={item[0]} onClick={function(){setCt(item[0]);}} active={ctab===item[0]} sm={true}>{item[1]}</Btn>;
                    })}
                  </div>

                  <div style={{background:"rgba(0,0,0,0.2)",borderRadius:12,padding:18,border:"1px solid rgba(125,211,200,0.1)",marginBottom:14}}>

                    {ctab==="wear"&&(
                      <div>
                        <div style={{fontSize:12,color:cl.dim,marginBottom:12}}>Wear progression - V limit: <b style={{color:cl.warn}}>{asr.limits.v}mm</b> | L limit: <b style={{color:cl.amber}}>{asr.limits.l}mm</b></div>
                        <ResponsiveContainer width="100%" height={250}>
                          <AreaChart data={asr.data}>
                            <defs>
                              <linearGradient id="gV" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={cl.teal} stopOpacity={0.3}/><stop offset="95%" stopColor={cl.teal} stopOpacity={0}/></linearGradient>
                              <linearGradient id="gL" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={cl.amber} stopOpacity={0.3}/><stop offset="95%" stopColor={cl.amber} stopOpacity={0}/></linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                            <XAxis dataKey="year" stroke="#4a6a74" tick={{fontSize:11}} label={{value:"Years",position:"insideBottom",offset:-2,fill:"#4a6a74",fontSize:11}}/>
                            <YAxis stroke="#4a6a74" tick={{fontSize:11}} unit=" mm"/>
                            <Tooltip content={<ChartTip/>}/>
                            <Legend wrapperStyle={{fontSize:12}}/>
                            <ReferenceLine y={asr.limits.v} stroke={cl.warn}  strokeDasharray="5 3" label={{value:"V="+asr.limits.v+"mm",fill:cl.warn, fontSize:10}}/>
                            <ReferenceLine y={asr.limits.l} stroke={cl.amber} strokeDasharray="5 3" label={{value:"L="+asr.limits.l+"mm",fill:cl.amber,fontSize:10}}/>
                            <Area type="monotone" dataKey="wearV" name="Vertical Wear (mm)" stroke={cl.teal}  fill="url(#gV)" strokeWidth={2} dot={false}/>
                            <Area type="monotone" dataKey="wearL" name="Lateral Wear (mm)"  stroke={cl.amber} fill="url(#gL)" strokeWidth={2} dot={false}/>
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {ctab==="rcf"&&(
                      <div>
                        <div style={{fontSize:12,color:cl.dim,marginBottom:12}}>RCF Index - Green &lt;0.3 healthy / Orange 0.3-0.7 moderate / Red &gt;=0.7 critical</div>
                        <ResponsiveContainer width="100%" height={250}>
                          <AreaChart data={asr.data}>
                            <defs><linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={cl.warn} stopOpacity={0.4}/><stop offset="95%" stopColor={cl.warn} stopOpacity={0}/></linearGradient></defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                            <XAxis dataKey="year" stroke="#4a6a74" tick={{fontSize:11}}/>
                            <YAxis stroke="#4a6a74" tick={{fontSize:11}} domain={[0,1]}/>
                            <Tooltip content={<ChartTip/>}/>
                            <ReferenceLine y={0.3} stroke={cl.green} strokeDasharray="4 4" label={{value:"Preventive",fill:cl.green,fontSize:10}}/>
                            <ReferenceLine y={0.7} stroke={cl.warn}  strokeDasharray="4 4" label={{value:"Replacement",fill:cl.warn,fontSize:10}}/>
                            <Area type="monotone" dataKey="rcf" name="RCF Index" stroke={cl.warn} fill="url(#gR)" strokeWidth={2} dot={false}/>
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {ctab==="reserve"&&(
                      <div>
                        <div style={{fontSize:12,color:cl.dim,marginBottom:12}}>Remaining grindable metal reserve (mm) - Minimum threshold: 2mm</div>
                        <ResponsiveContainer width="100%" height={250}>
                          <AreaChart data={asr.data}>
                            <defs><linearGradient id="gP" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={cl.purple} stopOpacity={0.4}/><stop offset="95%" stopColor={cl.purple} stopOpacity={0}/></linearGradient></defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                            <XAxis dataKey="year" stroke="#4a6a74" tick={{fontSize:11}}/>
                            <YAxis stroke="#4a6a74" tick={{fontSize:11}} unit=" mm"/>
                            <Tooltip content={<ChartTip/>}/>
                            <ReferenceLine y={2} stroke={cl.warn} strokeDasharray="4 4" label={{value:"Min 2mm",fill:cl.warn,fontSize:10}}/>
                            <Area type="monotone" dataKey="reserve" name="Reserve (mm)" stroke={cl.purple} fill="url(#gP)" strokeWidth={2} dot={false}/>
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {ctab==="plan"&&(
                      <div>
                        <div style={{fontSize:12,color:cl.dim,marginBottom:12}}>Grinding interventions (green) and replacement events (red)</div>
                        <ResponsiveContainer width="100%" height={250}>
                          <BarChart data={asr.data}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                            <XAxis dataKey="year" stroke="#4a6a74" tick={{fontSize:11}}/>
                            <YAxis stroke="#4a6a74" tick={{fontSize:11}}/>
                            <Tooltip content={<ChartTip/>}/>
                            <Legend wrapperStyle={{fontSize:12}}/>
                            <Bar dataKey="ground"   name="Grinding"    fill={cl.green} opacity={0.8} radius={[3,3,0,0]}/>
                            <Bar dataKey="replaced" name="Replacement" fill={cl.warn}  opacity={0.9} radius={[3,3,0,0]}/>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>

                  <div style={{background:"rgba(0,0,0,0.15)",borderRadius:10,border:"1px solid rgba(125,211,200,0.08)",overflow:"hidden"}}>
                    <div style={{padding:"12px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:11,letterSpacing:2,color:cl.teal,textTransform:"uppercase",fontWeight:700}}>
                      Summary - All Segments
                    </div>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                        <thead>
                          <tr style={{background:"rgba(255,255,255,0.03)"}}>
                            {["Segment","Radius","Grade","Eff.Hardness","Wear rate V","Wear rate L","Grindings","Replacement","Final RCF"].map(function(h) {
                              return <th key={h} style={{padding:"8px 12px",textAlign:"left",color:cl.dim,fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>;
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {result.results.map(function(r,i) {
                            var last = r.data[r.data.length-1];
                            return (
                              <tr key={i} onClick={function(){setAi(i);}} style={{borderTop:"1px solid rgba(255,255,255,0.04)",cursor:"pointer",background:aidx===i?"rgba(125,211,200,0.05)":"transparent"}}>
                                <td style={{padding:"8px 12px",color:"#e8f4f3",fontWeight:500}}>{r.seg.label}</td>
                                <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{r.seg.radius>=9000?"tangent":r.seg.radius+"m"}</td>
                                <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.purple}}>{r.seg.grade||r.seg.railGrade}</td>
                                <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.amber}}>{r.he?r.he.toFixed(2):"-"}</td>
                                <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.teal}}>{r.wrV.toFixed(3)}</td>
                                <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.amber}}>{r.wrL.toFixed(3)}</td>
                                <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{r.gCount}</td>
                                <td style={{padding:"8px 12px"}}>{r.repY?<span style={{color:cl.warn,fontWeight:700}}>Yr {r.repY}</span>:<span style={{color:cl.green}}>&gt; {horizon} yrs</span>}</td>
                                <td style={{padding:"8px 12px"}}>{last&&<RCFBadge v={last.rcf}/>}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ValidationPanel context={context} gp={gp}/>

      <div style={{textAlign:"center",paddingBottom:40,fontSize:11,color:"#3a5a64"}}>
        Coefficients based on EN 13674 / UIC 714 / Infrabel/TU Delft 2023 / Guangzhou Metro 2021
      </div>
    </div>
  );
}
