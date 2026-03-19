import { useState, useCallback, useMemo } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

// ---- CONSTANTS ----

var RAIL_GRADES = {
  R200:   { label:"R200 (~200 BHN)",   f_wear:1.34, f_rcf:1.40 },
  R260:   { label:"R260 (~260 BHN)",   f_wear:1.00, f_rcf:1.00 },
  R320Cr: { label:"R320Cr (~320 BHN)", f_wear:0.70, f_rcf:0.75 },
  R350HT: { label:"R350HT (~350 BHN)", f_wear:0.50, f_rcf:0.55 },
  R400HT: { label:"R400HT (~400 BHN)", f_wear:0.38, f_rcf:0.40 },
};
var RAIL_TYPES = {
  vignole:{ label:"Vignole Rail",       f_v:1.00, f_l:1.00 },
  groove: { label:"Groove Rail (Tram)", f_v:1.20, f_l:1.80 },
};
var TRACK_MODES = {
  ballast: { label:"Ballasted Track",       f_v:1.00, f_l:1.00 },
  slab:    { label:"Concrete Slab Track",   f_v:1.10, f_l:1.15 },
  embedded:{ label:"Embedded Track (Tram)", f_v:1.15, f_l:1.20 },
};
var CONTEXTS = {
  tram: { label:"Tram",        qRef:10,   baseWearV:0.82, baseWearL:1.00, rcfRate:[0.002,0.010,0.018,0.012,0.004] },
  metro:{ label:"Metro / LRT", qRef:15,   baseWearV:0.82, baseWearL:1.00, rcfRate:[0.002,0.010,0.016,0.010,0.003] },
  heavy:{ label:"Heavy Rail",  qRef:22.5, baseWearV:0.82, baseWearL:1.00, rcfRate:[0.002,0.008,0.014,0.009,0.003] },
};
var BANDS = [
  {id:"r1",label:"R < 100 m",       rMin:0,   rMax:100,   f_v:6.0,f_l:15.0,grind:{tram:0.5,metro:3, heavy:999}},
  {id:"r2",label:"100 to 200 m",    rMin:100, rMax:200,   f_v:4.0,f_l:9.0, grind:{tram:1.0,metro:5, heavy:20 }},
  {id:"r3",label:"200 to 400 m",    rMin:200, rMax:400,   f_v:2.5,f_l:5.0, grind:{tram:2.0,metro:8, heavy:30 }},
  {id:"r4",label:"400 to 800 m",    rMin:400, rMax:800,   f_v:1.5,f_l:2.5, grind:{tram:3.5,metro:12,heavy:50 }},
  {id:"r5",label:"R >= 800 m",      rMin:800, rMax:99999, f_v:1.0,f_l:1.0, grind:{tram:5.0,metro:20,heavy:80 }},
];
var SPEED_BANDS = [
  {max:40,  f_v:0.90,f_l:1.10},{max:80, f_v:1.00,f_l:1.00},
  {max:120, f_v:1.10,f_l:0.95},{max:160,f_v:1.20,f_l:0.90},
  {max:9999,f_v:1.35,f_l:0.85},
];
var LUBRICATION = {
  none:    {label:"No lubrication",                f:[1.00,1.00,1.00,1.00,1.00]},
  poor:    {label:"Poor (badly maintained)",       f:[0.80,0.82,0.88,0.95,1.00]},
  standard:{label:"Standard (wayside lubrication)",f:[0.55,0.60,0.72,0.90,1.00]},
  good:    {label:"Good (wayside + onboard)",      f:[0.35,0.40,0.60,0.85,1.00]},
  optimal: {label:"Optimal (lab conditions only)", f:[0.10,0.15,0.35,0.75,1.00]},
};
var LIMITS  = { tram:{v:7,l:8}, metro:{v:9,l:11}, heavy:{v:12,l:14} };
var RESERVE = { R200:13, R260:15, R320Cr:16, R350HT:17, R400HT:18 };
var RCF_MAX = 0.70;

// ---- COST DATA ----

var CURRENCIES = {
  EUR:{label:"Euro (EUR)",             symbol:"EUR",rate:1.00},
  USD:{label:"US Dollar (USD)",        symbol:"USD",rate:1.08},
  GBP:{label:"British Pound (GBP)",    symbol:"GBP",rate:0.86},
  MAD:{label:"Moroccan Dirham (MAD)",  symbol:"MAD",rate:10.8},
  DZD:{label:"Algerian Dinar (DZD)",   symbol:"DZD",rate:146 },
  TND:{label:"Tunisian Dinar (TND)",   symbol:"TND",rate:3.35},
  SAR:{label:"Saudi Riyal (SAR)",      symbol:"SAR",rate:4.05},
  AED:{label:"UAE Dirham (AED)",       symbol:"AED",rate:3.97},
  QAR:{label:"Qatari Riyal (QAR)",     symbol:"QAR",rate:3.93},
  EGP:{label:"Egyptian Pound (EGP)",   symbol:"EGP",rate:52  },
  SGD:{label:"Singapore Dollar (SGD)", symbol:"SGD",rate:1.46},
  CNY:{label:"Chinese Yuan (CNY)",     symbol:"CNY",rate:7.8 },
};
var REGIONS = {
  WEU:   {label:"Western Europe (FR/DE/UK/NL)",  lbr:{foreman:75,tech:58,welder:65,mach:62},   mat:{R260:1100,R320Cr:1280,R350HT:1380,R400HT:1520}, eqp:{tamper:850,rr:420,crane:680,truck:280,grinder:520}, weld:{thermit:380,flash:520}, prod:{rem:8,lay:6,tamp:12}, team:{foreman:1,tech:4,welder:2,mach:2}, ovhd:0.18},
  EEU:   {label:"Eastern Europe (PL/RO/CZ/HU)",  lbr:{foreman:35,tech:25,welder:30,mach:28},   mat:{R260:1050,R320Cr:1220,R350HT:1320,R400HT:1450}, eqp:{tamper:750,rr:380,crane:580,truck:240,grinder:450}, weld:{thermit:280,flash:420}, prod:{rem:9,lay:7,tamp:13}, team:{foreman:1,tech:4,welder:2,mach:2}, ovhd:0.15},
  MENA:  {label:"North Africa / Middle East",     lbr:{foreman:20,tech:12,welder:16,mach:14},   mat:{R260:1200,R320Cr:1380,R350HT:1500,R400HT:1650}, eqp:{tamper:900,rr:450,crane:700,truck:300,grinder:580}, weld:{thermit:320,flash:460}, prod:{rem:7,lay:5,tamp:10}, team:{foreman:1,tech:5,welder:2,mach:2}, ovhd:0.20},
  SSA:   {label:"Sub-Saharan Africa",             lbr:{foreman:15,tech:8, welder:12,mach:10},   mat:{R260:1300,R320Cr:1500,R350HT:1620,R400HT:1780}, eqp:{tamper:950,rr:480,crane:720,truck:320,grinder:600}, weld:{thermit:350,flash:500}, prod:{rem:6,lay:4,tamp:9},  team:{foreman:1,tech:6,welder:2,mach:2}, ovhd:0.22},
  SEA:   {label:"South / South-East Asia",        lbr:{foreman:18,tech:9, welder:13,mach:11},   mat:{R260:950, R320Cr:1100,R350HT:1200,R400HT:1320}, eqp:{tamper:780,rr:400,crane:620,truck:260,grinder:500}, weld:{thermit:290,flash:420}, prod:{rem:8,lay:6,tamp:11}, team:{foreman:1,tech:5,welder:2,mach:2}, ovhd:0.16},
  LATAM: {label:"Latin America",                  lbr:{foreman:22,tech:13,welder:18,mach:15},   mat:{R260:1050,R320Cr:1220,R350HT:1320,R400HT:1450}, eqp:{tamper:820,rr:410,crane:640,truck:270,grinder:520}, weld:{thermit:300,flash:440}, prod:{rem:7,lay:5,tamp:10}, team:{foreman:1,tech:5,welder:2,mach:2}, ovhd:0.18},
  CUSTOM:{label:"Custom / Manual input",          lbr:{foreman:50,tech:40,welder:50,mach:45},   mat:{R260:1100,R320Cr:1280,R350HT:1380,R400HT:1520}, eqp:{tamper:800,rr:400,crane:650,truck:260,grinder:500}, weld:{thermit:350,flash:480}, prod:{rem:8,lay:6,tamp:12}, team:{foreman:1,tech:4,welder:2,mach:2}, ovhd:0.18},
};
var RAIL_KGM = {R200:49,R260:60,R320Cr:60,R350HT:60,R400HT:60};

function calcCostPerMl(p, grade, weldType, nightHrs, currency, ovhdPct, withGrinder, jointSp) {
  var fx   = (CURRENCIES[currency]||CURRENCIES.EUR).rate;
  var lbr  = p.lbr; var eqp = p.eqp; var prod = p.prod; var team = p.team;
  var hLay = 1/prod.lay; var hRem = 1/prod.rem; var hTmp = 1/prod.tamp;
  var lbrH = lbr.foreman*team.foreman + lbr.tech*team.tech + lbr.welder*team.welder + lbr.mach*team.mach;
  var labour   = lbrH * (hLay + hRem + hTmp);
  var kgm      = (RAIL_KGM[grade]||60)/1000;
  var matPrice = p.mat[grade] || p.mat.R260;
  var material = kgm * matPrice * 2;
  var equip    = eqp.tamper*hTmp + eqp.rr*(hLay+hRem) + eqp.crane*(hLay+hRem) + eqp.truck*(hLay+hRem) + (withGrinder?eqp.grinder*0.5:0);
  var weldCost = (weldType==="flash"?p.weld.flash:p.weld.thermit) / jointSp;
  var tooling  = labour * 0.05;
  var direct   = labour + material + equip + weldCost + tooling;
  var overhead = direct * (ovhdPct/100);
  var total    = (direct + overhead) * fx;
  var mlNight  = nightHrs * prod.lay * 0.70;
  return { labour:labour*fx, material:material*fx, equip:equip*fx, weld:weldCost*fx, tooling:tooling*fx, overhead:overhead*fx, total:total, mlNight:mlNight, lbrH:lbrH*fx, hPerMl:(hLay+hRem+hTmp) };
}

// ---- SIMULATION ENGINE ----

function calcMGT(trains) {
  return trains.reduce(function(s,t){ return s+(t.trainsPerDay*t.axleLoad*t.bogies*t.axlesPerBogie*365)/1e6; },0);
}
function calcEqMGT(trains,ctx) {
  var qRef=CONTEXTS[ctx].qRef;
  return trains.reduce(function(s,t){ var m=(t.trainsPerDay*t.axleLoad*t.bogies*t.axlesPerBogie*365)/1e6; return s+m*Math.pow(t.axleLoad/qRef,3); },0);
}
function runSim(params) {
  var ctx=CONTEXTS[params.context], rt=RAIL_TYPES[params.railType], tm=TRACK_MODES[params.trackMode];
  var sf=SPEED_BANDS.find(function(s){return params.speed<=s.max;})||SPEED_BANDS[4];
  var lubKey=params.lubrication||"none", mgtPY=calcMGT(params.trains), eqPY=calcEqMGT(params.trains,params.context);
  var limits=LIMITS[params.context];
  var results=params.segments.map(function(seg){
    var rb=BANDS.find(function(b){return seg.radius>=b.rMin&&seg.radius<b.rMax;})||BANDS[4];
    var ri=BANDS.indexOf(rb), grade=RAIL_GRADES[seg.railGrade]||RAIL_GRADES["R260"];
    var lubF=(LUBRICATION[lubKey]||LUBRICATION.none).f[ri];
    var he=Math.min(1.0-(1.0-grade.f_wear)/(1.0+rb.f_l*0.3),1.0);
    var wrV=ctx.baseWearV*rb.f_v*he*rt.f_v*tm.f_v*sf.f_v;
    var wrL=ctx.baseWearL*1.5*rb.f_l*he*rt.f_l*tm.f_l*sf.f_l*lubF;
    var rcfBase=ctx.rcfRate[ri]*grade.f_rcf*sf.f_v;
    var gi=rb.grind[params.context]||999, gMGT=params.strategy==="preventive"?gi:gi*3;
    var resI=params.railType==="groove"?12:(RESERVE[seg.railGrade]||15);
    var gp=params.strategy==="preventive"?{rem:0.20,rcfR:0.30,pwf:0.75,pmgt:gi*0.85}:{rem:0.55,rcfR:0.18,pwf:0.92,pmgt:gi*0.40};
    var wV=seg.initWearV||0, wL=seg.initWearL||0, rcf=Math.min(seg.initRCF||0,0.99);
    var res=Math.max(2.1,resI-(wV*0.8)), mgtSG=0, totMGT=seg.initMGT||0, pgLeft=0, gCnt=0, repY=null, data=[];
    for(var y=1;y<=params.horizonYears;y++){
      totMGT+=mgtPY; mgtSG+=mgtPY;
      var wf=pgLeft>0?gp.pwf:1.0; pgLeft=Math.max(0,pgLeft-mgtPY);
      wV+=(mgtPY/100)*wrV*wf; wL+=(mgtPY/100)*wrL*wf;
      var wp=Math.min(0.80,wrV*wf/5.0); rcf=Math.min(1.0,rcf+rcfBase*mgtPY*(1.0-wp));
      var ground=false;
      if(mgtSG>=gMGT&&rcf<RCF_MAX&&res>3){
        var passes=params.strategy==="corrective"?Math.max(1,Math.min(4,Math.ceil(rcf/0.12))):1;
        var rem=passes*gp.rem;
        res-=rem; rcf=Math.max(0,rcf-passes*gp.rcfR*(1.0+(1.0-rcf)*0.5)); wV=Math.max(0,wV-rem*0.2);
        pgLeft=gp.pmgt; mgtSG=0; gCnt++; ground=true;
      }
      var repl=wV>=limits.v||wL>=limits.l||res<=2||rcf>=RCF_MAX;
      data.push({year:y,mgt:+totMGT.toFixed(2),wearV:+Math.min(wV,limits.v).toFixed(3),wearL:+Math.min(wL,limits.l).toFixed(3),rcf:+Math.min(rcf,1).toFixed(3),reserve:+Math.max(res,0).toFixed(2),ground:ground?1:0,replaced:(repl&&!repY)?1:0,lv:limits.v,ll:limits.l});
      if(repl&&!repY){repY=y;break;}
    }
    return {seg:seg,rb:rb,wrV:wrV,wrL:wrL,he:he,mgtPY:mgtPY,eqPY:eqPY,gCount:gCnt,repY:repY,data:data,limits:limits};
  });
  return {results:results,mgtPY:mgtPY,eqPY:eqPY};
}

// ---- UI HELPERS ----

var cl={teal:"#7dd3c8",text:"#c8ddd9",dim:"#6bb5af",muted:"#8899aa",warn:"#f87171",amber:"#fbbf24",green:"#4ade80",purple:"#a78bfa"};
var iS={background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:6,color:"#e8f4f3",padding:"7px 10px",fontSize:13,width:"100%",outline:"none",fontFamily:"monospace",boxSizing:"border-box"};

function Lbl(p){return <div style={{fontSize:11,color:cl.muted,marginBottom:4,fontWeight:500}}>{p.children}</div>;}
function Inp(p){var t=p.type||"number";return <input type={t} value={p.value} placeholder={p.ph||""} onChange={function(e){p.onChange(t==="number"?+e.target.value:e.target.value);}} min={p.min} max={p.max} step={p.step||1} style={iS}/>;}
function Sel(p){return <select value={p.value} onChange={function(e){p.onChange(e.target.value);}} style={{background:"#1a2830",border:"1px solid rgba(255,255,255,0.12)",borderRadius:6,color:"#e8f4f3",padding:"7px 10px",fontSize:13,width:"100%",outline:"none",cursor:"pointer"}}>{p.opts.map(function(o){return <option key={o.v} value={o.v}>{o.l}</option>;})}</select>;}
function Btn(p){return <button onClick={p.onClick} style={{background:p.active?cl.teal:"rgba(255,255,255,0.06)",color:p.active?"#0d1f26":cl.text,border:"1px solid "+(p.active?cl.teal:"rgba(255,255,255,0.15)"),borderRadius:6,padding:p.sm?"5px 12px":"8px 18px",fontSize:p.sm?12:13,fontWeight:600,cursor:"pointer"}}>{p.children}</button>;}
function Card(p){return <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:"18px 20px",marginBottom:16}}><div style={{fontSize:10,fontWeight:700,letterSpacing:3,color:cl.teal,textTransform:"uppercase",marginBottom:14}}>{p.title}</div>{p.children}</div>;}
function Kpi(p){var c=p.warn?cl.warn:cl.teal;return <div style={{background:p.warn?"rgba(248,113,113,0.08)":"rgba(125,211,200,0.05)",border:"1px solid "+(p.warn?"rgba(248,113,113,0.25)":"rgba(125,211,200,0.15)"),borderRadius:8,padding:"10px 14px",flex:1,minWidth:100}}><div style={{fontSize:10,color:p.warn?cl.warn:cl.dim,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>{p.label}</div><div style={{fontSize:18,fontWeight:700,color:c,fontFamily:"monospace"}}>{p.value}<span style={{fontSize:11,fontWeight:400,marginLeft:4,color:cl.muted}}>{p.unit}</span></div></div>;}
function RCFBadge(p){var c=p.v<0.3?cl.green:p.v<0.7?cl.amber:cl.warn,l=p.v<0.3?"HEALTHY":p.v<0.7?"MODERATE":"CRITICAL";return <span style={{background:c+"22",color:c,border:"1px solid "+c+"55",borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700}}>{l}</span>;}
function Tip(p){if(!p.active||!p.payload||!p.payload.length)return null;return <div style={{background:"#0d1f26",border:"1px solid rgba(125,211,200,0.25)",borderRadius:8,padding:"10px 14px",fontSize:12}}><div style={{color:cl.teal,marginBottom:6,fontWeight:700}}>Year {p.label}</div>{p.payload.map(function(x){return <div key={x.name} style={{color:x.color,marginBottom:2}}>{x.name}: <b>{typeof x.value==="number"?x.value.toFixed(3):x.value}</b></div>;})}</div>;}

// ---- VALIDATION ----

var REF=[
  {id:"BE1",source:"Infrabel/TU Delft 2023",ctx:"heavy",desc:"Heavy rail - tangent - R260",r:9999,grade:"R260",mgt:25,wV:0.82,wL:null,note:"Big-data, 5338 km, 2012-2019"},
  {id:"BE2",source:"Infrabel/TU Delft 2023",ctx:"heavy",desc:"Heavy rail - R500m - R260",  r:500, grade:"R260",mgt:25,wV:1.40,wL:2.80,note:"Outer rail, preventive grinding since 2016"},
  {id:"BE3",source:"Infrabel/TU Delft 2023",ctx:"heavy",desc:"Heavy rail - tangent - R200", r:9999,grade:"R200",mgt:25,wV:1.10,wL:null,note:"R200 = +34% wear vs R260 on tangent"},
  {id:"GZ1",source:"ScienceDirect Wear 2021",ctx:"metro",desc:"Guangzhou Metro - R300m",    r:300, grade:"R260",mgt:15,wV:2.10,wL:6.50,note:"Outer rail, Line 1, 12 curves R300"},
  {id:"GZ2",source:"Railway Sciences 2022",  ctx:"heavy",desc:"EMU depot - R350m ~30km/h",  r:350, grade:"R260",mgt:5, wV:null,wL:null,incomparable:true,rawWearL:10.1,note:"Unit mismatch: 10.1mm lateral = absolute after 1M passes, not mm/100MGT"},
];
function getRefPred(ref,gp){
  if(!gp||ref.incomparable)return null;
  var grossTons=(ref.mgt*1e6)/365, axleLoad=Math.max(5,Math.min(35,grossTons/4));
  var trains=[{id:"s",label:"s",trainsPerDay:1,axleLoad:axleLoad,bogies:2,axlesPerBogie:2}];
  var segs=[{id:"s",label:ref.desc,radius:ref.r>=9999?9000:ref.r,railGrade:ref.grade}];
  try{
    var res=runSim({context:ref.ctx,trains:trains,segments:segs,strategy:gp.strategy||"preventive",railType:gp.railType||"vignole",trackMode:gp.trackMode||"ballast",speed:gp.speed||80,lubrication:gp.lubrication||"none",horizonYears:1});
    var s=res&&res.results&&res.results[0]; if(!s)return null;
    return {v:+s.wrV.toFixed(3),l:+s.wrL.toFixed(3)};
  }catch(e){return null;}
}
function devPct(pred,real){if(real==null||pred==null)return null;return(((pred-real)/real)*100).toFixed(1);}
function devCol(p){var a=Math.abs(+p);return a<=15?cl.green:a<=30?cl.amber:cl.warn;}

function ValidationPanel(props) {
  var context=props.context, gp=props.gp;
  const [userCases, setUserCases] = useState([]);
  const [form, setForm] = useState({label:"",source:"",radius:300,grade:"R260",mgt:15,wV:"",wL:"",note:""});
  const [showForm, setShowForm] = useState(false);
  var cases=useMemo(function(){return REF.filter(function(r){return r.ctx===context;}).concat(userCases);},[context,userCases]);
  var preds=useMemo(function(){return cases.map(function(r){return getRefPred(r,gp);});},[cases,gp&&gp.railType,gp&&gp.trackMode,gp&&gp.speed,gp&&gp.lubrication,gp&&gp.strategy]);
  var chartData=cases.map(function(r,i){var p=preds[i];if(r.wV==null||p==null)return null;return{name:r.id,sim:p.v,real:r.wV};}).filter(Boolean);
  function addCase(){
    if(!form.label)return;
    setUserCases(function(u){return u.concat([{id:"u"+Date.now(),source:form.source||"User",ctx:context,desc:form.label,r:form.radius,grade:form.grade,mgt:form.mgt,wV:form.wV!==""?+form.wV:null,wL:form.wL!==""?+form.wL:null,note:form.note,isUser:true}]);});
    setForm({label:"",source:"",radius:300,grade:"R260",mgt:15,wV:"",wL:"",note:""});
    setShowForm(false);
  }
  var sym=(CURRENCIES[gp&&gp.currency]||CURRENCIES.EUR).symbol;
  return (
    <div style={{maxWidth:1400,margin:"32px auto 0",padding:"0 20px 60px"}}>
      <div style={{borderTop:"1px solid rgba(125,211,200,0.12)",paddingTop:28,marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
        <div>
          <div style={{fontSize:11,letterSpacing:3,color:cl.teal,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>Validation and Calibration</div>
          <div style={{fontSize:18,fontWeight:700,color:"#e8f4f3"}}>Simulator vs Real-World Measurement Data</div>
          <div style={{fontSize:12,color:cl.dim,marginTop:4}}>Sources: Belgian Network (Infrabel/TU Delft 2023), Guangzhou Metro (2021-2022)</div>
          {gp&&<div style={{fontSize:11,color:"#4a6a74",marginTop:6,padding:"4px 10px",background:"rgba(125,211,200,0.04)",borderRadius:6,display:"inline-block"}}>Predictions use: {RAIL_TYPES[gp.railType]&&RAIL_TYPES[gp.railType].label} / {TRACK_MODES[gp.trackMode]&&TRACK_MODES[gp.trackMode].label} / {gp.speed} km/h / {gp.strategy}</div>}
        </div>
        <Btn onClick={function(){setShowForm(function(v){return !v;});}} sm={true} active={showForm}>{showForm?"Cancel":"+ Add real measurement"}</Btn>
      </div>
      {showForm&&(
        <div style={{background:"rgba(125,211,200,0.04)",border:"1px solid rgba(125,211,200,0.2)",borderRadius:10,padding:20,marginBottom:20}}>
          <div style={{fontSize:12,color:cl.teal,fontWeight:700,marginBottom:12}}>ADD REAL MEASUREMENT</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
            <div><Lbl>Label</Lbl><Inp value={form.label} onChange={function(v){setForm(function(f){return Object.assign({},f,{label:v});});}} type="text" ph="e.g. Line 2 curve"/></div>
            <div><Lbl>Source</Lbl><Inp value={form.source} onChange={function(v){setForm(function(f){return Object.assign({},f,{source:v});});}} type="text" ph="e.g. Project name"/></div>
            <div><Lbl>Radius (m)</Lbl><Inp value={form.radius} onChange={function(v){setForm(function(f){return Object.assign({},f,{radius:v});});}} min={50}/></div>
            <div><Lbl>Rail grade</Lbl><Sel value={form.grade} onChange={function(v){setForm(function(f){return Object.assign({},f,{grade:v});});}} opts={Object.keys(RAIL_GRADES).map(function(k){return {v:k,l:k};})}/></div>
            <div><Lbl>MGT/yr</Lbl><Inp value={form.mgt} onChange={function(v){setForm(function(f){return Object.assign({},f,{mgt:v});});}} min={0.1} step={0.5}/></div>
            <div><Lbl>Vertical wear (mm/100MGT)</Lbl><input value={form.wV} onChange={function(e){setForm(function(f){return Object.assign({},f,{wV:e.target.value});});}} type="number" step="0.01" placeholder="e.g. 1.2" style={iS}/></div>
            <div><Lbl>Lateral wear (mm/100MGT)</Lbl><input value={form.wL} onChange={function(e){setForm(function(f){return Object.assign({},f,{wL:e.target.value});});}} type="number" step="0.01" placeholder="e.g. 4.5" style={iS}/></div>
            <div><Lbl>Notes</Lbl><Inp value={form.note} onChange={function(v){setForm(function(f){return Object.assign({},f,{note:v});});}} type="text" ph="conditions, method..."/></div>
          </div>
          <Btn onClick={addCase} active={true} sm={true}>Add measurement</Btn>
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:20}}>
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:12,padding:20,border:"1px solid rgba(125,211,200,0.1)"}}>
          <div style={{fontSize:11,color:cl.teal,letterSpacing:2,textTransform:"uppercase",fontWeight:700,marginBottom:14}}>Vertical Wear - Simulator vs Measured (mm/100MGT)</div>
          {chartData.length>0?(
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} layout="vertical" margin={{left:10,right:20}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                <XAxis type="number" stroke="#4a6a74" tick={{fontSize:10}} unit=" mm"/>
                <YAxis type="category" dataKey="name" stroke="#4a6a74" tick={{fontSize:10}} width={80}/>
                <Tooltip content={<Tip/>}/><Legend wrapperStyle={{fontSize:11}}/>
                <Bar dataKey="real" name="Measured" fill={cl.amber} opacity={0.85} radius={[0,3,3,0]}/>
                <Bar dataKey="sim"  name="Simulator" fill={cl.teal} opacity={0.85} radius={[0,3,3,0]}/>
              </BarChart>
            </ResponsiveContainer>
          ):<div style={{textAlign:"center",color:"#4a6a74",padding:"40px 0",fontSize:13}}>No data for this context</div>}
        </div>
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:12,padding:20,border:"1px solid rgba(125,211,200,0.1)"}}>
          <div style={{fontSize:11,color:cl.teal,letterSpacing:2,textTransform:"uppercase",fontWeight:700,marginBottom:14}}>Deviation - Simulator vs Field</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {chartData.map(function(d){var ep=devPct(d.sim,d.real);if(ep==null)return null;var col=devCol(ep);return(
              <div key={d.name}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}><span style={{color:cl.text}}>{d.name}</span><span style={{color:col,fontFamily:"monospace",fontWeight:700}}>{+ep>0?"+":""}{ep}%</span></div>
                <div style={{height:5,background:"rgba(255,255,255,0.06)",borderRadius:3}}><div style={{height:"100%",width:Math.min(100,Math.abs(+ep))+"%",background:col,borderRadius:3}}/></div>
              </div>
            );})}
            <div style={{marginTop:6,fontSize:11,color:cl.dim,borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:8}}>Green &lt;15% good / Yellow 15-30% acceptable / Red &gt;30% recalibrate</div>
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
            <thead><tr style={{background:"rgba(255,255,255,0.03)"}}>{["Source","Description","Radius","Grade","MGT/yr","V.Wear Real","V.Wear Sim.","Dev.V","L.Wear Real","L.Wear Sim.","Dev.L","Notes"].map(function(h){return <th key={h} style={{padding:"8px 12px",textAlign:"left",color:cl.dim,fontWeight:600,whiteSpace:"nowrap",fontSize:11}}>{h}</th>;})}</tr></thead>
            <tbody>
              {cases.map(function(r,i){var p=preds[i],eV=r.incomparable?null:devPct(p&&p.v,r.wV),eL=r.incomparable?null:devPct(p&&p.l,r.wL);return(
                <tr key={r.id} style={{borderTop:"1px solid rgba(255,255,255,0.04)",background:r.isUser?"rgba(125,211,200,0.04)":r.incomparable?"rgba(251,191,36,0.03)":"transparent"}}>
                  <td style={{padding:"8px 12px",color:r.isUser?cl.teal:r.incomparable?cl.amber:cl.muted,fontSize:11}}>{r.isUser?"U ":r.incomparable?"! ":"R "}{r.source}</td>
                  <td style={{padding:"8px 12px",color:cl.text,fontSize:11}}>{r.desc}</td>
                  <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{r.r>=9999?"tangent":r.r+"m"}</td>
                  <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.purple}}>{r.grade}</td>
                  <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{r.mgt}</td>
                  <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.amber}}>{r.wV!=null?r.wV:"-"}</td>
                  <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.teal}}>{r.incomparable?"-":(p?p.v:"-")}</td>
                  <td style={{padding:"8px 12px"}}>{eV!=null?<span style={{color:devCol(eV),fontWeight:700}}>{+eV>0?"+":""}{eV}%</span>:"-"}</td>
                  <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.amber}}>{r.incomparable?<span style={{color:cl.amber}}>{r.rawWearL} mm*</span>:(r.wL!=null?r.wL:"-")}</td>
                  <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.teal}}>{r.incomparable?"-":(p?p.l:"-")}</td>
                  <td style={{padding:"8px 12px"}}>{eL!=null?<span style={{color:devCol(eL),fontWeight:700}}>{+eL>0?"+":""}{eL}%</span>:(r.incomparable?<span style={{color:cl.amber,fontSize:10}}>unit mismatch</span>:"-")}</td>
                  <td style={{padding:"8px 12px",color:r.incomparable?cl.amber:cl.muted,fontSize:11}}>{r.note}</td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{marginTop:8,fontSize:11,color:cl.amber,padding:"8px 12px",background:"rgba(251,191,36,0.05)",borderRadius:6,border:"1px solid rgba(251,191,36,0.15)"}}>* Cases marked with ! cannot be compared: absolute wear value, not a rate. Divide by accumulated MGT to convert.</div>
    </div>
  );
}

// ---- COST PANEL ----

function CostPanel(props) {
  var simResult=props.simResult, horizon=props.horizon;
  const [region,    setRegion]   = useState("WEU");
  const [currency,  setCurrency] = useState("EUR");
  const [weldType,  setWeld]     = useState("thermit");
  const [nightHrs,  setNight]    = useState(6);
  const [jointSp,   setJoint]    = useState(25);
  const [ovhdPct,   setOvhd]     = useState(18);
  const [withGrind, setGrind]    = useState(false);
  const [expL,      setEL]       = useState(false);
  const [expM,      setEM]       = useState(false);
  const [expE,      setEE]       = useState(false);
  const [expP,      setEP]       = useState(false);
  const [cLbr,      setCLbr]     = useState(null);
  const [cMat,      setCMat]     = useState(null);
  const [cEqp,      setCEqp]     = useState(null);
  const [cWeld,     setCWeld]    = useState(null);
  const [cProd,     setCProd]    = useState(null);
  const [cTeam,     setCTeam]    = useState(null);

  var base=REGIONS[region]||REGIONS.WEU;
  var p={lbr:cLbr||base.lbr, mat:cMat||base.mat, eqp:cEqp||base.eqp, weld:cWeld||base.weld, prod:cProd||base.prod, team:cTeam||base.team};
  var sym=(CURRENCIES[currency]||CURRENCIES.EUR).symbol;
  var fx=(CURRENCIES[currency]||CURRENCIES.EUR).rate;

  function applyRegion(r){
    setRegion(r); setCLbr(null); setCMat(null); setCEqp(null); setCWeld(null); setCProd(null); setCTeam(null);
    setOvhd(Math.round((REGIONS[r]||REGIONS.WEU).ovhd*100));
  }
  function fmt(v){if(v>=1e6)return (v/1e6).toFixed(2)+"M "+sym;if(v>=1e3)return (v/1e3).toFixed(1)+"k "+sym;return v.toFixed(0)+" "+sym;}

  var ref=calcCostPerMl(p,"R260",weldType,nightHrs,currency,ovhdPct,withGrind,jointSp);

  var segCosts=simResult?simResult.results.map(function(r){
    if(!r.repY)return null;
    var grade=r.seg.grade||r.seg.railGrade||"R260";
    var c=calcCostPerMl(p,grade,weldType,nightHrs,currency,ovhdPct,withGrind,jointSp);
    var totalCost=c.total*(r.seg.lengthKm||0)*1000;
    return {seg:r.seg,repY:r.repY,grade:grade,lengthKm:r.seg.lengthKm||0,c:c,totalCost:totalCost,annualized:totalCost/horizon,nights:((r.seg.lengthKm||0)*1000)/c.mlNight};
  }).filter(Boolean):[];

  var totalCost=segCosts.reduce(function(a,s){return a+s.totalCost;},0);
  var totalAnn=segCosts.reduce(function(a,s){return a+s.annualized;},0);
  var totalNights=segCosts.reduce(function(a,s){return a+s.nights;},0);

  var bars=[
    {label:"Labour",  val:ref.labour,  col:cl.teal},
    {label:"Material",val:ref.material,col:cl.amber},
    {label:"Equipment",val:ref.equip,  col:cl.purple},
    {label:"Welding", val:ref.weld,    col:"#60a5fa"},
    {label:"Tooling", val:ref.tooling, col:cl.green},
    {label:"Overhead",val:ref.overhead,col:cl.muted},
  ];

  function secHdr(title,open,setOpen){
    return (
      <div onClick={function(){setOpen(function(v){return !v;});}} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",padding:"7px 10px",background:"rgba(255,255,255,0.04)",borderRadius:6,marginBottom:open?6:0,marginTop:8}}>
        <span style={{fontSize:11,fontWeight:600,color:cl.text}}>{title}</span>
        <span style={{fontSize:10,color:cl.dim}}>{open?"collapse":"expand"}</span>
      </div>
    );
  }
  function secBody(open,children){
    if(!open)return null;
    return <div style={{padding:"8px 10px",background:"rgba(0,0,0,0.15)",borderRadius:6,marginBottom:4}}>{children}</div>;
  }
  function iRow(label,val,unit,onChange,step){
    return (
      <div style={{display:"grid",gridTemplateColumns:"150px 1fr",alignItems:"center",gap:8,marginBottom:6}}>
        <div style={{fontSize:11,color:cl.dim}}>{label}</div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <input type="number" value={val} min={0} step={step||1} onChange={function(e){onChange(+e.target.value);}} style={Object.assign({},iS,{width:90,textAlign:"right"})}/>
          <span style={{fontSize:11,color:cl.muted}}>{unit}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:16}}>
      <div style={{overflowY:"auto",maxHeight:680,paddingRight:8}}>
        <div style={{marginBottom:12}}>
          <Lbl>Region / Country preset</Lbl>
          <Sel value={region} onChange={applyRegion} opts={Object.keys(REGIONS).map(function(k){return {v:k,l:REGIONS[k].label};})}/>
        </div>
        <div style={{marginBottom:12}}>
          <Lbl>Display currency</Lbl>
          <Sel value={currency} onChange={setCurrency} opts={Object.keys(CURRENCIES).map(function(k){return {v:k,l:CURRENCIES[k].label};})}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          <div><Lbl>Welding type</Lbl><Sel value={weldType} onChange={setWeld} opts={[{v:"thermit",l:"Aluminothermic"},{v:"flash",l:"Flash butt"}]}/></div>
          <div><Lbl>Joint spacing (m)</Lbl><Inp value={jointSp} onChange={setJoint} min={12} max={100}/></div>
          <div><Lbl>Night window (h)</Lbl><Inp value={nightHrs} onChange={setNight} min={2} max={10} step={0.5}/></div>
          <div><Lbl>Overhead (%)</Lbl><Inp value={ovhdPct} onChange={setOvhd} min={5} max={40}/></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,padding:"8px 10px",background:"rgba(255,255,255,0.03)",borderRadius:6}}>
          <div onClick={function(){setGrind(function(v){return !v;});}} style={{width:28,height:16,borderRadius:8,background:withGrind?cl.teal:"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",border:"1px solid "+(withGrind?cl.teal:"rgba(255,255,255,0.2)")}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:withGrind?14:2}}/>
          </div>
          <span style={{fontSize:12,color:cl.text}}>Include pre-grinding pass</span>
        </div>

        {secHdr("Labour rates ("+sym+"/h)", expL, setEL)}
        {secBody(expL,
          <div>
            {[["foreman","Foreman"],[" tech","Technician"],["welder","Welder"],["mach","Machinist"]].map(function(item){
              var k=item[0].trim(), lbl=item[1];
              var val=(cLbr||base.lbr)[k];
              return iRow(lbl+" ("+sym+"/h)", val, sym+"/h", function(v){setCLbr(Object.assign({},(cLbr||base.lbr),{[k]:v}));}, 1);
            })}
            <div style={{marginTop:8,fontSize:11,color:cl.dim}}>Team size:</div>
            {[["foreman","Foreman"],["tech","Technicians"],["welder","Welders"],["mach","Machinists"]].map(function(item){
              var k=item[0], lbl=item[1];
              var val=(cTeam||base.team)[k];
              return iRow(lbl, val, "persons", function(v){setCTeam(Object.assign({},(cTeam||base.team),{[k]:v}));}, 1);
            })}
          </div>
        )}

        {secHdr("Rail material ("+sym+"/tonne)", expM, setEM)}
        {secBody(expM,
          <div>
            {["R260","R320Cr","R350HT","R400HT"].map(function(k){
              var val=(cMat||base.mat)[k]||0, kgm=RAIL_KGM[k]||60;
              return iRow(k+" ("+kgm+"kg/m)", val, sym+"/t", function(v){setCMat(Object.assign({},(cMat||base.mat),{[k]:v}));}, 10);
            })}
            <div style={{fontSize:10,color:cl.dim,marginTop:4}}>Material cost = price/t x kg/m x 2 rails</div>
          </div>
        )}

        {secHdr("Equipment rental ("+sym+"/h)", expE, setEE)}
        {secBody(expE,
          <div>
            {[["tamper","Tamping machine"],["rr","Rail-road vehicle"],["crane","Track crane"],["truck","Logistics truck"],["grinder","Rail grinder"]].map(function(item){
              var k=item[0], lbl=item[1];
              var val=(cEqp||base.eqp)[k];
              return iRow(lbl, val, sym+"/h", function(v){setCEqp(Object.assign({},(cEqp||base.eqp),{[k]:v}));}, 10);
            })}
            <div style={{marginTop:8,fontSize:11,color:cl.dim}}>Welding cost per joint:</div>
            {[["thermit","Aluminothermic"],["flash","Flash butt"]].map(function(item){
              var k=item[0], lbl=item[1];
              var val=(cWeld||base.weld)[k];
              return iRow(lbl, val, sym+"/joint", function(v){setCWeld(Object.assign({},(cWeld||base.weld),{[k]:v}));}, 10);
            })}
          </div>
        )}

        {secHdr("Team productivity (ml/h)", expP, setEP)}
        {secBody(expP,
          <div>
            {[["rem","Rail removal"],["lay","Rail laying"],["tamp","Tamping/geometry"]].map(function(item){
              var k=item[0], lbl=item[1];
              var val=(cProd||base.prod)[k];
              return iRow(lbl, val, "ml/h", function(v){setCProd(Object.assign({},(cProd||base.prod),{[k]:v}));}, 0.5);
            })}
            <div style={{fontSize:10,color:cl.dim,marginTop:4}}>Night efficiency factor: 70% applied automatically</div>
          </div>
        )}
      </div>

      <div>
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:12,padding:18,border:"1px solid rgba(125,211,200,0.1)",marginBottom:16}}>
          <div style={{fontSize:11,color:cl.teal,letterSpacing:2,textTransform:"uppercase",fontWeight:700,marginBottom:14}}>Unit Cost Breakdown - R260 reference (per linear meter, 2 rails)</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:14}}>
            {bars.map(function(b){return(
              <div key={b.label} style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
                <div style={{fontSize:10,color:b.col,letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>{b.label}</div>
                <div style={{fontSize:15,fontWeight:700,color:b.col,fontFamily:"monospace"}}>{b.val.toFixed(0)}</div>
                <div style={{fontSize:10,color:cl.muted,marginTop:2}}>{sym}/ml</div>
              </div>
            );})}
          </div>
          <div style={{marginBottom:8}}>
            <div style={{fontSize:11,color:cl.dim,marginBottom:6}}>Cost composition</div>
            <div style={{display:"flex",height:16,borderRadius:4,overflow:"hidden"}}>
              {bars.map(function(b,i){return <div key={i} style={{width:((b.val/ref.total)*100)+"%",background:b.col,opacity:0.8}}/>;  })}
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.06)"}}>
            <div style={{fontSize:13,color:cl.dim}}>TOTAL COST PER LINEAR METER (R260)</div>
            <div style={{fontSize:22,fontWeight:800,color:cl.teal,fontFamily:"monospace"}}>{ref.total.toFixed(0)} {sym}/ml</div>
          </div>
          <div style={{marginTop:8,display:"flex",gap:16,fontSize:11,color:cl.dim}}>
            <span>Night productivity: <b style={{color:cl.text}}>{ref.mlNight.toFixed(0)} ml/night</b></span>
            <span>Team cost/h: <b style={{color:cl.text}}>{ref.lbrH.toFixed(0)} {sym}/h</b></span>
            <span>Time/ml: <b style={{color:cl.text}}>{(ref.hPerMl*60).toFixed(0)} min</b></span>
          </div>
        </div>

        {!simResult&&<div style={{background:"rgba(0,0,0,0.15)",borderRadius:10,padding:24,textAlign:"center",color:"#4a6a74",border:"1px dashed rgba(125,211,200,0.1)"}}>Run the simulation first to compute total replacement costs</div>}
        {simResult&&segCosts.length===0&&<div style={{background:"rgba(78,222,128,0.06)",border:"1px solid rgba(78,222,128,0.2)",borderRadius:10,padding:16,textAlign:"center",color:cl.green,fontSize:13}}>No replacement required within the {horizon}-year horizon</div>}
        {simResult&&segCosts.length>0&&(
          <div>
            <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
              <Kpi label="Total replacement cost" value={fmt(totalCost)} unit=""/>
              <Kpi label={"Annualised over "+horizon+"yr"} value={fmt(totalAnn)} unit="/yr"/>
              <Kpi label="Total nights required" value={totalNights.toFixed(0)} unit="nights"/>
            </div>
            <div style={{background:"rgba(0,0,0,0.15)",borderRadius:10,border:"1px solid rgba(125,211,200,0.08)",overflow:"hidden"}}>
              <div style={{padding:"12px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:11,letterSpacing:2,color:cl.teal,textTransform:"uppercase",fontWeight:700}}>Replacement Cost per Segment</div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead><tr style={{background:"rgba(255,255,255,0.03)"}}>{["Segment","Grade","Length","Repl. Yr","Cost/ml","Labour/ml","Material/ml","Total cost","Nights"].map(function(h){return <th key={h} style={{padding:"8px 12px",textAlign:"left",color:cl.dim,fontWeight:600,whiteSpace:"nowrap",fontSize:11}}>{h}</th>;})}</tr></thead>
                  <tbody>
                    {segCosts.map(function(s,i){var gc=calcCostPerMl(p,s.grade,weldType,nightHrs,currency,ovhdPct,withGrind,jointSp);return(
                      <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.04)"}}>
                        <td style={{padding:"8px 12px",color:"#e8f4f3",fontWeight:500}}>{s.seg.label}</td>
                        <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.purple}}>{s.grade}</td>
                        <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{s.lengthKm.toFixed(1)} km</td>
                        <td style={{padding:"8px 12px"}}><span style={{color:cl.warn,fontWeight:700}}>Yr {s.repY}</span></td>
                        <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.teal}}>{gc.total.toFixed(0)} {sym}</td>
                        <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{gc.labour.toFixed(0)} {sym}</td>
                        <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{gc.material.toFixed(0)} {sym}</td>
                        <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.amber,fontWeight:700}}>{fmt(s.totalCost)}</td>
                        <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{s.nights.toFixed(0)}</td>
                      </tr>
                    );})}
                  </tbody>
                  <tfoot><tr style={{borderTop:"2px solid rgba(125,211,200,0.2)",background:"rgba(125,211,200,0.04)"}}><td colSpan={7} style={{padding:"10px 12px",color:cl.teal,fontWeight:700,fontSize:12}}>TOTAL</td><td style={{padding:"10px 12px",fontFamily:"monospace",color:cl.teal,fontWeight:800,fontSize:14}}>{fmt(totalCost)}</td><td style={{padding:"10px 12px",fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{totalNights.toFixed(0)}</td></tr></tfoot>
                </table>
              </div>
            </div>
            <div style={{marginTop:10,fontSize:11,color:"#4a6a74",padding:"8px 12px",background:"rgba(0,0,0,0.15)",borderRadius:6}}>Estimates are indicative. Validate unit rates with local contractors before budget submission.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- GRINDING COST DATA AND PANEL ----

var GRIND_MACHINES = {
  small: {
    label: "Small machine (tram / metro)",
    contexts: ["tram","metro"],
    speedMlH: 200,
    ownedRates: {
      stones: 0.8,
      fuel:   0.6,
      maint:  0.5,
      labour: {WEU:45,EEU:22,MENA:14,SSA:10,SEA:11,LATAM:13},
      team:   2,
    },
    subRates: {
      opPerMl:    {WEU:18,EEU:10,MENA:12,SSA:14,SEA:10,LATAM:11},
      mobilFix:   {WEU:2800,EEU:1400,MENA:1800,SSA:2200,SEA:1600,LATAM:1700},
      mobilPerKm: {WEU:4.5,EEU:2.5,MENA:3.5,SSA:4.0,SEA:3.0,LATAM:3.2},
    },
  },
  line: {
    label: "Line machine (ballasted track)",
    contexts: ["metro","heavy"],
    speedMlH: 400,
    ownedRates: {
      stones: 1.4,
      fuel:   1.1,
      maint:  0.9,
      labour: {WEU:52,EEU:26,MENA:16,SSA:12,SEA:13,LATAM:15},
      team:   3,
    },
    subRates: {
      opPerMl:    {WEU:28,EEU:15,MENA:19,SSA:23,SEA:16,LATAM:18},
      mobilFix:   {WEU:6500,EEU:3200,MENA:4200,SSA:5500,SEA:3800,LATAM:4000},
      mobilPerKm: {WEU:7.0,EEU:3.8,MENA:5.5,SSA:6.5,SEA:4.5,LATAM:5.0},
    },
  },
  speno: {
    label: "Specialist machine (Speno / Loram / Vossloh)",
    contexts: ["heavy"],
    speedMlH: 800,
    ownedRates: null,
    subRates: {
      opPerMl:    {WEU:55,EEU:30,MENA:40,SSA:50,SEA:35,LATAM:38},
      mobilFix:   {WEU:18000,EEU:9000,MENA:13000,SSA:17000,SEA:11000,LATAM:12000},
      mobilPerKm: {WEU:12.0,EEU:6.5,MENA:9.0,SSA:11.0,SEA:7.5,LATAM:8.5},
    },
  },
};

function calcGrindCostPerMl(machine, mode, region, nightHrs, passes, currency) {
  var fx = (CURRENCIES[currency]||CURRENCIES.EUR).rate;
  var speedMlH = machine.speedMlH;
  var mlPerNight = nightHrs * speedMlH * 0.70;
  var hPerMl = 1 / speedMlH;

  if (mode === "owned" && machine.ownedRates) {
    var r = machine.ownedRates;
    var lbrRate = (r.labour[region]||r.labour.WEU) * r.team;
    var perMl = (r.stones + r.fuel + r.maint + lbrRate * hPerMl) * passes;
    return { perMl: perMl * fx, mobilFix: 0, mobilPerKm: 0, mlPerNight: mlPerNight, mode: "owned" };
  } else {
    var s = machine.subRates;
    var opPerMl   = (s.opPerMl[region]   || s.opPerMl.WEU)   * passes;
    var mobilFix  = (s.mobilFix[region]  || s.mobilFix.WEU);
    var mobilKm   = (s.mobilPerKm[region]|| s.mobilPerKm.WEU);
    return { perMl: opPerMl * fx, mobilFix: mobilFix * fx, mobilPerKm: mobilKm * fx, mlPerNight: mlPerNight, mode: "sub" };
  }
}

// Stone consumption: stones per km per rail per pass, indexed by machine key then band index (r1..r5)
var STONE_RATES = {
  small: [4.0, 2.5, 1.5, 1.0, 0.8],  // r1 tight -> r5 tangent
  line:  [6.5, 3.8, 2.2, 1.4, 1.2],
  speno: [10.0,6.0, 3.5, 2.2, 2.0],
};
// Grade hardness factor on stone consumption (harder rail = more abrasive = more stones used)
var STONE_GRADE_F = { R200:0.90, R260:1.00, R320Cr:1.15, R350HT:1.30, R400HT:1.45 };
// Typical stone weight (kg) and standard count per head
var STONE_WEIGHT_KG = { small:0.9, line:1.4, speno:2.2 };

function GrindPanel(props) {
  var simResult = props.simResult;
  var horizon   = props.horizon;
  var context   = props.context;

  const [machineKey, setMachine]  = useState("line");
  const [mode,       setMode]     = useState("sub");
  const [region,     setRegion]   = useState("WEU");
  const [currency,   setCurrency] = useState("EUR");
  const [nightHrs,   setNight]    = useState(6);
  const [distKm,     setDist]     = useState(80);
  const [mobilPerInt,setMobil]    = useState(true);
  const [showRates,  setShowRates]= useState(false);
  const [cOpPerMl,   setCOp]      = useState(null);
  const [cMobilFix,  setCMF]      = useState(null);
  const [cMobilKm,   setCMK]      = useState(null);
  const [cStones,    setCStones]  = useState(null);
  const [cFuel,      setCFuel]    = useState(null);
  const [cMaint,     setCMaint]   = useState(null);
  const [cLabour,    setCLabour]  = useState(null);
  const [cSpeedMlH,  setCSpeed]   = useState(null);
  const [showStones, setShowSt]   = useState(false);
  const [stonePriceEur, setStoneP]= useState(null);  // null = no price entered
  const [customStoneRates, setCstR]= useState(null); // null = use presets

  var machine = GRIND_MACHINES[machineKey] || GRIND_MACHINES.line;
  var sym = (CURRENCIES[currency]||CURRENCIES.EUR).symbol;
  var fx  = (CURRENCIES[currency]||CURRENCIES.EUR).rate;
  var hasOwned = !!machine.ownedRates;

  function resetRates() {
    setCOp(null); setCMF(null); setCMK(null);
    setCStones(null); setCFuel(null); setCMaint(null); setCLabour(null); setCSpeed(null);
    setCstR(null);
  }
  function onMachineChange(k) { setMachine(k); resetRates(); }
  function onRegionChange(r)  { setRegion(r);  resetRates(); }

  // Build effective rates object merging preset with any custom overrides
  function getEffectiveMachine() {
    var m = machine;
    var baseSpeed = cSpeedMlH !== null ? cSpeedMlH : m.speedMlH;
    var eff = Object.assign({}, m, { speedMlH: baseSpeed });
    if (mode === "owned" && m.ownedRates) {
      var or = m.ownedRates;
      eff.ownedRates = {
        stones: cStones  !== null ? cStones  : or.stones,
        fuel:   cFuel    !== null ? cFuel    : or.fuel,
        maint:  cMaint   !== null ? cMaint   : or.maint,
        team:   or.team,
        labour: Object.assign({}, or.labour, cLabour !== null ? {[region]: cLabour} : {}),
      };
    } else {
      var sr = m.subRates;
      eff.subRates = {
        opPerMl:    Object.assign({}, sr.opPerMl,    cOpPerMl  !== null ? {[region]: cOpPerMl}  : {}),
        mobilFix:   Object.assign({}, sr.mobilFix,   cMobilFix !== null ? {[region]: cMobilFix} : {}),
        mobilPerKm: Object.assign({}, sr.mobilPerKm, cMobilKm  !== null ? {[region]: cMobilKm}  : {}),
      };
    }
    return eff;
  }

  function fmt(v) {
    if (v >= 1e6) return (v/1e6).toFixed(2)+"M "+sym;
    if (v >= 1e3) return (v/1e3).toFixed(1)+"k "+sym;
    return v.toFixed(0)+" "+sym;
  }

  var segRows = simResult ? simResult.results.map(function(r) {
    var passes = r.data.reduce(function(a,d){return a+d.ground;},0);
    if (passes === 0) return null;
    var avgPasses = passes > 0 ? (r.gCount > 0 ? 1 : 1) : 1;
    var c = calcGrindCostPerMl(getEffectiveMachine(), mode, region, nightHrs, 1, currency);
    var lengthMl = (r.seg.lengthKm||0) * 1000;
    var opCost   = c.perMl * lengthMl * passes;
    var mobilCost = mobilPerInt
      ? (c.mobilFix + c.mobilPerKm * distKm) * passes
      : (c.mobilFix + c.mobilPerKm * distKm);
    var totalCost = opCost + mobilCost;
    var mlPerNight = c.mlPerNight;
    var nightsPerGrind = lengthMl / mlPerNight;
    return {
      seg:         r.seg,
      passes:      passes,
      lengthKm:    r.seg.lengthKm||0,
      opCost:      opCost,
      mobilCost:   mobilCost,
      totalCost:   totalCost,
      perMl:       c.perMl,
      mobilPerInt: c.mobilFix + c.mobilPerKm * distKm,
      nightsPerGrind: nightsPerGrind,
      totalNights: nightsPerGrind * passes,
    };
  }).filter(Boolean) : [];

  var totalOp     = segRows.reduce(function(a,s){return a+s.opCost;},0);
  var totalMobil  = segRows.reduce(function(a,s){return a+s.mobilCost;},0);
  var totalGrind  = segRows.reduce(function(a,s){return a+s.totalCost;},0);
  var totalNights = segRows.reduce(function(a,s){return a+s.totalNights;},0);
  var totalPasses = segRows.reduce(function(a,s){return a+s.passes;},0);

  // Stone consumption per segment
  var stoneRows = simResult ? simResult.results.map(function(r) {
    if (!r.data) return null;
    var passes = r.data.reduce(function(a,d){return a+d.ground;},0);
    if (passes === 0) return null;
    var grade  = r.seg.grade || r.seg.railGrade || "R260";
    var gradF  = STONE_GRADE_F[grade] || 1.0;
    // Find band index for this segment's radius
    var rb     = BANDS.find(function(b){return (r.seg.repr||r.seg.radius||9999)>=b.rMin&&(r.seg.repr||r.seg.radius||9999)<b.rMax;}) || BANDS[4];
    var ri     = BANDS.indexOf(rb);
    // Base rate per km per rail per pass (x2 for both rails)
    var baseRates = customStoneRates || STONE_RATES[machineKey] || STONE_RATES.line;
    var baseRate  = baseRates[ri] || baseRates[4];
    var ratePerKmPerPass = baseRate * gradF * 2; // both rails
    var lengthKm = r.seg.lengthKm || 0;
    var stonesPerPass  = ratePerKmPerPass * lengthKm;
    var totalStones    = stonesPerPass * passes;
    var stoneWt        = STONE_WEIGHT_KG[machineKey] || 1.4;
    var totalWeightKg  = totalStones * stoneWt;
    var totalCostStones = stonePriceEur !== null ? totalStones * stonePriceEur * fx : null;
    return {
      seg:            r.seg,
      grade:          grade,
      lengthKm:       lengthKm,
      passes:         passes,
      ratePerKmPerPass: ratePerKmPerPass,
      stonesPerPass:  stonesPerPass,
      totalStones:    totalStones,
      totalWeightKg:  totalWeightKg,
      totalCostStones: totalCostStones,
    };
  }).filter(Boolean) : [];

  var grandTotalStones = stoneRows.reduce(function(a,s){return a+s.totalStones;},0);
  var grandTotalStCost = stonePriceEur !== null
    ? stoneRows.reduce(function(a,s){return a+(s.totalCostStones||0);},0)
    : null;

  var mobilOnce = calcGrindCostPerMl(getEffectiveMachine(), mode, region, nightHrs, 1, currency);
  var mobilCostOnce = (mobilOnce.mobilFix + mobilOnce.mobilPerKm * distKm);

  var machineOpts = Object.keys(GRIND_MACHINES).filter(function(k){
    return GRIND_MACHINES[k].contexts.indexOf(context) >= 0 || true;
  }).map(function(k){return {v:k,l:GRIND_MACHINES[k].label};});

  return (
    <div style={{display:"grid",gridTemplateColumns:"280px 1fr",gap:16}}>

      <div style={{overflowY:"auto",maxHeight:660,paddingRight:8}}>
        <div style={{marginBottom:12}}>
          <Lbl>Machine type</Lbl>
          <Sel value={machineKey} onChange={onMachineChange} opts={machineOpts}/>
          <div style={{fontSize:11,color:cl.dim,marginTop:5,lineHeight:1.5}}>
            {machineKey==="small"&&"Suitable for tram, metro, tight-curve track. ~200 ml/h grinding speed."}
            {machineKey==="line"&&"Standard ballasted-track machine. ~400 ml/h. Owned or subcontracted."}
            {machineKey==="speno"&&"High-output specialist (Speno/Loram/Vossloh). Subcontract only. ~800 ml/h."}
          </div>
        </div>

        <div style={{marginBottom:12}}>
          <Lbl>Operating mode</Lbl>
          <div style={{display:"flex",gap:8}}>
            <Btn onClick={function(){setMode("owned");}} active={mode==="owned"} sm={true}>Own fleet</Btn>
            <Btn onClick={function(){setMode("sub");}}   active={mode==="sub"}   sm={true}>Subcontract</Btn>
          </div>
          {mode==="owned"&&!hasOwned&&(
            <div style={{fontSize:11,color:cl.warn,marginTop:6,padding:"6px 10px",background:"rgba(248,113,113,0.08)",borderRadius:6}}>Specialist machines (Speno/Loram) are subcontract only</div>
          )}
        </div>

        <div style={{marginBottom:12}}>
          <Lbl>Region preset</Lbl>
          <Sel value={region} onChange={onRegionChange} opts={Object.keys(REGIONS).filter(function(k){return k!=="CUSTOM";}).map(function(k){return {v:k,l:REGIONS[k].label};})}/>
        </div>

        <div style={{marginBottom:12}}>
          <Lbl>Display currency</Lbl>
          <Sel value={currency} onChange={setCurrency} opts={Object.keys(CURRENCIES).map(function(k){return {v:k,l:CURRENCIES[k].label};})}/>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          <div><Lbl>Night window (h)</Lbl><Inp value={nightHrs} onChange={setNight} min={2} max={10} step={0.5}/></div>
          {mode==="sub"&&<div><Lbl>Distance from depot (km)</Lbl><Inp value={distKm} onChange={setDist} min={0} max={2000}/></div>}
        </div>

        {mode==="sub"&&(
          <div style={{marginBottom:12}}>
            <Lbl>Mobilisation cost</Lbl>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={function(){setMobil(true);}}  active={mobilPerInt}  sm={true}>Per intervention</Btn>
              <Btn onClick={function(){setMobil(false);}} active={!mobilPerInt} sm={true}>Once per horizon</Btn>
            </div>
            <div style={{fontSize:11,color:cl.dim,marginTop:5,lineHeight:1.5}}>
              {mobilPerInt?"Mobilisation charged for each grinding pass (realistic for one-off contracts)":"Mobilisation charged once total (long-term framework contract)"}
            </div>
          </div>
        )}

        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:10,padding:12,border:"1px solid rgba(125,211,200,0.1)",marginTop:8}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:showRates?10:0}}>
            <div style={{fontSize:11,color:cl.teal,fontWeight:700,letterSpacing:1}}>UNIT RATES</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              {(cOpPerMl!==null||cMobilFix!==null||cMobilKm!==null||cStones!==null||cFuel!==null||cMaint!==null||cLabour!==null||cSpeedMlH!==null)&&(
                <span onClick={resetRates} style={{fontSize:10,color:cl.warn,cursor:"pointer",padding:"2px 8px",background:"rgba(248,113,113,0.1)",borderRadius:4,border:"1px solid rgba(248,113,113,0.25)"}}>Reset to preset</span>
              )}
              <div onClick={function(){setShowRates(function(v){return !v;});}} style={{fontSize:10,color:cl.dim,cursor:"pointer",padding:"2px 8px",background:"rgba(255,255,255,0.04)",borderRadius:4}}>
                {showRates?"collapse":"edit rates"}
              </div>
            </div>
          </div>

          {!showRates&&(
            <div>
              <div style={{fontSize:12,color:cl.dim,marginBottom:4}}>Operation cost: <b style={{color:cl.teal}}>{calcGrindCostPerMl(getEffectiveMachine(),mode,region,nightHrs,1,currency).perMl.toFixed(2)} {sym}/ml/pass</b></div>
              {mode==="sub"&&<div style={{fontSize:12,color:cl.dim,marginBottom:4}}>Mobilisation (fixed): <b style={{color:cl.amber}}>{fmt(mobilOnce.mobilFix)}</b></div>}
              {mode==="sub"&&<div style={{fontSize:12,color:cl.dim,marginBottom:4}}>Mobilisation (distance): <b style={{color:cl.amber}}>{mobilOnce.mobilPerKm.toFixed(1)} {sym}/km x {distKm} km = {fmt(mobilOnce.mobilPerKm*distKm)}</b></div>}
              {mode==="sub"&&<div style={{fontSize:12,color:cl.dim,marginBottom:4}}>Total mobilisation: <b style={{color:cl.amber}}>{fmt(mobilCostOnce)}</b></div>}
              <div style={{fontSize:12,color:cl.dim}}>Productivity: <b style={{color:cl.teal}}>{calcGrindCostPerMl(getEffectiveMachine(),mode,region,nightHrs,1,currency).mlPerNight.toFixed(0)} ml/night</b></div>
            </div>
          )}

          {showRates&&(
            <div style={{display:"grid",gap:6}}>
              <div style={{fontSize:11,color:"#4a6a74",marginBottom:4,padding:"4px 8px",background:"rgba(125,211,200,0.04)",borderRadius:4}}>
                Preset values shown. Edit any field to override for this calculation.
              </div>

              {mode==="sub"&&(
                <div>
                  <div style={{fontSize:11,color:cl.dim,fontWeight:600,marginBottom:6,marginTop:4}}>Subcontract rates</div>
                  <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6,marginBottom:6}}>
                    <span style={{fontSize:11,color:cl.dim}}>Operation (per ml/pass)</span>
                    <input type="number" value={cOpPerMl!==null?cOpPerMl:(machine.subRates.opPerMl[region]||machine.subRates.opPerMl.WEU)} min={0} step={0.5}
                      onChange={function(e){setCOp(+e.target.value);}}
                      style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                    <span style={{fontSize:11,color:cl.muted}}>EUR/ml/pass</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6,marginBottom:6}}>
                    <span style={{fontSize:11,color:cl.dim}}>Mobilisation fixed fee</span>
                    <input type="number" value={cMobilFix!==null?cMobilFix:(machine.subRates.mobilFix[region]||machine.subRates.mobilFix.WEU)} min={0} step={100}
                      onChange={function(e){setCMF(+e.target.value);}}
                      style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                    <span style={{fontSize:11,color:cl.muted}}>EUR/intervention</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6,marginBottom:6}}>
                    <span style={{fontSize:11,color:cl.dim}}>Mobilisation per km</span>
                    <input type="number" value={cMobilKm!==null?cMobilKm:(machine.subRates.mobilPerKm[region]||machine.subRates.mobilPerKm.WEU)} min={0} step={0.5}
                      onChange={function(e){setCMK(+e.target.value);}}
                      style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                    <span style={{fontSize:11,color:cl.muted}}>EUR/km</span>
                  </div>
                </div>
              )}

              {mode==="owned"&&machine.ownedRates&&(
                <div>
                  <div style={{fontSize:11,color:cl.dim,fontWeight:600,marginBottom:6,marginTop:4}}>Own fleet rates (per ml per pass)</div>
                  <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6,marginBottom:6}}>
                    <span style={{fontSize:11,color:cl.dim}}>Grinding stones</span>
                    <input type="number" value={cStones!==null?cStones:machine.ownedRates.stones} min={0} step={0.1}
                      onChange={function(e){setCStones(+e.target.value);}}
                      style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                    <span style={{fontSize:11,color:cl.muted}}>EUR/ml</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6,marginBottom:6}}>
                    <span style={{fontSize:11,color:cl.dim}}>Fuel / energy</span>
                    <input type="number" value={cFuel!==null?cFuel:machine.ownedRates.fuel} min={0} step={0.1}
                      onChange={function(e){setCFuel(+e.target.value);}}
                      style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                    <span style={{fontSize:11,color:cl.muted}}>EUR/ml</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6,marginBottom:6}}>
                    <span style={{fontSize:11,color:cl.dim}}>Maintenance</span>
                    <input type="number" value={cMaint!==null?cMaint:machine.ownedRates.maint} min={0} step={0.1}
                      onChange={function(e){setCMaint(+e.target.value);}}
                      style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                    <span style={{fontSize:11,color:cl.muted}}>EUR/ml</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6,marginBottom:6}}>
                    <span style={{fontSize:11,color:cl.dim}}>Labour rate (fully loaded)</span>
                    <input type="number" value={cLabour!==null?cLabour:(machine.ownedRates.labour[region]||machine.ownedRates.labour.WEU)} min={0} step={1}
                      onChange={function(e){setCLabour(+e.target.value);}}
                      style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                    <span style={{fontSize:11,color:cl.muted}}>EUR/h/person</span>
                  </div>
                </div>
              )}

              <div style={{borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:8,marginTop:4}}>
                <div style={{fontSize:11,color:cl.dim,fontWeight:600,marginBottom:6}}>Machine productivity</div>
                <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6}}>
                  <span style={{fontSize:11,color:cl.dim}}>Grinding speed</span>
                  <input type="number" value={cSpeedMlH!==null?cSpeedMlH:machine.speedMlH} min={50} max={2000} step={10}
                    onChange={function(e){setCSpeed(+e.target.value);}}
                    style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                  <span style={{fontSize:11,color:cl.muted}}>ml/h</span>
                </div>
                <div style={{fontSize:10,color:"#4a6a74",marginTop:4}}>Night productivity = speed x window x 70% efficiency = <b style={{color:cl.teal}}>{calcGrindCostPerMl(getEffectiveMachine(),mode,region,nightHrs,1,currency).mlPerNight.toFixed(0)} ml/night</b></div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        {!simResult&&(
          <div style={{background:"rgba(0,0,0,0.15)",borderRadius:10,padding:24,textAlign:"center",color:"#4a6a74",border:"1px dashed rgba(125,211,200,0.1)"}}>Run the simulation first to compute grinding costs</div>
        )}
        {simResult&&segRows.length===0&&(
          <div style={{background:"rgba(78,222,128,0.06)",border:"1px solid rgba(78,222,128,0.2)",borderRadius:10,padding:16,textAlign:"center",color:cl.green,fontSize:13}}>No grinding interventions scheduled in this simulation</div>
        )}
        {simResult&&segRows.length>0&&(
          <div>
            <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
              <Kpi label="Total grinding cost" value={fmt(totalGrind)} unit=""/>
              <Kpi label={"Annualised over "+horizon+"yr"} value={fmt(totalGrind/horizon)} unit="/yr"/>
              <Kpi label="Total passes (all segs)" value={totalPasses} unit="passes"/>
              <Kpi label="Total nights required" value={totalNights.toFixed(0)} unit="nights"/>
            </div>

            {mode==="sub"&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
                <div style={{background:"rgba(0,0,0,0.2)",borderRadius:10,padding:14,border:"1px solid rgba(125,211,200,0.1)"}}>
                  <div style={{fontSize:11,color:cl.dim,marginBottom:6}}>Operation cost (total)</div>
                  <div style={{fontSize:18,fontWeight:700,color:cl.teal,fontFamily:"monospace"}}>{fmt(totalOp)}</div>
                  <div style={{fontSize:11,color:cl.dim,marginTop:4}}>{((totalOp/totalGrind)*100).toFixed(0)}% of total grinding cost</div>
                </div>
                <div style={{background:"rgba(0,0,0,0.2)",borderRadius:10,padding:14,border:"1px solid rgba(125,211,200,0.1)"}}>
                  <div style={{fontSize:11,color:cl.dim,marginBottom:6}}>Mobilisation cost (total)</div>
                  <div style={{fontSize:18,fontWeight:700,color:cl.amber,fontFamily:"monospace"}}>{fmt(totalMobil)}</div>
                  <div style={{fontSize:11,color:cl.dim,marginTop:4}}>{((totalMobil/totalGrind)*100).toFixed(0)}% of total grinding cost</div>
                </div>
                <div style={{background:"rgba(0,0,0,0.2)",borderRadius:10,padding:14,border:"1px solid rgba(125,211,200,0.1)"}}>
                  <div style={{fontSize:11,color:cl.dim,marginBottom:6}}>Avg. cost per intervention</div>
                  <div style={{fontSize:18,fontWeight:700,color:cl.purple,fontFamily:"monospace"}}>{totalPasses>0?fmt(totalGrind/totalPasses):"-"}</div>
                  <div style={{fontSize:11,color:cl.dim,marginTop:4}}>across {totalPasses} total passes</div>
                </div>
              </div>
            )}

            <div style={{background:"rgba(0,0,0,0.15)",borderRadius:10,border:"1px solid rgba(125,211,200,0.08)",overflow:"hidden",marginBottom:12}}>
              <div style={{padding:"12px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:11,letterSpacing:2,color:cl.teal,textTransform:"uppercase",fontWeight:700}}>Grinding Cost per Segment</div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:"rgba(255,255,255,0.03)"}}>
                      {["Segment","Length","Total passes","Cost/ml/pass",mode==="sub"?"Mobil. cost":"",mode==="sub"?"Op. cost":"","Total cost","Nights/pass","Total nights"].filter(Boolean).map(function(h){return <th key={h} style={{padding:"8px 12px",textAlign:"left",color:cl.dim,fontWeight:600,whiteSpace:"nowrap",fontSize:11}}>{h}</th>;})}
                    </tr>
                  </thead>
                  <tbody>
                    {segRows.map(function(s,i){return(
                      <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.04)"}}>
                        <td style={{padding:"8px 12px",color:"#e8f4f3",fontWeight:500}}>{s.seg.label}</td>
                        <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{s.lengthKm.toFixed(1)} km</td>
                        <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.teal}}>{s.passes}</td>
                        <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{s.perMl.toFixed(2)} {sym}</td>
                        {mode==="sub"&&<td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.amber}}>{fmt(s.mobilCost)}</td>}
                        {mode==="sub"&&<td style={{padding:"8px 12px",fontFamily:"monospace"}}>{fmt(s.opCost)}</td>}
                        <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.amber,fontWeight:700}}>{fmt(s.totalCost)}</td>
                        <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{s.nightsPerGrind.toFixed(1)}</td>
                        <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{s.totalNights.toFixed(0)}</td>
                      </tr>
                    );})}
                  </tbody>
                  <tfoot>
                    <tr style={{borderTop:"2px solid rgba(125,211,200,0.2)",background:"rgba(125,211,200,0.04)"}}>
                      <td colSpan={mode==="sub"?5:3} style={{padding:"10px 12px",color:cl.teal,fontWeight:700,fontSize:12}}>TOTAL</td>
                      {mode==="sub"&&<td style={{padding:"10px 12px",fontFamily:"monospace",color:cl.amber,fontWeight:700}}>{fmt(totalMobil)}</td>}
                      {mode==="sub"&&<td style={{padding:"10px 12px",fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{fmt(totalOp)}</td>}
                      <td style={{padding:"10px 12px",fontFamily:"monospace",color:cl.teal,fontWeight:800,fontSize:14}}>{fmt(totalGrind)}</td>
                      <td></td>
                      <td style={{padding:"10px 12px",fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{totalNights.toFixed(0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div style={{background:"rgba(0,0,0,0.15)",borderRadius:10,border:"1px solid rgba(125,211,200,0.08)",overflow:"hidden",marginBottom:12}}>
              <div
                onClick={function(){setShowSt(function(v){return !v;});}}
                style={{padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",borderBottom:showStones?"1px solid rgba(255,255,255,0.06)":"none"}}
              >
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{fontSize:11,letterSpacing:2,color:cl.teal,textTransform:"uppercase",fontWeight:700}}>Grinding Stone Consumption</div>
                  <div style={{display:"flex",gap:8}}>
                    <span style={{fontSize:12,color:cl.text,fontFamily:"monospace",background:"rgba(125,211,200,0.08)",padding:"2px 8px",borderRadius:4}}>
                      {grandTotalStones.toFixed(0)} stones total
                    </span>
                    {grandTotalStCost !== null && (
                      <span style={{fontSize:12,color:cl.amber,fontFamily:"monospace",background:"rgba(251,191,36,0.08)",padding:"2px 8px",borderRadius:4}}>
                        {fmt(grandTotalStCost)}
                      </span>
                    )}
                  </div>
                </div>
                <span style={{fontSize:10,color:cl.dim}}>{showStones?"collapse":"expand"}</span>
              </div>

              {showStones && (
                <div style={{padding:"14px 16px"}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
                    <div style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"10px 14px"}}>
                      <div style={{fontSize:10,color:cl.dim,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Stones / km / pass</div>
                      <div style={{fontSize:16,fontWeight:700,color:cl.teal,fontFamily:"monospace"}}>
                        {stoneRows.length>0?(stoneRows.reduce(function(a,s){return a+s.ratePerKmPerPass*s.lengthKm;},0)/stoneRows.reduce(function(a,s){return a+s.lengthKm;},0)).toFixed(1):"-"}
                        <span style={{fontSize:11,fontWeight:400,marginLeft:4,color:cl.muted}}>stones/km/pass</span>
                      </div>
                      <div style={{fontSize:10,color:"#4a6a74",marginTop:4}}>weighted avg, both rails</div>
                    </div>
                    <div style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"10px 14px"}}>
                      <div style={{fontSize:10,color:cl.dim,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Total stones (horizon)</div>
                      <div style={{fontSize:16,fontWeight:700,color:cl.teal,fontFamily:"monospace"}}>
                        {grandTotalStones.toFixed(0)}
                        <span style={{fontSize:11,fontWeight:400,marginLeft:4,color:cl.muted}}>stones</span>
                      </div>
                      <div style={{fontSize:10,color:"#4a6a74",marginTop:4}}>{(grandTotalStones*(STONE_WEIGHT_KG[machineKey]||1.4)/1000).toFixed(1)} tonnes of abrasive</div>
                    </div>
                    <div style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"10px 14px"}}>
                      <div style={{fontSize:10,color:cl.dim,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Stone cost (total)</div>
                      {grandTotalStCost !== null ? (
                        <div style={{fontSize:16,fontWeight:700,color:cl.amber,fontFamily:"monospace"}}>{fmt(grandTotalStCost)}</div>
                      ) : (
                        <div style={{fontSize:12,color:"#4a6a74"}}>Enter unit price below</div>
                      )}
                    </div>
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                    <div>
                      <Lbl>Unit price per stone (optional)</Lbl>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <input type="number" value={stonePriceEur!==null?stonePriceEur:""} min={0} step={0.5}
                          placeholder={"e.g. 8.5 EUR"}
                          onChange={function(e){setStoneP(e.target.value===""?null:+e.target.value);}}
                          style={Object.assign({},iS,{flex:1})}/>
                        <span style={{fontSize:11,color:cl.muted,whiteSpace:"nowrap"}}>{sym}/stone</span>
                        {stonePriceEur!==null&&<span onClick={function(){setStoneP(null);}} style={{fontSize:10,color:cl.warn,cursor:"pointer",whiteSpace:"nowrap"}}>clear</span>}
                      </div>
                      <div style={{fontSize:10,color:"#4a6a74",marginTop:4}}>Typical range: 5-20 {sym}/stone depending on type and supplier</div>
                    </div>
                    <div>
                      <Lbl>Custom consumption rate (stones/km/pass/rail)  -  overrides presets</Lbl>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <input type="number" value={customStoneRates!==null?customStoneRates[2]:""}
                          min={0} step={0.1} placeholder={"preset: "+((STONE_RATES[machineKey]||STONE_RATES.line)[2]).toFixed(1)+" (R200-400m)"}
                          onChange={function(e){
                            if(e.target.value===""){setCstR(null);return;}
                            var v=+e.target.value;
                            var base=STONE_RATES[machineKey]||STONE_RATES.line;
                            var ratio=v/base[2];
                            setCstR(base.map(function(b){return +(b*ratio).toFixed(2);}));
                          }}
                          style={Object.assign({},iS,{flex:1})}/>
                        <span style={{fontSize:11,color:cl.muted,whiteSpace:"nowrap"}}>stones/km/pass/rail</span>
                        {customStoneRates!==null&&<span onClick={function(){setCstR(null);}} style={{fontSize:10,color:cl.warn,cursor:"pointer",whiteSpace:"nowrap"}}>reset</span>}
                      </div>
                      <div style={{fontSize:10,color:"#4a6a74",marginTop:4}}>Enter your measured rate for R200-400m  -  other bands scale proportionally</div>
                    </div>
                  </div>

                  <div style={{fontSize:11,color:cl.dim,marginBottom:8}}>
                    Preset rates ({machineKey==="small"?"small tram/metro":machineKey==="line"?"line machine":"Speno/Loram"})  -  both rails:
                    {["R<100m","R100-200","R200-400","R400-800","Tangent"].map(function(lbl,i){
                      var r=(customStoneRates||(STONE_RATES[machineKey]||STONE_RATES.line));
                      return <span key={i} style={{marginLeft:8,fontFamily:"monospace",color:cl.teal}}>{lbl}: <b>{(r[i]*2).toFixed(1)}</b></span>;
                    })}
                  </div>

                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                      <thead>
                        <tr style={{background:"rgba(255,255,255,0.03)"}}>
                          {["Segment","Grade","Length","Passes","Rate (stones/km/pass)","Stones/pass","Total stones","Weight (kg)","Stone cost"].map(function(h){
                            return <th key={h} style={{padding:"8px 12px",textAlign:"left",color:cl.dim,fontWeight:600,whiteSpace:"nowrap",fontSize:11}}>{h}</th>;
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {stoneRows.map(function(s,i){return(
                          <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.04)"}}>
                            <td style={{padding:"8px 12px",color:"#e8f4f3",fontWeight:500}}>{s.seg.label}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.purple}}>{s.grade}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{s.lengthKm.toFixed(1)} km</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.teal}}>{s.passes}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{s.ratePerKmPerPass.toFixed(1)}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{s.stonesPerPass.toFixed(0)}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{s.totalStones.toFixed(0)}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{s.totalWeightKg.toFixed(0)} kg</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.amber}}>{s.totalCostStones!==null?fmt(s.totalCostStones):"-"}</td>
                          </tr>
                        );})}
                      </tbody>
                      <tfoot>
                        <tr style={{borderTop:"2px solid rgba(125,211,200,0.2)",background:"rgba(125,211,200,0.04)"}}>
                          <td colSpan={6} style={{padding:"10px 12px",color:cl.teal,fontWeight:700,fontSize:12}}>TOTAL</td>
                          <td style={{padding:"10px 12px",fontFamily:"monospace",color:cl.teal,fontWeight:800,fontSize:14}}>{grandTotalStones.toFixed(0)}</td>
                          <td style={{padding:"10px 12px",fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{(grandTotalStones*(STONE_WEIGHT_KG[machineKey]||1.4)).toFixed(0)} kg</td>
                          <td style={{padding:"10px 12px",fontFamily:"monospace",color:cl.amber,fontWeight:700}}>{grandTotalStCost!==null?fmt(grandTotalStCost):"-"}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div style={{marginTop:10,fontSize:11,color:"#4a6a74",lineHeight:1.6}}>
                    Stone consumption factors: radius band (tight curves use 5-8x more stones than tangent), rail grade hardness (R400HT uses 45% more stones than R260). Grade factors: R260=1.0, R320Cr=1.15, R350HT=1.30, R400HT=1.45. Both rails included. Sources: Speno International technical bulletins; Loram Technologies field data; Vossloh Rail Services application guides.
                  </div>
                </div>
              )}
            </div>

            <div style={{background:"rgba(125,211,200,0.04)",border:"1px solid rgba(125,211,200,0.15)",borderRadius:10,padding:14,marginBottom:8}}>
              <div style={{fontSize:11,color:cl.teal,fontWeight:700,marginBottom:8,letterSpacing:1}}>LIFECYCLE COST SUMMARY ({horizon} yr horizon)</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
                {[
                  ["Grinding cost",  totalGrind,   cl.teal],
                  ["Replacement cost","?",          cl.amber],
                  ["Total lifecycle","?",            cl.purple],
                ].map(function(item,i){return(
                  <div key={i} style={{textAlign:"center",padding:"10px 0"}}>
                    <div style={{fontSize:11,color:cl.dim,marginBottom:6}}>{item[0]}</div>
                    <div style={{fontSize:16,fontWeight:700,color:item[2],fontFamily:"monospace"}}>{typeof item[1]==="number"?fmt(item[1]):item[1]}</div>
                    {i>0&&<div style={{fontSize:10,color:"#4a6a74",marginTop:3}}>Switch to Replacement Cost tab</div>}
                  </div>
                );})}
              </div>
            </div>

            <div style={{fontSize:11,color:"#4a6a74",padding:"8px 12px",background:"rgba(0,0,0,0.15)",borderRadius:6}}>
              Rates calibrated from Speno/Loram published data and infrastructure manager reports (RFI 2022, Infrabel 2023). Validate with local contractor quotes before budget submission.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- HELP MODAL ----

var HELP=[
  {id:"overview",title:"Overview",
   body:"Rail Wear and Maintenance Simulator v1.1 - Created by Mohamed BOUDIA.\n\nPURPOSE: Estimates rail wear progression, grinding cycles, replacement timelines, and full lifecycle costs (replacement + grinding + stones) for tram, metro/LRT, and heavy rail.\n\nPHYSICS ENGINE: Archard wear model (1953) + Eisenmann dynamic load formula + RCF damage accumulation.\n\nCALIBRATION: Infrabel/TU Delft 2023 big-data study (5338 km, Belgium 2012-2019) and Guangzhou Metro field measurements (2021-2022, China).\n\nCONTEXTS: Tram (Q_ref=10t), Metro/LRT (Q_ref=15t), Heavy rail (Q_ref=22.5t). Each radius band simulated independently on annual time step.\n\nSTANDARDS: EN 13674-1:2011 (wear limits), UIC 714R (defect inspection), EN 15692 (gauge corner contact), prEN 17343 (rail grinding spec).",
   links:[
     {label:"EN 13674-1:2011 - Rail profiles and wear limits",url:"https://www.en-standard.eu/bs-en-13674-1-2011-railway-applications-track-rail/",type:"standard"},
     {label:"UIC 714R - Rail defect catalogue",url:"https://uic.org/IMG/pdf/714r.pdf",type:"standard"},
     {label:"prEN 17343 - Rail grinding specification (CEN)",url:"https://standards.cen.eu/dyn/www/f?p=204:110:0::::FSP_PROJECT:67843",type:"standard"},
   ]
  },
  {id:"mgt",title:"MGT - Traffic Loading",
   body:"DEFINITION: Gross MGT/yr = (Passes/day x Axle load x Bogies x Axles/bogie x 365) / 1,000,000. Multiple train types summed linearly.\n\nEQUIVALENT MGT (damage): MGT_eq = MGT x (Q_axle / Q_ref)^3. A 20t axle causes ~8x more wear than a 10t axle at same gross tonnage. Exponent n=3 for wear (Archard), n=4 for fatigue/RCF.\n\nPARAMETER IMPACTS:\n- Passes/day: direct linear effect. Doubling passes = doubling wear.\n- Axle load: cubic effect via equivalent MGT. +10% axle load = +33% wear damage. Most sensitive parameter.\n- Bogies x Axles/bogie: linear effect on total axle passes.\n\nREFERENCE LOADS: Tram=10t, Metro=15t, Heavy=22.5t (mixed freight/passenger).",
   links:[
     {label:"Archard J.F. (1953) - Contact and Rubbing of Flat Surfaces, J.Applied Physics 24(8)",url:"https://doi.org/10.1063/1.1721448",type:"paper"},
     {label:"IHHA Wheel-Rail Interface Guidelines, 5th ed. (2019)",url:"https://www.ihha.net/",type:"standard"},
     {label:"EN 13674-1:2011 Annex A - Load equivalence",url:"https://www.en-standard.eu/bs-en-13674-1-2011-railway-applications-track-rail/",type:"standard"},
   ]
  },
  {id:"radius",title:"Radius Bands and Wear Factors",
   body:"CONCEPT: Five radius bands define vertical multiplier f_V and lateral multiplier f_L relative to tangent (r5, R>=800m = 1.0 reference).\n\nBAND TABLE (f_V / f_L):\n- r1: R<100m       6.0 / 15.0  Severe flange/gauge face contact\n- r2: R100-200m    4.0 / 9.0   Significant lateral creep\n- r3: R200-400m    2.5 / 5.0   Mixed wear modes\n- r4: R400-800m    1.5 / 2.5   Mostly crown contact\n- r5: R>=800m      1.0 / 1.0   Tangent reference\n\nIMPACT: Wrong band = 50-300% error. Wrong representative radius within band = 5-15% error. Rail grade hardness benefit is progressively capped on tighter curves: R400HT saves 38% on tangent but only 14% on R<150m.",
   links:[
     {label:"Infrabel/TU Delft (2023) - Big-data analysis of rail wear, Wear 522",url:"https://doi.org/10.1016/j.wear.2022.204764",type:"paper"},
     {label:"Magel et al. (2017) - Wheel-Rail Tribology, Elsevier",url:"https://doi.org/10.1016/B978-0-12-809819-4.00001-X",type:"paper"},
     {label:"EN 13231-3:2012 - Inspection and acceptance of rail grinding",url:"https://standards.cen.eu/dyn/www/f?p=204:110:0::::FSP_PROJECT:28028",type:"standard"},
   ]
  },
  {id:"wear",title:"Wear Rate Model",
   body:"BASE RATE: 0.82 mm/100MGT vertical crown wear. R260 grade, tangent, ballasted track, 80 km/h. Source: Infrabel/TU Delft 2023 (5338 km statistical analysis).\n\nFORMULA:\nwearRate_V = 0.82 x f_V(band) x hardnessEffect x f_railType x f_trackForm x f_speed\nwearRate_L = 1.00 x 1.5 x f_L(band) x hardnessEffect x f_railType x f_trackForm x f_speed x f_lubr\nhardnessEffect = 1 - (1 - f_wear_grade) / (1 + f_L x 0.3)  [caps hardness benefit in tight curves]\n\nPARAMETER IMPACTS:\n- Rail grade: R400HT saves 38% on tangent, only 14% on R<150m. Most effective on gentle curves.\n- Rail type: Groove +20% vertical, +80% lateral vs vignole.\n- Track form: Slab +10-15%, Embedded +15-20% vs ballasted.\n- Speed: <40 km/h = -10% vertical. >120 km/h = +10-35% vertical.",
   links:[
     {label:"Infrabel/TU Delft (2023) - Full paper, Wear 522",url:"https://doi.org/10.1016/j.wear.2022.204764",type:"paper"},
     {label:"Esveld C. (2001) - Modern Railway Track, 2nd ed.",url:"https://www.mrt-productions.nl/",type:"book"},
     {label:"Magel E. (2011) - Rolling Contact Fatigue: A Comprehensive Review, NRCC/FRA",url:"https://railroads.dot.gov/sites/fra.dot.gov/files/fra_net/15009/Magel_RCF_Review_2011.pdf",type:"paper"},
   ]
  },
  {id:"rcf",title:"RCF - Rolling Contact Fatigue",
   body:"DEFINITION: Cyclic plastic deformation at wheel-rail contact causing surface/sub-surface crack initiation. RCF index (0 to 1) = accumulated damage relative to failure threshold.\n\nRCF PARADOX (magic wear rate): Moderate curves (r4, R400-800m) have HIGHER RCF than tight curves (r1). Tight curves wear fast enough to remove the crack layer before propagation. Moderate curves initiate cracks but lack sufficient wear to remove them.\n\nRCF THRESHOLDS:\n- 0.0-0.3: Healthy - preventive grinding sufficient\n- 0.3-0.7: Moderate - corrective grinding required\n- 0.7-1.0: Critical - replacement mandatory (cracks >5-8mm deep)\n\nFORMULA: RCF_increment/yr = rcfBase x MGT x (1 - min(0.80, wearRate/5.0))\nAfter grinding: RCF reduced by passes x rcfReduction x (1 + (1-RCF) x 0.5)",
   links:[
     {label:"Infrabel/Int.J.Fatigue (2025) - 212 instrumented curves analysis",url:"https://doi.org/10.1016/j.ijfatigue.2024.108342",type:"paper"},
     {label:"Ringsberg J.W. (2001) - Life prediction of RCF crack initiation, Int.J.Fatigue 23(7)",url:"https://doi.org/10.1016/S0142-1123(01)00011-5",type:"paper"},
     {label:"Squires G. et al. (2006) - Rolling Contact Fatigue, RSSB T174",url:"https://www.rssb.co.uk/research-catalogue/CatalogueItem/T174",type:"paper"},
     {label:"UIC 712R - Rail defect catalogue (RCF classification)",url:"https://uic.org/IMG/pdf/712r.pdf",type:"standard"},
   ]
  },
  {id:"grinding",title:"Grinding Strategy",
   body:"PREVENTIVE strategy:\n- Interval: base table per band/context (e.g. 20 MGT metro r4, 80 MGT heavy r5)\n- Removal per pass: 0.20 mm | Metal consumed: 0.20 mm/intervention\n- Post-grinding wear factor: 0.75 (restored profile reduces future wear by 25%)\n- RCF reduction per pass: ~30% with health bonus\n- Typical rail life: 400-600 accumulated MGT before replacement\n\nCORRECTIVE strategy:\n- Interval: 3x longer than preventive base\n- Removal: 0.55 mm/pass, up to 4 passes | Metal consumed: up to 2.2 mm/intervention\n- Post-grinding wear factor: 0.92 (partial restoration, -8% future wear)\n- Typical rail life: 200-350 accumulated MGT\n\nKEY: With R350HT (17mm reserve) and corrective strategy, only 7-8 interventions possible before reserve is exhausted (17mm / 2.2mm = 7.7 interventions).",
   links:[
     {label:"Grassie S.L. (2005) - Rail corrugation: measurement, understanding and treatment, Wear 258",url:"https://doi.org/10.1016/j.wear.2004.03.066",type:"paper"},
     {label:"Infrabel - Grinding Management Report (2022)",url:"https://www.infrabel.be/en/rail-safety",type:"report"},
     {label:"EN 13231-3:2012 - Rail grinding acceptance criteria",url:"https://standards.cen.eu/dyn/www/f?p=204:110:0::::FSP_PROJECT:28028",type:"standard"},
     {label:"BNSF Railway - Preventive-gradual grinding programme overview",url:"https://www.bnsf.com/",type:"report"},
   ]
  },
  {id:"lubrication",title:"Flange Lubrication",
   body:"FUNCTION: Reduces flange/gauge face friction. Affects LATERAL wear only. No effect on crown wear or RCF.\n\nFACTORS BY BAND (r1 R<100m to r5 tangent):\n- No lubrication:         1.00 / 1.00 / 1.00 / 1.00 / 1.00\n- Poor/badly maintained:  0.80 / 0.82 / 0.88 / 0.95 / 1.00\n- Standard wayside:       0.55 / 0.60 / 0.72 / 0.90 / 1.00\n- Good (wayside+onboard): 0.35 / 0.40 / 0.60 / 0.85 / 1.00\n- Optimal (lab only):     0.10 / 0.15 / 0.35 / 0.75 / 1.00\n\nIMPACT: Standard wayside reduces lateral wear by 45% on R<100m, 40% on R100-200m, 28% on R200-400m. No effect on tangent. Lateral wear is often the limiting criterion on curves below R200m.\n\nWARNING: Optimal is unrealistic in service. Good is the practical maximum due to contamination, rain, and maintenance gaps.",
   links:[
     {label:"Arias-Cuevas et al. (2010) - Friction modifiers in dry/wet conditions, Wear 268",url:"https://doi.org/10.1016/j.wear.2009.09.006",type:"paper"},
     {label:"Shanghai Metro Line 2 lateral wear study (2021), J.Rail and Rapid Transit",url:"https://doi.org/10.1177/0954409720915584",type:"paper"},
     {label:"Banverket (2018) - Field trials on lateral wear with friction modifiers (Sweden)",url:"https://www.trafikverket.se/",type:"report"},
   ]
  },
  {id:"brownfield",title:"Brownfield Mode",
   body:"PURPOSE: Start simulation from existing worn rail. Essential for inherited projects, condition assessments, and remaining life evaluations.\n\nINPUT PARAMETERS (per segment):\n- Vertical wear (mm): depth from original profile height. Impact: simulation starts here; replacement sooner.\n- Lateral wear (mm): gauge face wear at 14mm below running surface (EN 13674-1 convention).\n- RCF index (0 to 1): from UT inspection or surface assessment. Above 0.3 triggers corrective grinding in year 1.\n- Accumulated MGT: total since installation. Used for lifecycle cost amortisation.\n\nHEALTH INDICATOR: health = max(wearV/limitV, wearL/limitL, RCF). Good <40%, Moderate 40-70%, Poor >70%.\n\nMETAL RESERVE: initial_reserve = nominal_reserve - (wearV x 0.8). The 0.8 factor accounts for grinding-consumed reserve not visible in wear measurement.\n\nTYPICAL USE: Input last inspection report values. Simulator shows: years remaining, urgent grinding need, updated budget.",
   links:[
     {label:"EN 13231-1:2016 - Acceptance of railway track geometry after maintenance",url:"https://standards.cen.eu/dyn/www/f?p=204:110:0::::FSP_PROJECT:38793",type:"standard"},
     {label:"EN 13674-1:2011 - Rail wear measurement convention (clause 5.4)",url:"https://www.en-standard.eu/bs-en-13674-1-2011-railway-applications-track-rail/",type:"standard"},
     {label:"Network Rail NR/SP/TRK/001 - Track inspection handbook (2021)",url:"https://www.networkrail.co.uk/industry-and-commercial/",type:"standard"},
   ]
  },
  {id:"replacement",title:"Replacement Criteria",
   body:"REPLACEMENT triggered when ANY ONE condition is met:\n\n1. VERTICAL WEAR >= limit:\n   Tram: 7mm | Metro: 9mm | Heavy rail: 12mm\n   Reduces structural section; increases stress concentration.\n\n2. LATERAL WEAR >= limit:\n   Tram: 8mm | Metro: 11mm | Heavy rail: 14mm\n   Affects gauge and flange clearance. Measured at 14mm below running surface (EN 13674-1).\n\n3. METAL RESERVE <= 2mm:\n   Initial reserves: R200=13mm, R260=15mm, R320Cr=16mm, R350HT=17mm, R400HT=18mm.\n   Each intervention consumes: 0.20mm (preventive, 1 pass) to 2.2mm (corrective, 4 passes).\n\n4. RCF INDEX >= 0.70:\n   Cracks typically 5-8mm deep. Grinding cannot reach without exhausting metal reserve.",
   links:[
     {label:"EN 13674-1:2011 Table 2 - Wear limits for vignole rail",url:"https://www.en-standard.eu/bs-en-13674-1-2011-railway-applications-track-rail/",type:"standard"},
     {label:"UIC 714R - Rail defect action levels (2004)",url:"https://uic.org/IMG/pdf/714r.pdf",type:"standard"},
     {label:"Network Rail NR/L2/TRK/001 - Track inspection and maintenance (2022)",url:"https://www.networkrail.co.uk/industry-and-commercial/",type:"standard"},
     {label:"Infrabel TR 00059 - Rail inspection and renewal criteria (2021)",url:"https://www.infrabel.be/en/about-infrabel/technical-references",type:"standard"},
   ]
  },
  {id:"cost_repl",title:"Replacement Cost Estimation",
   body:"SCOPE: Total cost of track renewal (both rails) per linear meter and per segment.\n\nSIX COST COMPONENTS:\n1. Labour: fully loaded rates (salary + social charges). Team: 1 foreman, 4 technicians, 2 welders, 2 machinists (all adjustable).\n2. Rail material: price/tonne x kg/m x 2 rails. R260=60kg/m. Premium grades cost 20-40% more.\n3. Equipment: tamping machine, rail-road vehicle, crane, truck. Optional pre-grinding pass.\n4. Welding: cost/joint x joints/meter (1/spacing). Aluminothermic = standard; flash butt = higher quality (HSL).\n5. Tooling/consumables: 5% of labour (clips, anchors, fishplates).\n6. Overhead/supervision: configurable %, typically 15-22%.\n\nNIGHT PRODUCTIVITY: 70% efficiency factor applied to daytime rates.\n6 REGIONAL PRESETS: WEU, EEU, MENA, SSA, SEA, LATAM. Labour varies 5-8x; material 30-70% between regions.",
   links:[
     {label:"World Bank Railway Toolkit - Unit costs for rail renewal (2019)",url:"https://openknowledge.worldbank.org/handle/10986/31382",type:"report"},
     {label:"AREMA Manual for Railway Engineering Ch.4 - Rail (2022)",url:"https://www.arema.org/publications/",type:"standard"},
     {label:"RFI Italy - Prezzario FS Italiane (2023)",url:"https://www.rfi.it/it/infrastruttura/standard-tecnici.html",type:"report"},
   ]
  },
  {id:"cost_grind",title:"Grinding Cost Estimation",
   body:"SCOPE: Cumulative cost of all grinding interventions over the simulation horizon.\n\nTHREE MACHINE TYPES:\n- Small (tram/metro): 16-24 heads, ~200 ml/h. Suitable for light rail, metro, depot.\n- Line machine (ballasted): 32-48 heads, ~400 ml/h. Standard for suburban/mainline own fleets.\n- Specialist Speno/Loram/Vossloh: 64-120 heads, ~800 ml/h. Subcontract only. Cost-effective above ~100 km/yr.\n\nOWN FLEET cost/ml/pass = stones + fuel + maintenance + labour x time/ml.\nSUBCONTRACT cost = operation rate/ml/pass + mobilisation (fixed fee + distance x km from depot).\nMobilisation: per intervention (spot contracts) vs once per horizon (framework contracts).\n\nKEY INSIGHT: Own fleet is competitive above ~80-100 km/yr grinding. Below this threshold, mobilisation costs make subcontracting cheaper.",
   links:[
     {label:"Speno International - Rail grinding services and technology",url:"https://www.speno.ch/en/services/rail-grinding/",type:"report"},
     {label:"Loram Technologies - Rail grinding effectiveness",url:"https://www.loram.com/capabilities/rail-grinding/",type:"report"},
     {label:"Vossloh Rail Services - Grinding and milling services",url:"https://www.vossloh.com/en/products-and-solutions/rail-services/rail-milling-and-grinding/",type:"report"},
     {label:"Zarembski A.M. (2005) - The art and science of rail grinding, AREMA Proceedings",url:"https://www.arema.org/publications/",type:"paper"},
   ]
  },
  {id:"stones",title:"Grinding Stone Consumption",
   body:"FUNCTION: Grinding stones (abrasive wheels) are consumables mounted on each grinding head. They wear during operation.\n\nCONSUMPTION FACTORS:\n1. Radius (most critical): Tight curves require 5-8x more stones than tangent. Higher contact angles increase stone face wear.\n   Base rates (stones/km/rail/pass): r1=2.0-5.0 / r2=1.25-3.25 / r3=0.75-1.75 / r4=0.50-1.10 / r5=0.40-1.00\n   (range: small machine to Speno specialist)\n2. Rail grade hardness: Harder rail wears stones faster. Factors: R260=1.0x, R320Cr=1.15x, R350HT=1.30x, R400HT=1.45x.\n3. Machine type: Stone weight - small=0.9 kg, line=1.4 kg, Speno=2.2 kg.\n\nCOST: Typical unit price 5-20 EUR/stone. Stone cost = 30-50% of own-fleet grinding cost.\n\nCUSTOM RATE: Enter your measured rate for the R200-400m band. All other bands scale proportionally from the preset ratio.",
   links:[
     {label:"Speno International TB-2019-04 - Stone consumption factors by curve radius",url:"https://www.speno.ch/en/services/rail-grinding/",type:"report"},
     {label:"Loram Technologies - Abrasive consumption field data (2021)",url:"https://www.loram.com/capabilities/rail-grinding/",type:"report"},
     {label:"Rame I. et al. (2018) - Abrasive wear of grinding wheels in rail grinding, Wear 406-407",url:"https://doi.org/10.1016/j.wear.2018.01.012",type:"paper"},
     {label:"Vossloh Rail Services - Grinding wheel application guide (2020)",url:"https://www.vossloh.com/en/products-and-solutions/rail-services/",type:"report"},
   ]
  },
  {id:"validation",title:"Validation and Calibration",
   body:"PURPOSE: Compare simulator predictions against field measurements before using results for budget decisions.\n\nHOW IT WORKS: Predictions use the FULL engine with your current parameters. A synthetic train fleet reproduces the reference MGT/yr. No simplified sub-model.\n\nREFERENCE CASES:\n- BE1: Infrabel/TU Delft 2023, heavy, tangent, R260, 25 MGT/yr. V=0.82 mm/100MGT. Model calibration baseline.\n- BE2: Same source, R500m, R260, 25 MGT/yr. V=1.40, L=2.80. Tests curve wear factor model.\n- BE3: Same source, tangent, R200 grade, 25 MGT/yr. V=1.10. Tests hardness model.\n- GZ1: Guangzhou Metro 2021, R300m, R260, 15 MGT/yr. V=2.10, L=6.50. Tests metro context.\n- GZ2 (!): EMU depot R350m - INCOMPARABLE. 10.1mm lateral is absolute after 1M passes, not a rate.\n\nDEVIATION: Green <15% (good), Yellow 15-30% (review parameters), Red >30% (recalibrate for your context).",
   links:[
     {label:"Rooij L. et al. (2023) - Statistical analysis of rail wear, Belgian network, Wear 522",url:"https://doi.org/10.1016/j.wear.2022.204764",type:"paper"},
     {label:"Liu B. et al. (2021) - Rail wear on Guangzhou Metro, Wear 477",url:"https://doi.org/10.1016/j.wear.2021.203830",type:"paper"},
     {label:"Wang W.J. et al. (2022) - Wear of EMU depot track, Railway Sciences 1(2)",url:"https://doi.org/10.1007/s40534-022-00271-2",type:"paper"},
     {label:"ASTM E2660 - Standard guide for wear measurement in railway track",url:"https://www.astm.org/e2660-09r14.html",type:"standard"},
   ]
  },
  {id:"limits",title:"Known Limitations",
   body:"VERSION 1.1 - Annual time step.\n\nNOT MODELLED:\n- Inner/outer rail asymmetry: outer rail always critical. Inner ~30-60% of outer rate. Workaround: add inner as separate segment with reduced f_L.\n- Wheel profile evolution over time.\n- Seasonal variation: autumn leaf fall +15-25% wear; winter ice alters friction mode.\n- Station braking/acceleration zones: 2-4x higher wear. Workaround: short segments (50-200m) with f_V x 1.5-3.0.\n- Switch and crossing wear: different mechanisms, not applicable.\n- Corrugation: short-pitch roughness requires separate dynamic model.\n\nSCOPE: Calibrated on European heavy rail (Belgium) and Chinese metro. For North American freight, Japanese HSL, or African narrow gauge, validate locally before budget use.\n\nCOST DATA: Rates based on 2022-2023. Exchange rates are indicative - update for financial planning.",
   links:[
     {label:"RSSB T1009 - Rail wear database (UK network)",url:"https://www.rssb.co.uk/research-catalogue/CatalogueItem/T1009",type:"report"},
     {label:"FRA Track Safety Standards (US DOT)",url:"https://railroads.dot.gov/safety/track-safety/track-safety-standards",type:"standard"},
     {label:"DB Netz Richtlinie 824 - Schienenverschleiss (Germany)",url:"https://www.dbinfrago.com/db-infrago/en/technical-standards",type:"standard"},
     {label:"Esveld C. (2001) - Modern Railway Track, 2nd ed. (MRT Productions)",url:"https://www.mrt-productions.nl/",type:"book"},
   ]
  },
];

function HelpModal(props){
  const [tab, setTab] = useState("overview");
  var sec=HELP.find(function(h){return h.id===tab;});
  var linkTypeColor={paper:cl.teal,standard:cl.amber,report:cl.purple,book:"#60a5fa"};
  var linkTypeLabel={paper:"Paper",standard:"Standard",report:"Report",book:"Book"};
  return(
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>
      <div style={{background:"linear-gradient(160deg,#0d1f2a,#0a1820)",border:"1px solid rgba(125,211,200,0.2)",borderRadius:16,width:"100%",maxWidth:900,maxHeight:"85vh",display:"flex",flexDirection:"column",boxShadow:"0 32px 80px rgba(0,0,0,0.6)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 24px",borderBottom:"1px solid rgba(125,211,200,0.12)",flexShrink:0}}>
          <div>
            <div style={{fontSize:10,letterSpacing:3,color:cl.teal,fontWeight:700,textTransform:"uppercase"}}>Rail Wear Simulator v1.1</div>
            <div style={{fontSize:18,fontWeight:800,color:"#e8f4f3"}}>Documentation, Methodology and Sources</div>
          </div>
          <button onClick={props.onClose} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,color:cl.text,cursor:"pointer",width:34,height:34,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>x</button>
        </div>
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>
          <div style={{width:185,flexShrink:0,borderRight:"1px solid rgba(125,211,200,0.08)",padding:"10px 8px",overflowY:"auto"}}>
            {HELP.map(function(h){return(
              <div key={h.id} onClick={function(){setTab(h.id);}} style={{padding:"7px 10px",borderRadius:7,cursor:"pointer",background:tab===h.id?"rgba(125,211,200,0.1)":"transparent",borderLeft:"3px solid "+(tab===h.id?cl.teal:"transparent"),marginBottom:2}}>
                <span style={{fontSize:11,color:tab===h.id?"#e8f4f3":cl.dim,fontWeight:tab===h.id?600:400}}>{h.title}</span>
              </div>
            );})}
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"22px 26px"}}>
            <div style={{fontSize:20,fontWeight:700,color:"#e8f4f3",marginBottom:14}}>{sec&&sec.title}</div>
            <div style={{fontSize:12,color:"#a0bfbb",lineHeight:2.0,whiteSpace:"pre-line",marginBottom:20}}>{sec&&sec.body}</div>
            {sec&&sec.links&&sec.links.length>0&&(
              <div>
                <div style={{fontSize:10,letterSpacing:3,color:cl.teal,fontWeight:700,textTransform:"uppercase",marginBottom:10}}>Sources and References</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {sec.links.map(function(lk,i){
                    var col=linkTypeColor[lk.type]||cl.dim;
                    var lbl=linkTypeLabel[lk.type]||"Link";
                    return(
                      <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer"
                        style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 12px",background:"rgba(255,255,255,0.03)",borderRadius:7,border:"1px solid rgba(255,255,255,0.07)",textDecoration:"none",cursor:"pointer"}}>
                        <span style={{fontSize:9,fontWeight:700,color:col,background:col+"18",border:"1px solid "+col+"44",borderRadius:3,padding:"2px 6px",whiteSpace:"nowrap",marginTop:1,flexShrink:0,letterSpacing:1,textTransform:"uppercase"}}>{lbl}</span>
                        <span style={{fontSize:12,color:"#c8ddd9",lineHeight:1.5}}>{lk.label}</span>
                        <span style={{fontSize:10,color:"#3a5a64",marginLeft:"auto",flexShrink:0,marginTop:2}}>ext</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={{padding:"10px 24px",borderTop:"1px solid rgba(125,211,200,0.08)",fontSize:11,color:"#3a5a64",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <span>v1.1 - EN 13674 / UIC 714 / Infrabel 2023 / Guangzhou 2021 - Created by Mohamed BOUDIA</span>
          <span style={{color:cl.dim,cursor:"pointer"}} onClick={props.onClose}>Close</span>
        </div>
      </div>
    </div>
  );
}

// ---- MAIN APP ----

export default function App() {
  const [context,  setCon]  = useState("metro");
  const [trains,   setTr]   = useState([{id:1,label:"Type A",trainsPerDay:200,axleLoad:14,bogies:4,axlesPerBogie:2}]);
  const [segs,     setSegs] = useState([
    {id:"r1",label:"R < 100 m",       active:false,lengthKm:0,  grade:"R400HT",repr:75},
    {id:"r2",label:"100 to 200 m",    active:false,lengthKm:0,  grade:"R350HT",repr:150},
    {id:"r3",label:"200 to 400 m",    active:true, lengthKm:1.5,grade:"R320Cr",repr:300},
    {id:"r4",label:"400 to 800 m",    active:true, lengthKm:2.0,grade:"R320Cr",repr:600},
    {id:"r5",label:"R >= 800 m",      active:true, lengthKm:6.5,grade:"R260",  repr:9999},
  ]);
  const [railType, setRT]   = useState("vignole");
  const [trackMode,setTM]   = useState("ballast");
  const [speed,    setSp]   = useState(80);
  const [lubr,     setLb]   = useState("none");
  const [strategy, setSt]   = useState("preventive");
  const [horizon,  setHz]   = useState(30);
  const [isBF,     setBF]   = useState(false);
  const [initCond, setIC]   = useState({r1:{wearV:0,wearL:0,rcf:0,mgt:0},r2:{wearV:0,wearL:0,rcf:0,mgt:0},r3:{wearV:0,wearL:0,rcf:0,mgt:0},r4:{wearV:0,wearL:0,rcf:0,mgt:0},r5:{wearV:0,wearL:0,rcf:0,mgt:0}});
  const [result,   setRes]  = useState(null);
  const [aidx,     setAi]   = useState(0);
  const [ctab,     setCt]   = useState("wear");
  const [hasRun,   setHR]   = useState(false);
  const [err,      setErr]  = useState(null);
  const [showHelp, setHelp] = useState(false);

  function addTrain(){setTr(function(t){return t.concat([{id:Date.now(),label:"Type "+String.fromCharCode(65+t.length),trainsPerDay:100,axleLoad:14,bogies:4,axlesPerBogie:2}]);});}
  function delTrain(id){setTr(function(t){return t.filter(function(x){return x.id!==id;});});}
  function updTrain(id,f,v){setTr(function(t){return t.map(function(x){return x.id===id?Object.assign({},x,{[f]:v}):x;});});}
  function updSeg(id,f,v){setSegs(function(s){return s.map(function(x){return x.id===id?Object.assign({},x,{[f]:v}):x;});});}
  function togSeg(id){setSegs(function(s){return s.map(function(x){return x.id===id?Object.assign({},x,{active:!x.active,lengthKm:x.active?0:(x.lengthKm||1.0)}):x;});});}
  function updIC(id,f,v){setIC(function(c){return Object.assign({},c,{[id]:Object.assign({},c[id],{[f]:v})});});}

  var mgtPrev=useMemo(function(){return calcMGT(trains).toFixed(2);},[trains]);
  var eqPrev =useMemo(function(){return calcEqMGT(trains,context).toFixed(2);},[trains,context]);

  var run=useCallback(function(){
    var active=segs.filter(function(s){return s.active&&s.lengthKm>0;}).map(function(s){
      var base=Object.assign({},s,{radius:s.repr,railGrade:s.grade});
      if(isBF&&initCond[s.id]){var ic=initCond[s.id];base.initWearV=ic.wearV||0;base.initWearL=ic.wearL||0;base.initRCF=ic.rcf||0;base.initMGT=ic.mgt||0;}
      return base;
    });
    if(active.length===0){setErr("Enable at least one radius band with length > 0.");return;}
    try{setErr(null);var r=runSim({context:context,trains:trains,segments:active,strategy:strategy,railType:railType,trackMode:trackMode,speed:speed,lubrication:lubr,horizonYears:horizon});setRes(r);setAi(0);setHR(true);}
    catch(e){setErr("Simulation error: "+e.message);}
  },[context,trains,segs,strategy,railType,trackMode,speed,lubr,horizon,isBF,initCond]);

  var asr=result&&result.results[aidx];
  var gp={railType:railType,trackMode:trackMode,speed:speed,lubrication:lubr,strategy:strategy};

  return (
    <div style={{fontFamily:"Segoe UI,sans-serif",background:"linear-gradient(135deg,#0a1a22,#0d2030,#091820)",minHeight:"100vh",color:cl.text}}>
      <div style={{borderBottom:"1px solid rgba(125,211,200,0.12)",padding:"16px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(0,0,0,0.2)",position:"sticky",top:0,zIndex:100}}>
        <div>
          <div style={{fontSize:10,letterSpacing:4,color:cl.teal,fontWeight:700,textTransform:"uppercase"}}>Rail Maintenance</div>
          <div style={{fontSize:20,fontWeight:800,color:"#e8f4f3"}}>Wear and Maintenance Simulator</div>
          <div style={{fontSize:11,color:"#4a6a74",marginTop:3}}>Created by Mohamed BOUDIA</div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <span style={{fontSize:12,color:cl.dim}}>Gross MGT: <b style={{color:cl.teal}}>{mgtPrev}</b>/yr | Equiv. MGT: <b style={{color:cl.teal}}>{eqPrev}</b>/yr</span>
          <Btn onClick={function(){setHelp(true);}} sm={true}>Help and Methods</Btn>
          <Btn onClick={run} active={true}>Run Simulation</Btn>
        </div>
      </div>
      {showHelp&&<HelpModal onClose={function(){setHelp(false);}}/>}

      <div style={{display:"grid",gridTemplateColumns:"360px 1fr",maxWidth:1400,margin:"0 auto",padding:"18px 18px 0"}}>
        <div style={{paddingRight:16}}>

          <Card title="Context">
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {Object.keys(CONTEXTS).map(function(k){return <Btn key={k} onClick={function(){setCon(k);}} active={context===k}>{CONTEXTS[k].label}</Btn>;})}
            </div>
          </Card>

          <Card title="Train Fleet">
            {trains.map(function(tr){return(
              <div key={tr.id} style={{background:"rgba(255,255,255,0.02)",borderRadius:8,padding:12,marginBottom:10,border:"1px solid rgba(255,255,255,0.05)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <Inp value={tr.label} onChange={function(v){updTrain(tr.id,"label",v);}} type="text"/>
                  {trains.length>1&&<button onClick={function(){delTrain(tr.id);}} style={{background:"none",border:"none",color:cl.warn,cursor:"pointer",fontSize:18,marginLeft:8}}>x</button>}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div><Lbl>Passes/day (one track, one dir.)</Lbl><Inp value={tr.trainsPerDay} onChange={function(v){updTrain(tr.id,"trainsPerDay",v);}} min={1}/></div>
                  <div><Lbl>Axle load (t)</Lbl><Inp value={tr.axleLoad} onChange={function(v){updTrain(tr.id,"axleLoad",v);}} min={5} max={35} step={0.5}/></div>
                  <div><Lbl>No. of bogies</Lbl><Inp value={tr.bogies} onChange={function(v){updTrain(tr.id,"bogies",v);}} min={2} max={16}/></div>
                  <div><Lbl>Axles/bogie</Lbl><Inp value={tr.axlesPerBogie} onChange={function(v){updTrain(tr.id,"axlesPerBogie",v);}} min={2} max={4}/></div>
                </div>
                <div style={{marginTop:8,fontSize:11,color:cl.dim}}>Gross tonnage: <b style={{color:cl.teal}}>{(tr.axleLoad*tr.bogies*tr.axlesPerBogie).toFixed(0)} t</b> - <b style={{color:cl.teal}}>{((tr.trainsPerDay*tr.axleLoad*tr.bogies*tr.axlesPerBogie*365)/1e6).toFixed(2)} MGT/yr</b></div>
              </div>
            );})}
            <Btn onClick={addTrain} sm={true}>+ Add train type</Btn>
          </Card>

          <Card title="Track Layout by Radius Band">
            <div style={{fontSize:11,color:cl.dim,marginBottom:10,lineHeight:1.6}}>Enable bands present on your line. Enter single-track km.</div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10,padding:"5px 8px",background:"rgba(125,211,200,0.06)",borderRadius:6}}>
              <span style={{fontSize:11,color:cl.dim}}>Total active length</span>
              <span style={{fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{segs.filter(function(s){return s.active;}).reduce(function(a,s){return a+(s.lengthKm||0);},0).toFixed(1)} km</span>
            </div>
            {segs.map(function(seg){
              var rb=BANDS.find(function(b){return b.id===seg.id;});
              return(
                <div key={seg.id} style={{background:seg.active?"rgba(125,211,200,0.04)":"rgba(255,255,255,0.02)",borderRadius:8,padding:"10px 12px",marginBottom:8,border:"1px solid "+(seg.active?"rgba(125,211,200,0.18)":"rgba(255,255,255,0.05)")}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:seg.active?10:0}}>
                    <div onClick={function(){togSeg(seg.id);}} style={{width:30,height:17,borderRadius:9,background:seg.active?cl.teal:"rgba(255,255,255,0.08)",position:"relative",cursor:"pointer",flexShrink:0,border:"1px solid "+(seg.active?cl.teal:"rgba(255,255,255,0.15)")}}>
                      <div style={{width:11,height:11,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:seg.active?15:2,transition:"left 0.2s"}}/>
                    </div>
                    <span style={{fontSize:13,fontWeight:600,color:seg.active?"#e8f4f3":"#4a6a74",flex:1}}>{seg.label}</span>
                    {rb&&<div style={{display:"flex",gap:5}}><span style={{fontSize:10,background:"rgba(125,211,200,0.1)",color:cl.teal,borderRadius:4,padding:"2px 6px"}}>fV x{rb.f_v}</span><span style={{fontSize:10,background:"rgba(251,191,36,0.1)",color:cl.amber,borderRadius:4,padding:"2px 6px"}}>fL x{rb.f_l}</span></div>}
                  </div>
                  {seg.active&&(
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                      <div><Lbl>Length (km)</Lbl><Inp value={seg.lengthKm} onChange={function(v){updSeg(seg.id,"lengthKm",v);}} min={0.1} step={0.1}/></div>
                      <div><Lbl>Representative radius (m)</Lbl><Inp value={seg.repr} onChange={function(v){updSeg(seg.id,"repr",Math.max(rb?rb.rMin:1,Math.min((rb?rb.rMax:99999)-1,v)));}} min={rb?rb.rMin:1} max={rb?(rb.rMax-1):99998}/><div style={{fontSize:10,color:cl.dim,marginTop:2}}>{seg.repr>=9000?"tangent":"R = "+seg.repr+" m"}</div></div>
                      <div><Lbl>Grade / Hardness</Lbl><Sel value={seg.grade} onChange={function(v){updSeg(seg.id,"grade",v);}} opts={Object.keys(RAIL_GRADES).map(function(k){return {v:k,l:k};})}/></div>
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
                <div style={{fontSize:11,color:cl.dim,marginTop:5}}>{lubr==="none"&&"No lateral wear reduction - dry conditions"}{lubr==="poor"&&"Badly maintained - low reduction"}{lubr==="standard"&&"Correctly adjusted wayside - significant reduction on tight curves"}{lubr==="good"&&"Wayside and onboard combined - good coverage"}{lubr==="optimal"&&"Lab conditions only - unrealistic in revenue service"}</div>
              </div>
              <div style={{fontSize:11,color:cl.dim,background:"rgba(125,211,200,0.05)",borderRadius:6,padding:"8px 10px",border:"1px solid rgba(125,211,200,0.1)"}}>Rail hardness (grade) is set per segment in the section above</div>
            </div>
          </Card>

          <Card title="Initial Rail Condition">
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,padding:"10px 14px",background:isBF?"rgba(251,191,36,0.08)":"rgba(125,211,200,0.05)",borderRadius:8,border:"1px solid "+(isBF?"rgba(251,191,36,0.25)":"rgba(125,211,200,0.12)")}}>
              <div onClick={function(){setBF(function(v){return !v;});}} style={{width:36,height:20,borderRadius:10,background:isBF?cl.amber:"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",flexShrink:0,border:"1px solid "+(isBF?cl.amber:"rgba(255,255,255,0.2)")}}>
                <div style={{width:14,height:14,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:isBF?18:2,transition:"left 0.2s"}}/>
              </div>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:isBF?cl.amber:"#e8f4f3"}}>{isBF?"Brownfield - Existing rail":"Greenfield - New rail (default)"}</div>
                <div style={{fontSize:11,color:cl.dim,marginTop:2}}>{isBF?"Initial wear values applied at simulation start":"All segments start from new rail"}</div>
              </div>
            </div>
            {isBF&&(
              <div>
                <div style={{fontSize:11,color:cl.dim,marginBottom:12}}>Enter current measured values for each active segment.</div>
                {segs.filter(function(s){return s.active&&s.lengthKm>0;}).map(function(seg){
                  var ic=initCond[seg.id]||{wearV:0,wearL:0,rcf:0,mgt:0};
                  var lim=LIMITS[context];
                  var health=Math.max(ic.wearV/lim.v,ic.wearL/lim.l,ic.rcf);
                  var hcol=health<0.4?cl.green:health<0.7?cl.amber:cl.warn;
                  var hlbl=health<0.4?"GOOD":health<0.7?"MODERATE":"POOR";
                  return(
                    <div key={seg.id} style={{background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"12px",marginBottom:10,border:"1px solid rgba(255,255,255,0.07)"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <span style={{fontSize:12,fontWeight:600,color:"#e8f4f3"}}>{seg.label}</span>
                        <span style={{fontSize:10,background:hcol+"22",color:hcol,border:"1px solid "+hcol+"55",borderRadius:4,padding:"2px 8px",fontWeight:700}}>{hlbl} - {Math.round(health*100)}% consumed</span>
                      </div>
                      <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2,marginBottom:10}}><div style={{height:"100%",width:Math.min(100,health*100)+"%",background:hcol,borderRadius:2}}/></div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                        <div><Lbl>{"Vertical wear (mm) limit "+lim.v+"mm"}</Lbl><Inp value={ic.wearV} onChange={function(v){updIC(seg.id,"wearV",Math.min(lim.v-0.1,Math.max(0,v)));}} min={0} max={lim.v-0.1} step={0.1}/>{ic.wearV>0&&<div style={{fontSize:10,color:hcol,marginTop:3}}>{((ic.wearV/lim.v)*100).toFixed(0)}% of vertical limit</div>}</div>
                        <div><Lbl>{"Lateral wear (mm) limit "+lim.l+"mm"}</Lbl><Inp value={ic.wearL} onChange={function(v){updIC(seg.id,"wearL",Math.min(lim.l-0.1,Math.max(0,v)));}} min={0} max={lim.l-0.1} step={0.1}/>{ic.wearL>0&&<div style={{fontSize:10,color:hcol,marginTop:3}}>{((ic.wearL/lim.l)*100).toFixed(0)}% of lateral limit</div>}</div>
                        <div><Lbl>RCF index (0 healthy to 1 critical)</Lbl><Inp value={ic.rcf} onChange={function(v){updIC(seg.id,"rcf",Math.min(0.99,Math.max(0,v)));}} min={0} max={0.99} step={0.01}/><div style={{fontSize:10,color:ic.rcf<0.3?cl.green:ic.rcf<0.7?cl.amber:cl.warn,marginTop:3}}>{ic.rcf<0.3?"Healthy":ic.rcf<0.7?"Moderate - corrective grinding needed":"Critical - near replacement"}</div></div>
                        <div><Lbl>MGT already accumulated</Lbl><Inp value={ic.mgt} onChange={function(v){updIC(seg.id,"mgt",Math.max(0,v));}} min={0} step={0.5}/><div style={{fontSize:10,color:cl.dim,marginTop:3}}>For lifecycle tracking</div></div>
                      </div>
                    </div>
                  );
                })}
                {segs.filter(function(s){return s.active&&s.lengthKm>0;}).length===0&&<div style={{fontSize:12,color:"#4a6a74",textAlign:"center",padding:"12px 0"}}>Enable radius bands above to enter initial conditions</div>}
              </div>
            )}
          </Card>

          <Card title="Maintenance Strategy">
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <Btn onClick={function(){setSt("preventive");}} active={strategy==="preventive"}>Preventive</Btn>
              <Btn onClick={function(){setSt("corrective");}} active={strategy==="corrective"}>Corrective</Btn>
            </div>
            <div style={{fontSize:12,color:cl.dim,lineHeight:1.6}}>{strategy==="preventive"?"Frequent grinding (short intervals). 1 light pass ~0.2mm. RCF kept low. Maximum rail life.":"Threshold-triggered grinding (3x longer intervals). Up to 4 heavy passes. Shorter rail life."}</div>
            <div style={{marginTop:12}}><Lbl>Simulation horizon (years)</Lbl><Inp value={horizon} onChange={setHz} min={5} max={50}/></div>
          </Card>
        </div>

        <div>
          {err&&<div style={{background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:16,color:cl.warn,fontSize:13}}>Error: {err}</div>}
          {!hasRun&&(
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:400,color:"#4a6a74",textAlign:"center",gap:16,border:"1px dashed rgba(125,211,200,0.15)",borderRadius:16}}>
              <div style={{fontSize:14,fontWeight:600,color:cl.dim}}>Configure parameters and run the simulation</div>
              <div style={{fontSize:13}}>Computes wear, grinding cycles and replacement timelines for each segment</div>
              <Btn onClick={run} active={true}>Run Simulation</Btn>
            </div>
          )}
          {hasRun&&result&&(
            <div>
              <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                <Kpi label="Gross MGT / yr"  value={result.mgtPY.toFixed(2)}  unit="MGT"/>
                <Kpi label="Equiv. MGT / yr" value={result.eqPY.toFixed(2)}   unit="MGT eq."/>
                <Kpi label="Earliest replacement" value={Math.min.apply(null,result.results.map(function(r){return r.repY||horizon+1;}))<=horizon?"Yr "+Math.min.apply(null,result.results.map(function(r){return r.repY||horizon+1;})):"> "+horizon+" yrs"} unit="" warn={Math.min.apply(null,result.results.map(function(r){return r.repY||horizon+1;}))<=horizon*0.5}/>
                <Kpi label="Total grindings" value={result.results.reduce(function(a,r){return a+r.gCount;},0)} unit="passes"/>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
                {result.results.map(function(r,i){return <Btn key={i} onClick={function(){setAi(i);}} active={aidx===i} sm={true}>{r.seg.label}{r.repY?" Yr "+r.repY:""}</Btn>;})}
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
                    {[["wear","Wear V and L"],["rcf","RCF Index"],["reserve","Metal Reserve"],["plan","Schedule"],["cost","Replacement Cost"],["grind","Grinding Cost"]].map(function(item){return <Btn key={item[0]} onClick={function(){setCt(item[0]);}} active={ctab===item[0]} sm={true}>{item[1]}</Btn>;})}
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
                            <XAxis dataKey="year" stroke="#4a6a74" tick={{fontSize:11}}/>
                            <YAxis stroke="#4a6a74" tick={{fontSize:11}} unit=" mm"/>
                            <Tooltip content={<Tip/>}/><Legend wrapperStyle={{fontSize:12}}/>
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
                            <Tooltip content={<Tip/>}/>
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
                            <Tooltip content={<Tip/>}/>
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
                            <Tooltip content={<Tip/>}/><Legend wrapperStyle={{fontSize:12}}/>
                            <Bar dataKey="ground"   name="Grinding"    fill={cl.green} opacity={0.8} radius={[3,3,0,0]}/>
                            <Bar dataKey="replaced" name="Replacement" fill={cl.warn}  opacity={0.9} radius={[3,3,0,0]}/>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    {ctab==="cost"&&<CostPanel simResult={result} horizon={horizon}/>}
                    {ctab==="grind"&&<GrindPanel simResult={result} horizon={horizon} context={context}/>}
                  </div>
                  <div style={{background:"rgba(0,0,0,0.15)",borderRadius:10,border:"1px solid rgba(125,211,200,0.08)",overflow:"hidden"}}>
                    <div style={{padding:"12px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:11,letterSpacing:2,color:cl.teal,textTransform:"uppercase",fontWeight:700}}>Summary - All Segments</div>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                        <thead><tr style={{background:"rgba(255,255,255,0.03)"}}>{["Segment","Radius","Grade","Eff.Hardness","Wear rate V","Wear rate L","Grindings","Replacement","Final RCF"].map(function(h){return <th key={h} style={{padding:"8px 12px",textAlign:"left",color:cl.dim,fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>;})}</tr></thead>
                        <tbody>
                          {result.results.map(function(r,i){var last=r.data[r.data.length-1];return(
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
                          );})}
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
