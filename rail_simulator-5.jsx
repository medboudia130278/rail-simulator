import React, { useState, useEffect, useCallback, useMemo } from "react";
import { jsPDF } from "jspdf";
import { AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

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
  groove: { label:"Groove Rail (Tram)", f_v:1.20, f_l:1.50 },
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
  {id:"r1",label:"R < 100 m",       rMin:0,   rMax:100,   f_v:6.0,f_l:15.0,grind:{tram:999,metro:999,heavy:999}},
  {id:"r2",label:"100 to 200 m",    rMin:100, rMax:200,   f_v:4.0,f_l:9.0, grind:{tram:12, metro:18,heavy:20 }},
  {id:"r3",label:"200 to 400 m",    rMin:200, rMax:400,   f_v:2.5,f_l:5.0, grind:{tram:18, metro:24,heavy:30 }},
  {id:"r4",label:"400 to 800 m",    rMin:400, rMax:800,   f_v:1.5,f_l:2.5, grind:{tram:28, metro:36,heavy:50 }},
  {id:"r5",label:"R >= 800 m",      rMin:800, rMax:99999, f_v:1.0,f_l:0.65, grind:{tram:40, metro:55,heavy:80 }},
];
var SPECIAL_ZONE_TYPES = {
  braking:   { label:"Braking zone (station entry)",        fVExtra:2.2, fVRange:[1.5,3.5], corrMGT:8,  icon:"B" },
  accel:     { label:"Acceleration zone (station exit)",    fVExtra:1.7, fVRange:[1.2,2.5], corrMGT:12, icon:"A" },
  terminus:  { label:"Terminus / reversing zone (mixed)",   fVExtra:3.0, fVRange:[2.0,4.0], corrMGT:6,  icon:"T" },
  transition:{ label:"Transition zone (curve to tangent)",  fVExtra:1.4, fVRange:[1.1,2.0], corrMGT:20, icon:"X" },
};
function getSpecialZoneDefaultSpeed(type, lineSpeed) {
  var vLine = Math.max(20, +(lineSpeed||80));
  if(type==="terminus") return Math.min(vLine, 25);
  if(type==="braking" || type==="accel") return Math.min(vLine, 50);
  if(type==="transition") return vLine;
  return vLine;
}
var CURVE_SPEED_DEFAULTS = {
  tram:  { r1:25, r2:35, r3:50, r4:70, r5:80 },
  metro: { r1:35, r2:50, r3:65, r4:80, r5:100 },
  heavy: { r1:40, r2:60, r3:80, r4:100, r5:140 },
};
function getRecommendedSegmentSpeed(seg, context, lineSpeed) {
  var vLine = Math.max(20, +(lineSpeed||80));
  if(seg && seg.speed) return Math.max(20, +seg.speed);
  if(seg && seg.isSpecialZone) return getSpecialZoneDefaultSpeed(seg.zoneType, vLine);
  var radius = (seg && (seg.radius || seg.repr)) || 9000;
  var band = TAMP_BAND(radius);
  var ctxDefaults = CURVE_SPEED_DEFAULTS[context] || CURVE_SPEED_DEFAULTS.metro;
  return Math.min(vLine, ctxDefaults[band] || vLine);
}

var SPEED_BANDS_V = [
  {max:40,   f_v:0.92},
  {max:80,   f_v:1.00},
  {max:120,  f_v:1.08},
  {max:160,  f_v:1.15},
  {max:9999, f_v:1.25},
];
var SPEED_BANDS_L = {
  r1: [
    {max:40,   f_l:1.05},
    {max:80,   f_l:1.00},
    {max:120,  f_l:0.98},
    {max:160,  f_l:0.96},
    {max:9999, f_l:0.94},
  ],
  r2: [
    {max:40,   f_l:1.03},
    {max:80,   f_l:1.00},
    {max:120,  f_l:0.98},
    {max:160,  f_l:0.97},
    {max:9999, f_l:0.95},
  ],
  r3: [
    {max:40,   f_l:1.01},
    {max:80,   f_l:1.00},
    {max:120,  f_l:0.99},
    {max:160,  f_l:0.98},
    {max:9999, f_l:0.97},
  ],
  r4: [
    {max:40,   f_l:1.00},
    {max:80,   f_l:1.00},
    {max:120,  f_l:0.99},
    {max:160,  f_l:0.98},
    {max:9999, f_l:0.98},
  ],
  r5: [
    {max:40,   f_l:1.00},
    {max:80,   f_l:1.00},
    {max:120,  f_l:1.00},
    {max:160,  f_l:0.99},
    {max:9999, f_l:0.99},
  ],
};
var LUBRICATION = {
  none:    {label:"No lubrication",                f:[1.00,1.00,1.00,1.00,1.00], f_rcf:[1.00,1.00,1.00,1.00,1.00]},
  poor:    {label:"Poor (badly maintained)",       f:[0.80,0.83,0.90,0.97,1.00], f_rcf:[0.97,0.97,0.98,0.99,1.00]},
  standard:{label:"Standard (wayside lubrication)",f:[0.45,0.52,0.68,0.92,1.00], f_rcf:[0.90,0.88,0.90,0.96,1.00]},
  good:    {label:"Good (wayside + onboard)",      f:[0.28,0.35,0.55,0.88,1.00], f_rcf:[0.85,0.82,0.86,0.94,1.00]},
  optimal: {label:"Optimal (lab conditions only)", f:[0.20,0.25,0.45,0.82,1.00], f_rcf:[0.80,0.78,0.83,0.92,1.00]},
};
var LIMITS  = { tram:{v:7,l:8}, metro:{v:9,l:11}, heavy:{v:12,l:14} };
var RESERVE   = { R200:13,  R260:15,  R320Cr:16,  R350HT:17,  R400HT:18  }; // vertical grinding reserve (mm)
var RESERVE_L = { R200:7,   R260:8,   R320Cr:9,   R350HT:9,   R400HT:10  }; // lateral grinding reserve (mm) - gauge face
var MIN_RES_V = { R200:3.0, R260:3.0, R320Cr:3.0, R350HT:3.5, R400HT:4.0 }; // min vertical reserve before replacement
var MIN_RES_L = { R200:3.0, R260:3.0, R320Cr:3.5, R350HT:3.5, R400HT:4.0 }; // min lateral reserve before replacement
var RCF_MAX = 0.70;
var HEAVY_RCF_GRIND_TRIGGER = { r1:0.45, r2:0.32, r3:0.30, r4:0.32, r5:0.38 };
var CORRECTIVE_GRIND_TRIGGER = {
  tram:  { wVFrac:0.35, rcf:0.35 },
  metro: { wVFrac:0.30, rcf:0.30 },
};
var SPECIAL_ZONE_CORRECTIVE_TRIGGER = {
  tram:  { wVFrac:0.45, rcf:0.35 },
  metro: { wVFrac:0.40, rcf:0.30 },
};
var SPECIAL_ZONE_CORRECTIVE_REARM = {
  tram:  { wVFrac:0.20, rcf:0.20 },
  metro: { wVFrac:0.20, rcf:0.20 },
};

// ---- TAMPING CONSTANTS ----
var TAMP_BASE_MGT = {
  tram:  {r1:8,  r2:12, r3:18, r4:25, r5:35},
  metro: {r1:14, r2:20, r3:27, r4:38, r5:48},
  heavy: {r1:15, r2:22, r3:30, r4:40, r5:65},
};
var TAMP_PLATFORM = {P1:1.20, P2:1.00, P3:0.70, P4:0.45};
var TAMP_V_REF = 80;
var TAMP_APPOINT_DEFAULT = {r1:50, r2:40, r3:30, r4:20, r5:15};
var TAMP_DEGARN_FACTOR = 8.0;

// ---- TAMPING COST CONSTANTS ----

var TAMP_MACHINES_BOUR = {
  light: {
    label: "Light tamper (08-16, tram/metro)",
    prodMlH: 175,
    ownedRates: {
      fuelLph: 22,
      maintEurH: 120,
      labour: {WEU:48,EEU:24,MENA:15,SSA:11,SEA:12,LATAM:14},
      team:   3,
    },
    subRates: {
      opPerMl:  {WEU:8,  EEU:5.0,MENA:4.5,SSA:3.5,SEA:4.0,LATAM:4.0},
      mobilFix: {WEU:8000,EEU:5000,MENA:4000,SSA:3000,SEA:3500,LATAM:3800},
    },
  },
  standard: {
    label: "Standard tamper (09-3X, metro/heavy)",
    prodMlH: 300,
    ownedRates: {
      fuelLph: 35,
      maintEurH: 180,
      labour: {WEU:55,EEU:28,MENA:17,SSA:13,SEA:14,LATAM:16},
      team:   4,
    },
    subRates: {
      opPerMl:  {WEU:11, EEU:7.0,MENA:6.0,SSA:4.5,SEA:5.5,LATAM:5.5},
      mobilFix: {WEU:12000,EEU:7500,MENA:6000,SSA:4500,SEA:5000,LATAM:5500},
    },
  },
  heavy: {
    label: "Heavy tamping train (09-4X, heavy rail)",
    prodMlH: 425,
    ownedRates: {
      fuelLph: 55,
      maintEurH: 260,
      labour: {WEU:62,EEU:32,MENA:20,SSA:15,SEA:16,LATAM:18},
      team:   5,
    },
    subRates: {
      opPerMl:  {WEU:14, EEU:9.0,MENA:8.0,SSA:6.0,SEA:7.0,LATAM:7.5},
      mobilFix: {WEU:18000,EEU:11000,MENA:9000,SSA:7000,SEA:8000,LATAM:9000},
    },
  },
};

var TAMP_DIESEL_EUR_L = {
  WEU:   1.20,
  EEU:   1.00,
  MENA:  0.80,
  SSA:   0.95,
  SEA:   0.90,
  LATAM: 1.05,
};

var TAMP_BALLAST_PRICE = {
  WEU:   {carriere:23, delivery:12},
  EEU:   {carriere:13, delivery:7},
  MENA:  {carriere:10, delivery:6},
  SSA:   {carriere:8,  delivery:5},
  SEA:   {carriere:9,  delivery:5},
  LATAM: {carriere:10, delivery:5},
};

var TAMP_DEGARN_OP = {
  WEU:   {opPerMl:45, mobilFix:20000},
  EEU:   {opPerMl:28, mobilFix:12000},
  MENA:  {opPerMl:22, mobilFix:9000},
  SSA:   {opPerMl:17, mobilFix:7000},
  SEA:   {opPerMl:20, mobilFix:8000},
  LATAM: {opPerMl:19, mobilFix:7500},
};

function calcTampCostPerMl(machine, mode, region, nightHrs, currencyMap, currency, ownOverrides) {
  var currencies = currencyMap || CURRENCIES;
  var fx = (currencies[currency]||currencies.EUR||CURRENCIES.EUR).rate;
  if(mode === "owned") {
    var r = machine.ownedRates;
    var fuelLph = ownOverrides && ownOverrides.fuelLph !== null && ownOverrides.fuelLph !== undefined ? ownOverrides.fuelLph : r.fuelLph;
    var gasoilEurL = ownOverrides && ownOverrides.gasoilEurL !== null && ownOverrides.gasoilEurL !== undefined ? ownOverrides.gasoilEurL : (TAMP_DIESEL_EUR_L[region] || TAMP_DIESEL_EUR_L.WEU);
    var maintEurH = ownOverrides && ownOverrides.maintEurH !== null && ownOverrides.maintEurH !== undefined ? ownOverrides.maintEurH : r.maintEurH;
    var labourTeamEurH = ownOverrides && ownOverrides.labourTeamEurH !== null && ownOverrides.labourTeamEurH !== undefined ? ownOverrides.labourTeamEurH : ((r.labour[region]||r.labour.WEU) * r.team);
    var prodMlH = ownOverrides && ownOverrides.prodMlH !== null && ownOverrides.prodMlH !== undefined ? ownOverrides.prodMlH : machine.prodMlH;
    var mlPerNight = nightHrs * prodMlH * 0.75;
    var hourlyCostEur = fuelLph * gasoilEurL + maintEurH + labourTeamEurH;
    var perMlEur = prodMlH > 0 ? (hourlyCostEur / prodMlH) : 0;
    return {
      perMl: perMlEur * fx,
      mobilFix: 0,
      mlPerNight: mlPerNight,
      mode: "owned",
      fuelLph:fuelLph,
      gasoilEurL:gasoilEurL,
      maintEurH:maintEurH,
      labourTeamEurH:labourTeamEurH,
      prodMlH:prodMlH,
      hourlyCostEur:hourlyCostEur,
      perMlEur:perMlEur,
    };
  } else {
    var mlPerNight = nightHrs * machine.prodMlH * 0.75;
    var s = machine.subRates;
    var opPerMl  = s.opPerMl[region]  || s.opPerMl.WEU;
    var mobilFix = s.mobilFix[region] || s.mobilFix.WEU;
    return {perMl: opPerMl * fx, mobilFix: mobilFix * fx, mlPerNight: mlPerNight, mode: "sub", perMlEur:opPerMl};
  }
}
var TAMP_BAND = function(repr) {
  if(repr < 100)  return "r1";
  if(repr < 200)  return "r2";
  if(repr < 400)  return "r3";
  if(repr < 800)  return "r4";
  return "r5";
};
var REPR_REM_L_DEFAULT = { r1:3.0, r2:2.0, r3:1.0, r4:0.5, r5:0.0 }; // default lateral removal per reprofiling by radius band
function getBandReprRemL(radius, byBand) {
  var b = [["r1",0,100],["r2",100,200],["r3",200,400],["r4",400,800],["r5",800,99999]];
  for(var k=0;k<b.length;k++){if(radius>=b[k][1]&&radius<b[k][2])return byBand[b[k][0]]!==undefined?byBand[b[k][0]]:REPR_REM_L_DEFAULT[b[k][0]];}
  return byBand.r5||0;
}

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
  EEU:   {label:"Eastern Europe (PL/RO/CZ/HU)",  lbr:{foreman:35,tech:25,welder:30,mach:28},   mat:{R260:1050,R320Cr:1220,R350HT:1320,R400HT:1450}, eqp:{tamper:750,rr:380,crane:580,truck:240,grinder:450}, weld:{thermit:280,flash:420}, prod:{rem:9,lay:7,tamp:13}, team:{foreman:1,tech:4,welder:2,mach:2}, ovhd:0.14},
  MENA:  {label:"North Africa / Middle East",     lbr:{foreman:20,tech:12,welder:16,mach:14},   mat:{R260:1200,R320Cr:1380,R350HT:1500,R400HT:1650}, eqp:{tamper:900,rr:450,crane:700,truck:300,grinder:580}, weld:{thermit:320,flash:460}, prod:{rem:7,lay:5,tamp:10}, team:{foreman:1,tech:5,welder:2,mach:2}, ovhd:0.16},
  SSA:   {label:"Sub-Saharan Africa",             lbr:{foreman:15,tech:8, welder:12,mach:10},   mat:{R260:1300,R320Cr:1500,R350HT:1620,R400HT:1780}, eqp:{tamper:950,rr:480,crane:720,truck:320,grinder:600}, weld:{thermit:350,flash:500}, prod:{rem:6,lay:4,tamp:9},  team:{foreman:1,tech:6,welder:2,mach:2}, ovhd:0.2},
  SEA:   {label:"South / South-East Asia",        lbr:{foreman:18,tech:9, welder:13,mach:11},   mat:{R260:950, R320Cr:1100,R350HT:1200,R400HT:1320}, eqp:{tamper:780,rr:400,crane:620,truck:260,grinder:500}, weld:{thermit:290,flash:420}, prod:{rem:8,lay:6,tamp:11}, team:{foreman:1,tech:5,welder:2,mach:2}, ovhd:0.12},
  LATAM: {label:"Latin America",                  lbr:{foreman:22,tech:13,welder:18,mach:15},   mat:{R260:1050,R320Cr:1220,R350HT:1320,R400HT:1450}, eqp:{tamper:820,rr:410,crane:640,truck:270,grinder:520}, weld:{thermit:300,flash:440}, prod:{rem:7,lay:5,tamp:10}, team:{foreman:1,tech:5,welder:2,mach:2}, ovhd:0.15},
  CUSTOM:{label:"Custom / Manual input",          lbr:{foreman:50,tech:40,welder:50,mach:45},   mat:{R260:1100,R320Cr:1280,R350HT:1380,R400HT:1520}, eqp:{tamper:800,rr:400,crane:650,truck:260,grinder:500}, weld:{thermit:350,flash:480}, prod:{rem:8,lay:6,tamp:12}, team:{foreman:1,tech:4,welder:2,mach:2}, ovhd:0.18},
};
var RAIL_KGM = {R200:49,R260:60,R320Cr:60,R350HT:60,R400HT:60};

function calcCostPerMl(p, grade, weldType, nightHrs, currency, ovhdPct, withGrinder, jointSp, currencyMap) {
  var currencies = currencyMap || CURRENCIES;
  var fx   = (currencies[currency]||currencies.EUR||CURRENCIES.EUR).rate;
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

function calcPassesPerDay(t) {
  // Mileage mode: fleet x mileage / section_length / 365
  if (t.mileageActive && t.mileageProfile) {
    var mp = t.mileageProfile;
    if (mp.sectionKm > 0) {
      return (mp.fleetSize * mp.mileagePerTrain) / (mp.sectionKm * 365);
    }
    return t.trainsPerDay;
  }
  // Weekly profile mode
  if (t.weekActive && t.weekProfile) {
    var wp = t.weekProfile;
    return (5*wp.weekday + wp.saturday + wp.sunday) / 7;
  }
  return t.trainsPerDay;
}
function calcMGT(trains) {
  return trains.reduce(function(s,t){
    var ppd = calcPassesPerDay(t);
    return s+(ppd*t.axleLoad*t.bogies*t.axlesPerBogie*365)/1e6;
  },0);
}
function calcEqMGT(trains,ctx) {
  var qRef=CONTEXTS[ctx].qRef;
  return trains.reduce(function(s,t){
    var ppd = calcPassesPerDay(t);
    var m=(ppd*t.axleLoad*t.bogies*t.axlesPerBogie*365)/1e6;
    return s+m*Math.pow(t.axleLoad/qRef,3);
  },0);
}
function runSim(params) {
  var ctx=CONTEXTS[params.context], rt=RAIL_TYPES[params.railType], tm=TRACK_MODES[params.trackMode];
  var lubKey=params.lubrication||"none", mgtPY=calcMGT(params.trains), eqPY=calcEqMGT(params.trains,params.context);
  var limits=LIMITS[params.context];
  if(params.customLimV!==null && params.customLimV!==undefined) limits=Object.assign({},limits,{v:params.customLimV});
  if(params.customLimL!==null && params.customLimL!==undefined) limits=Object.assign({},limits,{l:params.customLimL});
  // Reprofiling params
  var reprActive = params.reprActive || false;
  var reprThreshFrac = (params.reprThresh || 60) / 100;
  var reprRemLGlobal = params.reprRemL !== undefined ? params.reprRemL : 3.0;
  var reprRemV   = params.reprRemV !== undefined ? params.reprRemV : 0.8;
  var reprRcfR   = (params.reprRcfR !== undefined ? params.reprRcfR : 50) / 100;
  var reprSkip   = params.reprSkip  !== false;
  var reprRadiusBased = params.reprRadiusBased !== false;
  var reprRemLByBand  = params.reprRemLByBand || REPR_REM_L_DEFAULT;
  var results=params.segments.map(function(seg){
    var rb=BANDS.find(function(b){return seg.radius>=b.rMin&&seg.radius<b.rMax;})||BANDS[4];
    var ri=BANDS.indexOf(rb), grade=RAIL_GRADES[seg.railGrade]||RAIL_GRADES["R260"];
    var segSpeed = getRecommendedSegmentSpeed(seg, params.context, params.speed);
    var sfV=(SPEED_BANDS_V.find(function(s){return segSpeed<=s.max;})||SPEED_BANDS_V[SPEED_BANDS_V.length-1]).f_v;
    var speedBandId = TAMP_BAND(seg.radius || seg.repr || 9000);
    var speedLatTable = SPEED_BANDS_L[speedBandId] || SPEED_BANDS_L.r5;
    var sfL=(speedLatTable.find(function(s){return segSpeed<=s.max;})||speedLatTable[speedLatTable.length-1]).f_l;
    var lub = (LUBRICATION[lubKey]||LUBRICATION.none);
    var lubF=lub.f[ri];
    var lubRcfF=lub.f_rcf[ri];
    var he=1.0-(1.0-grade.f_wear)/(1.0+rb.f_l*0.3);
    var wrV=ctx.baseWearV*rb.f_v*he*rt.f_v*tm.f_v*sfV;
    var wrL=ctx.baseWearL*1.5*rb.f_l*he*rt.f_l*tm.f_l*sfL*lubF;
    var rcfBase=ctx.rcfRate[ri]*grade.f_rcf*sfV*lubRcfF;

    // Special zone: apply extra wear factor on vertical only
    var fVExtra = seg.fVExtra || 1.0;
    wrV = wrV * fVExtra;

    var gi=rb.grind[params.context]||999;
    // Corrugation: override preventive grinding interval if configured
    var corrMGT = seg.corrugationMGT || null;
    var gMGT = (params.strategy==="preventive" && corrMGT)
      ? corrMGT
      : (params.strategy==="preventive" ? gi : gi*3);
    var resI=params.railType==="groove"?12:(RESERVE[seg.railGrade]||15);
    var resLI=(RESERVE_L[seg.railGrade]||8); // lateral grinding reserve from constants
    var minResV=params.customResActive ? (params.customMinRes||3.0) : (MIN_RES_V[seg.railGrade]||3.0);
    var minResL=params.customResActive ? (params.customMinRes||3.0) : (MIN_RES_L[seg.railGrade]||3.0);
    var gp=params.strategy==="preventive"
      ? {rem:0.20,rcfR:0.30,pwf:0.75,pmgt:gi*0.85}
      : {rem:0.55,rcfR:0.18,pwf:0.92,pmgt:params.context==="heavy" ? gi*0.40 : 2.0};
    var segRadius = seg.radius || 9000;
    var segReprRemL = reprActive
      ? (segRadius >= 800 ? 0 : (reprRadiusBased ? getBandReprRemL(segRadius, reprRemLByBand) : reprRemLGlobal))
      : 0;
    var segReprRemV = segReprRemL * 0.30; // vertical removal = 30% of lateral (Speno TB-2019-04)
    var wV=seg.initWearV||0, wL=seg.initWearL||0, rcf=Math.min(seg.initRCF||0,0.99);
    var res=Math.max(minResV+0.5,resI-(wV*0.8)), resL=Math.max(minResL+0.5,resLI-(wL*0.7));
    var mgtSG=0, totMGT=seg.initMGT||0, pgLeft=0, gCnt=0, reprCnt=0, reprFlag=false, repY=null, data=[];
    var specialCorrectiveArmedWV = true, specialCorrectiveArmedRCF = true;
    for(var y=1;y<=params.horizonYears;y++){
      totMGT+=mgtPY; mgtSG+=mgtPY;
      var wf=pgLeft>0?gp.pwf:1.0; pgLeft=Math.max(0,pgLeft-mgtPY);
      wV+=(mgtPY/100)*wrV*wf; wL+=(mgtPY/100)*wrL*wf;
      var wp=Math.min(0.80,wrV*wf/5.0); rcf=Math.min(1.0,rcf+rcfBase*mgtPY*(1.0-wp));
      // Reprofiling: restores lateral AND vertical profile
      var reprofiled=false;
      if(reprActive&&segReprRemL>0&&wL>=reprThreshFrac*limits.l&&(resL-segReprRemL)>=minResL&&(res-segReprRemV)>=minResV){
        wL=Math.max(0,wL-segReprRemL); resL-=segReprRemL;
        wV=Math.max(0,wV-segReprRemV); res-=segReprRemV;
        rcf=Math.max(0,rcf*(1-reprRcfR));
        pgLeft=gi*0.70;
        reprCnt++; reprFlag=true; reprofiled=true;
      }
      var ground=false, grindCause=null, grindPasses=0, preGrindRCF=null, postGrindRCF=null, preGrindWearV=null, postGrindWearV=null;
      var grindByMGT = params.strategy==="preventive" && mgtSG>=gMGT;
      var grindByHeavyRCF = params.strategy==="corrective" && params.context==="heavy" && rcf>=(HEAVY_RCF_GRIND_TRIGGER[rb.id]||RCF_MAX);
      var grindByCorrugation = params.strategy==="corrective" && seg.isSpecialZone && params.context!=="heavy" && corrMGT && mgtSG>=corrMGT;
      var baseCorrectiveTrigger = CORRECTIVE_GRIND_TRIGGER[params.context] || null;
      var correctiveTrigger = seg.isSpecialZone && params.strategy==="corrective" && params.context!=="heavy"
        ? (SPECIAL_ZONE_CORRECTIVE_TRIGGER[params.context] || baseCorrectiveTrigger)
        : baseCorrectiveTrigger;
      var specialZoneRearm = SPECIAL_ZONE_CORRECTIVE_REARM[params.context] || null;
      if(seg.isSpecialZone && params.strategy==="corrective" && params.context!=="heavy" && specialZoneRearm){
        if(!specialCorrectiveArmedWV && wV < specialZoneRearm.wVFrac * limits.v) specialCorrectiveArmedWV = true;
        if(!specialCorrectiveArmedRCF && rcf < specialZoneRearm.rcf) specialCorrectiveArmedRCF = true;
      }
      var usesSpecialZoneHysteresis = seg.isSpecialZone && params.strategy==="corrective" && params.context!=="heavy" && correctiveTrigger;
      var specialZoneWvTrigger = usesSpecialZoneHysteresis && specialCorrectiveArmedWV && wV >= correctiveTrigger.wVFrac * limits.v;
      var specialZoneRcfTrigger = usesSpecialZoneHysteresis && specialCorrectiveArmedRCF && rcf >= correctiveTrigger.rcf;
      var standardConditionTrigger = params.strategy==="corrective" && correctiveTrigger && pgLeft<=0 && (
        wV >= correctiveTrigger.wVFrac * limits.v ||
        rcf >= correctiveTrigger.rcf
      );
      var standardWvTrigger = !usesSpecialZoneHysteresis && params.strategy==="corrective" && correctiveTrigger && pgLeft<=0 && wV >= correctiveTrigger.wVFrac * limits.v;
      var standardRcfTrigger = !usesSpecialZoneHysteresis && params.strategy==="corrective" && correctiveTrigger && pgLeft<=0 && rcf >= correctiveTrigger.rcf;
      var grindByCondition = usesSpecialZoneHysteresis
        ? (specialZoneWvTrigger || specialZoneRcfTrigger)
        : standardConditionTrigger;
      if((grindByMGT||grindByHeavyRCF||grindByCorrugation||grindByCondition)&&rcf<RCF_MAX&&res>minResV+0.5){
        if(reprFlag&&reprSkip){mgtSG=0;reprFlag=false;}
        else{
          preGrindRCF = rcf;
          preGrindWearV = wV;
          var corrugationOnly = grindByCorrugation && !grindByHeavyRCF && !specialZoneWvTrigger && !specialZoneRcfTrigger && !standardWvTrigger && !standardRcfTrigger;
          var passes=params.strategy==="corrective"
            ? (corrugationOnly ? 1 : Math.max(1,Math.min(4,Math.ceil(rcf/0.12))))
            : 1;
          var rem=passes*gp.rem;
          res-=rem; rcf=Math.max(0,rcf-passes*gp.rcfR*(1.0+(1.0-rcf)*0.5)); wV=Math.max(0,wV-rem*0.2);
          pgLeft=gp.pmgt; mgtSG=0; gCnt++; ground=true; reprFlag=false;
          grindPasses = passes;
          postGrindRCF = rcf;
          postGrindWearV = wV;
          if(grindByMGT) grindCause = "MGT";
          else if(grindByHeavyRCF) grindCause = "RCF heavy";
          else if(corrugationOnly) grindCause = "corrugation";
          else if(grindByCorrugation && specialZoneWvTrigger && specialZoneRcfTrigger) grindCause = "corrugation + wV + RCF";
          else if(grindByCorrugation && specialZoneWvTrigger) grindCause = "corrugation + wV";
          else if(grindByCorrugation && specialZoneRcfTrigger) grindCause = "corrugation + RCF";
          else if(grindByCorrugation && standardWvTrigger && standardRcfTrigger) grindCause = "corrugation + wV + RCF";
          else if(grindByCorrugation && standardWvTrigger) grindCause = "corrugation + wV";
          else if(grindByCorrugation && standardRcfTrigger) grindCause = "corrugation + RCF";
          else if(specialZoneWvTrigger && specialZoneRcfTrigger) grindCause = "wV + RCF";
          else if(specialZoneWvTrigger) grindCause = "wV";
          else if(specialZoneRcfTrigger) grindCause = "RCF";
          else if(standardWvTrigger && standardRcfTrigger) grindCause = "wV + RCF";
          else if(standardWvTrigger) grindCause = "wV";
          else if(standardRcfTrigger) grindCause = "RCF";
          else if(grindByCondition) grindCause = "condition";
          if(usesSpecialZoneHysteresis){
            if(specialZoneWvTrigger) specialCorrectiveArmedWV = false;
            if(specialZoneRcfTrigger) specialCorrectiveArmedRCF = false;
          }
        }
      }
      // Replacement: vertical wear, lateral wear, reserve exhausted (V or L), or RCF critical
      var repl=wV>=limits.v||wL>=limits.l||res<=minResV||resL<=minResL||rcf>=RCF_MAX;
      data.push({year:y,mgt:+totMGT.toFixed(2),wearV:+Math.min(wV,limits.v).toFixed(3),wearL:+Math.min(wL,limits.l).toFixed(3),rcf:+Math.min(rcf,1).toFixed(3),res:+Math.max(0,res).toFixed(2),resL:+Math.max(0,resL).toFixed(2),ground:ground?1:0,reprofiled:(reprofiled&&!repl)?1:0,repl:repl?1:0,grindCause:grindCause,grindPasses:grindPasses,preGrindRCF:preGrindRCF!==null?+preGrindRCF.toFixed(3):null,postGrindRCF:postGrindRCF!==null?+postGrindRCF.toFixed(3):null,preGrindWearV:preGrindWearV!==null?+Math.min(preGrindWearV,limits.v).toFixed(3):null,postGrindWearV:postGrindWearV!==null?+Math.min(postGrindWearV,limits.v).toFixed(3):null});
      if(repl&&!repY){repY=y;break;}
    }
    return {seg:seg,rb:rb,wrV:wrV,wrL:wrL,he:he,segSpeed:segSpeed,mgtPY:mgtPY,eqPY:eqPY,gCount:gCnt,reprCount:reprCnt,repY:repY,data:data,limits:limits,resL:+resL.toFixed(2)};
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
function Tip(p){
  if(!p.active||!p.payload||!p.payload.length)return null;
  var row = p.payload[0] && p.payload[0].payload;
  return <div style={{background:"#0d1f26",border:"1px solid rgba(125,211,200,0.25)",borderRadius:8,padding:"10px 14px",fontSize:12}}>
    <div style={{color:cl.teal,marginBottom:6,fontWeight:700}}>Year {p.label}</div>
    {p.payload.map(function(x){return <div key={x.name} style={{color:x.color,marginBottom:2}}>{x.name}: <b>{typeof x.value==="number"?x.value.toFixed(3):x.value}</b></div>;})}
    {row&&row.ground?(
      <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,0.08)"}}>
        <div style={{color:cl.green,fontWeight:700,marginBottom:4}}>Grinding debug</div>
        {row.grindCause&&<div style={{color:cl.text,marginBottom:2}}>Cause: <b>{row.grindCause}</b></div>}
        {row.preGrindRCF!==null&&row.preGrindRCF!==undefined&&<div style={{color:cl.warn,marginBottom:2}}>RCF pre/post: <b>{row.preGrindRCF.toFixed(3)}</b>{" -> "}<b>{row.postGrindRCF.toFixed(3)}</b></div>}
        {row.preGrindWearV!==null&&row.preGrindWearV!==undefined&&<div style={{color:cl.teal,marginBottom:2}}>Wear V pre/post: <b>{row.preGrindWearV.toFixed(3)}</b>{" -> "}<b>{row.postGrindWearV.toFixed(3)}</b></div>}
        {row.grindPasses?<div style={{color:cl.dim}}>Passes: <b>{row.grindPasses}</b></div>:null}
      </div>
    ):null}
  </div>;
}

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
  var currencies = props.currencyMap || CURRENCIES;
  var currencyOpts = props.currencyOptions || Object.keys(currencies).map(function(k){return {v:k,l:currencies[k].label};});
  const [region,    setRegion]   = useState(props.initRegion  || "WEU");
  const [currency,  setCurrency] = useState(props.initCurrency || "EUR");
  const [weldType,  setWeld]     = useState(props.initWeldType || "thermit");
  const [nightHrs,  setNight]    = useState(6);
  const [jointSp,   setJoint]    = useState(props.initJointSp || 25);
  const [ovhdPct,   setOvhd]     = useState(props.initOvhdPct || 18);
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
const [barTip,    setBarTip]   = useState(null); // {label, pct, col} for composition bar tooltip

  var base=REGIONS[region]||REGIONS.WEU;
  var p={lbr:cLbr||base.lbr, mat:cMat||base.mat, eqp:cEqp||base.eqp, weld:cWeld||base.weld, prod:cProd||base.prod, team:cTeam||base.team};

  // Notify App of current full p object so Comparison uses live custom rates
  function notifyReplParams(overrides) {
    if(!props.onParamsChange) return;
    var cur = Object.assign({lbr:cLbr||base.lbr, mat:cMat||base.mat, eqp:cEqp||base.eqp, weld:cWeld||base.weld, prod:cProd||base.prod, team:cTeam||base.team}, overrides||{});
    props.onParamsChange({region:region, ovhdPct:ovhdPct, weldType:weldType, jointSp:jointSp, customP:cur});
  }
  var sym=(currencies[currency]||currencies.EUR||CURRENCIES.EUR).symbol;
  var fx=(currencies[currency]||currencies.EUR||CURRENCIES.EUR).rate;

  function applyRegion(r){
    setRegion(r); setCLbr(null); setCMat(null); setCEqp(null); setCWeld(null); setCProd(null); setCTeam(null);
    var ovhd=Math.round((REGIONS[r]||REGIONS.WEU).ovhd*100);
    setOvhd(ovhd);
    if(props.onParamsChange) props.onParamsChange({region:r, ovhdPct:ovhd, weldType:weldType, jointSp:jointSp, customP:null});
  }
  function fmt(v){if(v>=1e6)return (v/1e6).toFixed(2)+"M "+sym;if(v>=1e3)return (v/1e3).toFixed(1)+"k "+sym;return v.toFixed(0)+" "+sym;}

  var ref=calcCostPerMl(p,"R260",weldType,nightHrs,currency,ovhdPct,withGrind,jointSp,currencies);

  var segCosts=simResult?simResult.results.map(function(r){
    if(!r.repY)return null;
    var grade=r.seg.grade||r.seg.railGrade||"R260";
    var c=calcCostPerMl(p,grade,weldType,nightHrs,currency,ovhdPct,withGrind,jointSp,currencies);
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

  function secHdr(title,open,setOpen,onOpen){
    return (
      <div onClick={function(){var next=!open;setOpen(next);if(next&&onOpen)onOpen();}} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",padding:"7px 10px",background:"rgba(255,255,255,0.04)",borderRadius:6,marginBottom:open?6:0,marginTop:8}}>
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
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <Sel value={currency} onChange={function(v){setCurrency(v);if(props.onCurrencyChange)props.onCurrencyChange(v);}} opts={currencyOpts}/>
            <div onClick={function(){if(props.onShowRates)props.onShowRates();}} style={{fontSize:10,cursor:"pointer",padding:"3px 8px",borderRadius:4,border:"1px solid rgba(125,211,200,0.3)",color:cl.teal,whiteSpace:"nowrap"}}>{props.ratesStatus==="live"?"Live rates":"Edit rates"}</div>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          <div><Lbl>Welding type</Lbl><Sel value={weldType} onChange={function(v){setWeld(v);if(props.onParamsChange)props.onParamsChange({region:region,ovhdPct:ovhdPct,weldType:v,jointSp:jointSp,customP:p});}} opts={[{v:"thermit",l:"Aluminothermic"},{v:"flash",l:"Flash butt"}]}/></div>
          <div><Lbl>Joint spacing (m)</Lbl><Inp value={jointSp} onChange={function(v){setJoint(v);if(props.onParamsChange)props.onParamsChange({region:region,ovhdPct:ovhdPct,weldType:weldType,jointSp:v,customP:p});}} min={12} max={100}/></div>
          <div><Lbl>Night window (h)</Lbl><Inp value={nightHrs} onChange={setNight} min={2} max={10} step={0.5}/></div>
          <div><Lbl>Overhead (%)</Lbl><Inp value={ovhdPct} onChange={function(v){setOvhd(v);if(props.onParamsChange)props.onParamsChange({region:region,ovhdPct:v,weldType:weldType,jointSp:jointSp,customP:p});}} min={5} max={40}/></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,padding:"8px 10px",background:"rgba(255,255,255,0.03)",borderRadius:6}}>
          <div onClick={function(){setGrind(function(v){return !v;});}} style={{width:28,height:16,borderRadius:8,background:withGrind?cl.teal:"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",border:"1px solid "+(withGrind?cl.teal:"rgba(255,255,255,0.2)")}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:withGrind?14:2}}/>
          </div>
          <span style={{fontSize:12,color:cl.text}}>Include pre-grinding pass</span>
        </div>

        {secHdr("Labour rates ("+sym+"/h)", expL, setEL, function(){if(!cLbr)setCLbr(Object.assign({},base.lbr));if(!cTeam)setCTeam(Object.assign({},base.team));})}
        {secBody(expL,
          <div>
            {[["foreman","Foreman"],[" tech","Technician"],["welder","Welder"],["mach","Machinist"]].map(function(item){
              var k=item[0].trim(), lbl=item[1];
              var val=(cLbr||base.lbr)[k];
              return iRow(lbl+" ("+sym+"/h)", val, sym+"/h", function(v){var nv=Object.assign({},(cLbr||base.lbr),{[k]:v});setCLbr(nv);notifyReplParams({lbr:nv});}, 1);
            })}
            <div style={{marginTop:8,fontSize:11,color:cl.dim}}>Team size:</div>
            {[["foreman","Foreman"],["tech","Technicians"],["welder","Welders"],["mach","Machinists"]].map(function(item){
              var k=item[0], lbl=item[1];
              var val=(cTeam||base.team)[k];
              return iRow(lbl, val, "persons", function(v){var nv=Object.assign({},(cTeam||base.team),{[k]:v});setCTeam(nv);notifyReplParams({team:nv});}, 1);
            })}
          </div>
        )}

        {secHdr("Rail material ("+sym+"/tonne)", expM, setEM, function(){if(!cMat)setCMat(Object.assign({},base.mat));})}
        {secBody(expM,
          <div>
            {["R260","R320Cr","R350HT","R400HT"].map(function(k){
              var val=(cMat||base.mat)[k]||0, kgm=RAIL_KGM[k]||60;
              return iRow(k+" ("+kgm+"kg/m)", val, sym+"/t", function(v){var nv=Object.assign({},(cMat||base.mat),{[k]:v});setCMat(nv);notifyReplParams({mat:nv});}, 10);
            })}
            <div style={{fontSize:10,color:cl.dim,marginTop:4}}>Material cost = price/t x kg/m x 2 rails</div>
          </div>
        )}

        {secHdr("Equipment rental ("+sym+"/h)", expE, setEE, function(){if(!cEqp)setCEqp(Object.assign({},base.eqp));if(!cWeld)setCWeld(Object.assign({},base.weld));})}
        {secBody(expE,
          <div>
            {[["tamper","Tamping machine"],["rr","Rail-road vehicle"],["crane","Track crane"],["truck","Logistics truck"],["grinder","Rail grinder"]].map(function(item){
              var k=item[0], lbl=item[1];
              var val=(cEqp||base.eqp)[k];
              return iRow(lbl, val, sym+"/h", function(v){var nv=Object.assign({},(cEqp||base.eqp),{[k]:v});setCEqp(nv);notifyReplParams({eqp:nv});}, 10);
            })}
            <div style={{marginTop:8,fontSize:11,color:cl.dim}}>Welding cost per joint:</div>
            {[["thermit","Aluminothermic"],["flash","Flash butt"]].map(function(item){
              var k=item[0], lbl=item[1];
              var val=(cWeld||base.weld)[k];
              return iRow(lbl, val, sym+"/joint", function(v){var nv=Object.assign({},(cWeld||base.weld),{[k]:v});setCWeld(nv);notifyReplParams({weld:nv});}, 10);
            })}
          </div>
        )}

        {secHdr("Team productivity (ml/h)", expP, setEP, function(){if(!cProd)setCProd(Object.assign({},base.prod));})}
        {secBody(expP,
          <div>
            {[["rem","Rail removal"],["lay","Rail laying"],["tamp","Tamping/geometry"]].map(function(item){
              var k=item[0], lbl=item[1];
              var val=(cProd||base.prod)[k];
              return iRow(lbl, val, "ml/h", function(v){var nv=Object.assign({},(cProd||base.prod),{[k]:v});setCProd(nv);notifyReplParams({prod:nv});}, 0.5);
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
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:6}}>
              <div style={{fontSize:11,color:cl.dim}}>Cost composition</div>
              {barTip&&<div style={{fontSize:11,fontWeight:700,color:barTip.col}}>{barTip.label}: {barTip.pct}%</div>}
            </div>
            <div style={{display:"flex",height:18,borderRadius:4,overflow:"hidden",cursor:"pointer"}}
              onMouseLeave={function(){setBarTip(null);}}>
              {bars.map(function(b,i){
                var pct = ((b.val/ref.total)*100).toFixed(1);
                return <div key={i}
                  style={{width:pct+"%",background:b.col,opacity:barTip&&barTip.label===b.label?1:0.75,transition:"opacity 0.15s"}}
                  onMouseEnter={function(){setBarTip({label:b.label,pct:pct,col:b.col});}}
                />;
              })}
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

function calcGrindCostPerMl(machine, mode, region, nightHrs, passes, currency, currencyMap) {
  var currencies = currencyMap || CURRENCIES;
  var fx = (currencies[currency]||currencies.EUR||CURRENCIES.EUR).rate;
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
  var currencies = props.currencyMap || CURRENCIES;
  var currencyOpts = props.currencyOptions || Object.keys(currencies).map(function(k){return {v:k,l:currencies[k].label};});

  const [machineKey, setMachine]  = useState(props.initMachine || "line");
  const [mode,       setMode]     = useState(props.initMode    || "sub");
  const [region,     setRegion]   = useState(props.initRegion  || "WEU");
  const [currency,   setCurrency] = useState(props.initCurrency || "EUR");
  const [nightHrs,   setNight]    = useState(props.initNight   || 6);
  const [distKm,     setDist]     = useState(props.initDist    || 80);
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
  const [stoneView,  setStoneView]= useState("first"); // "first" or "full"
  const [stonePriceEur, setStoneP]= useState(null);  // null = no price entered
  const [customStoneRates, setCstR]= useState(null); // null = use presets

  var machine = GRIND_MACHINES[machineKey] || GRIND_MACHINES.line;
  var sym = (currencies[currency]||currencies.EUR||CURRENCIES.EUR).symbol;
  var fx  = (currencies[currency]||currencies.EUR||CURRENCIES.EUR).rate;
  var hasOwned = !!machine.ownedRates;

  function resetRates() {
    setCOp(null); setCMF(null); setCMK(null);
    setCStones(null); setCFuel(null); setCMaint(null); setCLabour(null); setCSpeed(null);
    setCstR(null);
    if(props.onParamsChange) {
      props.onParamsChange({machineKey:machineKey,mode:mode,region:region,nightHrs:nightHrs,distKm:distKm,mobilPerInt:mobilPerInt,cOpPerMl:null,cMobilFix:null,cMobilKm:null});
    }
  }
  function notifyParent(updates) {
    if (props.onParamsChange) {
      props.onParamsChange(Object.assign({
        machineKey:machineKey, mode:mode, region:region,
        nightHrs:nightHrs, distKm:distKm, mobilPerInt:mobilPerInt,
        cOpPerMl:cOpPerMl, cMobilFix:cMobilFix, cMobilKm:cMobilKm,
      }, updates));
    }
  }
  function onMachineChange(k) {
    setMachine(k); resetRates(); notifyParent({machineKey:k});
    // Pre-initialize inputs for the new machine so spinners work from correct base
    var nm = GRIND_MACHINES[k] || machine;
    if(mode==="sub" && nm.subRates) {
      var sr = nm.subRates;
      setCOp( sr.opPerMl[region]   || sr.opPerMl.WEU);
      setCMF( sr.mobilFix[region]  || sr.mobilFix.WEU);
      setCMK( sr.mobilPerKm[region]|| sr.mobilPerKm.WEU);
    } else if(mode==="owned" && nm.ownedRates) {
      var or3 = nm.ownedRates;
      setCStones(or3.stones); setCFuel(or3.fuel); setCMaint(or3.maint);
      setCLabour(or3.labour[region]||or3.labour.WEU);
    }
    setCSpeed(nm.speedMlH);
  }
  function onRegionChange(r)  { setRegion(r);  resetRates(); notifyParent({region:r}); }

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
    var c = calcGrindCostPerMl(getEffectiveMachine(), mode, region, nightHrs, 1, currency, currencies);
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
    // Full horizon: repeat cycles from greenfield
    var repY2 = r.repY;
    var passesH = 0;
    if(repY2){var yr2=0;while(yr2+repY2<=horizon){yr2+=repY2;passesH+=passes;}var fr2=(horizon-yr2)/repY2;if(fr2>0)passesH+=Math.round(passes*fr2);}
    else{passesH=passes;}
    var totalStonesH  = stonesPerPass * passesH;
    var totalWeightH  = totalStonesH * stoneWt;
    var totalCostH    = stonePriceEur !== null ? totalStonesH * stonePriceEur * fx : null;
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
      passesH:        passesH,
      totalStonesH:   totalStonesH,
      totalWeightH:   totalWeightH,
      totalCostH:     totalCostH,
    };
  }).filter(Boolean) : [];

  var grandTotalStones = stoneRows.reduce(function(a,s){return a+s.totalStones;},0);
  var grandTotalStCost = stonePriceEur !== null
    ? stoneRows.reduce(function(a,s){return a+(s.totalCostStones||0);},0)
    : null;
  var grandTotalStonesH = stoneRows.reduce(function(a,s){return a+s.totalStonesH;},0);
  var grandTotalStCostH = stonePriceEur !== null
    ? stoneRows.reduce(function(a,s){return a+(s.totalCostH||0);},0)
    : null;

  var mobilOnce = calcGrindCostPerMl(getEffectiveMachine(), mode, region, nightHrs, 1, currency, currencies);
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
            <Btn onClick={function(){
              setMode("owned"); notifyParent({mode:"owned"});
              if(machine.ownedRates) {
                var or4=machine.ownedRates;
                setCStones(or4.stones); setCFuel(or4.fuel); setCMaint(or4.maint);
                setCLabour(or4.labour[region]||or4.labour.WEU);
              }
              setCSpeed(machine.speedMlH);
            }} active={mode==="owned"} sm={true}>Own fleet</Btn>
            <Btn onClick={function(){
              setMode("sub"); notifyParent({mode:"sub"});
              if(machine.subRates) {
                var sr2=machine.subRates;
                setCOp( sr2.opPerMl[region]   || sr2.opPerMl.WEU);
                setCMF( sr2.mobilFix[region]  || sr2.mobilFix.WEU);
                setCMK( sr2.mobilPerKm[region]|| sr2.mobilPerKm.WEU);
              }
            }} active={mode==="sub"} sm={true}>Subcontract</Btn>
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
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <Sel value={currency} onChange={function(v){setCurrency(v);if(props.onCurrencyChange)props.onCurrencyChange(v);}} opts={currencyOpts}/>
            <div onClick={function(){if(props.onShowRates)props.onShowRates();}} style={{fontSize:10,cursor:"pointer",padding:"3px 8px",borderRadius:4,border:"1px solid rgba(125,211,200,0.3)",color:cl.teal,whiteSpace:"nowrap"}}>{props.ratesStatus==="live"?"Live rates":"Edit rates"}</div>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          <div><Lbl>Night window (h)</Lbl><Inp value={nightHrs} onChange={function(v){setNight(v);notifyParent({nightHrs:v});}} min={2} max={10} step={0.5}/></div>
          {mode==="sub"&&<div><Lbl>Distance from depot (km)</Lbl><Inp value={distKm} onChange={function(v){setDist(v);notifyParent({distKm:v});}} min={0} max={2000}/></div>}
        </div>

        {mode==="sub"&&(
          <div style={{marginBottom:12}}>
            <Lbl>Mobilisation cost</Lbl>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={function(){setMobil(true);  notifyParent({mobilPerInt:true});}}  active={mobilPerInt}  sm={true}>Per intervention</Btn>
              <Btn onClick={function(){setMobil(false); notifyParent({mobilPerInt:false});}} active={!mobilPerInt} sm={true}>Once per horizon</Btn>
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
              <div onClick={function(){
                var next = !showRates;
                setShowRates(next);
                if(next) {
                  // Initialize inputs to current preset values so spinner arrows work from correct base
                  if(mode==="sub") {
                    var sr = machine.subRates;
                    if(cOpPerMl  === null) setCOp( sr.opPerMl[region]   || sr.opPerMl.WEU);
                    if(cMobilFix === null) setCMF( sr.mobilFix[region]  || sr.mobilFix.WEU);
                    if(cMobilKm  === null) setCMK( sr.mobilPerKm[region]|| sr.mobilPerKm.WEU);
                  } else if(mode==="owned" && machine.ownedRates) {
                    var or2 = machine.ownedRates;
                    if(cStones  === null) setCStones(or2.stones);
                    if(cFuel    === null) setCFuel(or2.fuel);
                    if(cMaint   === null) setCMaint(or2.maint);
                    if(cLabour  === null) setCLabour(or2.labour[region]||or2.labour.WEU);
                  }
                  if(cSpeedMlH === null) setCSpeed(machine.speedMlH);
                }
              }} style={{fontSize:10,color:cl.dim,cursor:"pointer",padding:"2px 8px",background:"rgba(255,255,255,0.04)",borderRadius:4}}>
                {showRates?"collapse":"edit rates"}
              </div>
            </div>
          </div>

          {!showRates&&(
            <div>
                      <div style={{fontSize:12,color:cl.dim,marginBottom:4}}>Operation cost: <b style={{color:cl.teal}}>{calcGrindCostPerMl(getEffectiveMachine(),mode,region,nightHrs,1,currency,currencies).perMl.toFixed(2)} {sym}/ml/pass</b></div>
              {mode==="sub"&&<div style={{fontSize:12,color:cl.dim,marginBottom:4}}>Mobilisation (fixed): <b style={{color:cl.amber}}>{fmt(mobilOnce.mobilFix)}</b></div>}
              {mode==="sub"&&<div style={{fontSize:12,color:cl.dim,marginBottom:4}}>Mobilisation (distance): <b style={{color:cl.amber}}>{mobilOnce.mobilPerKm.toFixed(1)} {sym}/km x {distKm} km = {fmt(mobilOnce.mobilPerKm*distKm)}</b></div>}
              {mode==="sub"&&<div style={{fontSize:12,color:cl.dim,marginBottom:4}}>Total mobilisation: <b style={{color:cl.amber}}>{fmt(mobilCostOnce)}</b></div>}
              <div style={{fontSize:12,color:cl.dim}}>Productivity: <b style={{color:cl.teal}}>{calcGrindCostPerMl(getEffectiveMachine(),mode,region,nightHrs,1,currency,currencies).mlPerNight.toFixed(0)} ml/night</b></div>
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

                  <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6,marginBottom:2}}>
                    <span style={{fontSize:11,color:cl.dim}}>Operation (per ml/pass)</span>
                    <input type="number"
                      value={cOpPerMl!==null ? cOpPerMl : (machine.subRates.opPerMl[region]||machine.subRates.opPerMl.WEU)}
                      min={0} step={0.5}
                      onChange={function(e){var v=+e.target.value;setCOp(v);notifyParent({cOpPerMl:v});}}
                      style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                    <span style={{fontSize:11,color:cl.muted}}>EUR/ml/pass</span>
                  </div>
                  <div style={{fontSize:10,color:cl.teal,marginBottom:8,paddingLeft:148}}>
                    Total op. cost for 1 km, 1 pass: <b>{((cOpPerMl!==null?cOpPerMl:(machine.subRates.opPerMl[region]||machine.subRates.opPerMl.WEU))*1000).toFixed(0)} EUR</b>
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6,marginBottom:2}}>
                    <span style={{fontSize:11,color:cl.dim}}>Mobilisation fixed fee</span>
                    <input type="number"
                      value={cMobilFix!==null ? cMobilFix : (machine.subRates.mobilFix[region]||machine.subRates.mobilFix.WEU)}
                      min={0} step={100}
                      onChange={function(e){var v=+e.target.value;setCMF(v);notifyParent({cMobilFix:v});}}
                      style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                    <span style={{fontSize:11,color:cl.muted}}>EUR/intervention</span>
                  </div>
                  <div style={{fontSize:10,color:cl.amber,marginBottom:8,paddingLeft:148}}>
                    Fixed part of mobilisation per intervention
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6,marginBottom:2}}>
                    <span style={{fontSize:11,color:cl.dim}}>Mobilisation per km</span>
                    <input type="number"
                      value={cMobilKm!==null ? cMobilKm : (machine.subRates.mobilPerKm[region]||machine.subRates.mobilPerKm.WEU)}
                      min={0} step={0.5}
                      onChange={function(e){var v=+e.target.value;setCMK(v);notifyParent({cMobilKm:v});}}
                      style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                    <span style={{fontSize:11,color:cl.muted}}>EUR/km</span>
                  </div>
                  <div style={{fontSize:10,color:cl.amber,marginBottom:6,paddingLeft:148}}>
                    Distance cost: <b>{((cMobilKm!==null?cMobilKm:(machine.subRates.mobilPerKm[region]||machine.subRates.mobilPerKm.WEU))*distKm).toFixed(0)} EUR</b> ({distKm} km)
                    {" | "}Total mobil: <b>{((cMobilFix!==null?cMobilFix:(machine.subRates.mobilFix[region]||machine.subRates.mobilFix.WEU))+(cMobilKm!==null?cMobilKm:(machine.subRates.mobilPerKm[region]||machine.subRates.mobilPerKm.WEU))*distKm).toFixed(0)} EUR</b>
                  </div>
                </div>
              )}

              {mode==="owned"&&machine.ownedRates&&(
                <div>
                  <div style={{fontSize:11,color:cl.dim,fontWeight:600,marginBottom:6,marginTop:4}}>Own fleet rates (per ml per pass)</div>
                  <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6,marginBottom:2}}>
                    <span style={{fontSize:11,color:cl.dim}}>Grinding stones</span>
                    <input type="number" value={cStones!==null?cStones:machine.ownedRates.stones} min={0} step={0.1}
                      onChange={function(e){setCStones(+e.target.value);}}
                      style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                    <span style={{fontSize:11,color:cl.muted}}>EUR/ml</span>
                  </div>
                  {(function(){
                    var stRateEur = cStones!==null?cStones:machine.ownedRates.stones; // EUR/ml preset
                    var stRateLocal = stRateEur * ((currencies[currency]||currencies.EUR||CURRENCIES.EUR).rate); // in local currency
                    var localSym = (currencies[currency]||currencies.EUR||CURRENCIES.EUR).symbol;
                    var avgRateKm = stoneRows.length>0
                      ? stoneRows.reduce(function(a,s){return a+s.ratePerKmPerPass*s.lengthKm;},0)/stoneRows.reduce(function(a,s){return a+s.lengthKm;},0)
                      : null;
                    // stonePriceEur is entered in local currency (sym/stone)
                    var impliedLocal = (avgRateKm!==null && stonePriceEur!==null)
                      ? (avgRateKm/1000)*stonePriceEur
                      : null;
                    return (
                      <div style={{fontSize:10,color:cl.teal,marginBottom:8,paddingLeft:148}}>
                        For 1 km: <b>{(stRateLocal*1000).toFixed(0)} {localSym}</b>
                        {impliedLocal!==null&&(
                          <span style={{marginLeft:12,color:impliedLocal>stRateLocal*1.2||impliedLocal<stRateLocal*0.8?"#f87171":cl.teal}}>
                            {" | "}Implied from stone price: <b>{impliedLocal.toFixed(2)} {localSym}/ml</b>
                            {impliedLocal>stRateLocal*1.2&&<span style={{color:"#f87171",marginLeft:6}}>(preset may be underestimated)</span>}
                            {impliedLocal<stRateLocal*0.8&&<span style={{color:"#f87171",marginLeft:6}}>(preset may be overestimated)</span>}
                            {impliedLocal>=stRateLocal*0.8&&impliedLocal<=stRateLocal*1.2&&<span style={{color:cl.teal,marginLeft:6}}>(consistent)</span>}
                          </span>
                        )}
                        {impliedLocal===null&&avgRateKm!==null&&(
                          <span style={{marginLeft:12,color:"#4a6a74"}}>Set stone price below to see implied {localSym}/ml</span>
                        )}
                      </div>
                    );
                  })()}
                  <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6,marginBottom:2}}>
                    <span style={{fontSize:11,color:cl.dim}}>Fuel / energy</span>
                    <input type="number" value={cFuel!==null?cFuel:machine.ownedRates.fuel} min={0} step={0.1}
                      onChange={function(e){setCFuel(+e.target.value);}}
                      style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                    <span style={{fontSize:11,color:cl.muted}}>EUR/ml</span>
                  </div>
                  <div style={{fontSize:10,color:cl.teal,marginBottom:8,paddingLeft:148}}>For 1 km: <b>{(((cFuel!==null?cFuel:machine.ownedRates.fuel))*1000).toFixed(0)} EUR</b></div>
                  <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6,marginBottom:2}}>
                    <span style={{fontSize:11,color:cl.dim}}>Maintenance</span>
                    <input type="number" value={cMaint!==null?cMaint:machine.ownedRates.maint} min={0} step={0.1}
                      onChange={function(e){setCMaint(+e.target.value);}}
                      style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                    <span style={{fontSize:11,color:cl.muted}}>EUR/ml</span>
                  </div>
                  <div style={{fontSize:10,color:cl.teal,marginBottom:8,paddingLeft:148}}>For 1 km: <b>{(((cMaint!==null?cMaint:machine.ownedRates.maint))*1000).toFixed(0)} EUR</b></div>
                  <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6,marginBottom:2}}>
                    <span style={{fontSize:11,color:cl.dim}}>Labour rate (fully loaded)</span>
                    <input type="number" value={cLabour!==null?cLabour:(machine.ownedRates.labour[region]||machine.ownedRates.labour.WEU)} min={0} step={1}
                      onChange={function(e){setCLabour(+e.target.value);}}
                      style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                    <span style={{fontSize:11,color:cl.muted}}>EUR/h/person</span>
                  </div>
                  {(function(){var lr=cLabour!==null?cLabour:(machine.ownedRates.labour[region]||machine.ownedRates.labour.WEU);var tm=machine.ownedRates.team||2;var spd=cSpeedMlH!==null?cSpeedMlH:machine.speedMlH;return <div style={{fontSize:10,color:cl.teal,marginBottom:6,paddingLeft:148}}>Labour: <b>{lr.toFixed(0)} EUR/h/person</b>{" | "}Team cost: <b>{(lr*tm/spd).toFixed(2)} EUR/ml</b> ({tm} persons @ {spd} ml/h)</div>;})()} 
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
                <div style={{fontSize:10,color:"#4a6a74",marginTop:4}}>Night productivity = speed x window x 70% efficiency = <b style={{color:cl.teal}}>{calcGrindCostPerMl(getEffectiveMachine(),mode,region,nightHrs,1,currency,currencies).mlPerNight.toFixed(0)} ml/night</b></div>
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

                  {/* View toggle */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div style={{fontSize:11,color:cl.dim}}>{stoneView==="first"?"First cycle (to first replacement)":"Full "+horizon+"-year horizon (all cycles)"}</div>
                    <div style={{display:"flex",gap:0,border:"1px solid rgba(125,211,200,0.25)",borderRadius:6,overflow:"hidden"}}>
                      <div onClick={function(){setStoneView("first");}} style={{padding:"4px 12px",fontSize:11,fontWeight:600,cursor:"pointer",background:stoneView==="first"?cl.teal:"transparent",color:stoneView==="first"?"#0d1f26":cl.dim}}>First cycle</div>
                      <div onClick={function(){setStoneView("full");}} style={{padding:"4px 12px",fontSize:11,fontWeight:600,cursor:"pointer",background:stoneView==="full"?cl.teal:"transparent",color:stoneView==="full"?"#0d1f26":cl.dim,borderLeft:"1px solid rgba(125,211,200,0.25)"}}>Full {horizon}yr</div>
                    </div>
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
                    <div style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"10px 14px"}}>
                      <div style={{fontSize:10,color:cl.dim,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Stones / km / pass</div>
                      <div style={{fontSize:16,fontWeight:700,color:cl.teal,fontFamily:"monospace"}}>
                        {stoneRows.length>0?(stoneRows.reduce(function(a,s){return a+s.ratePerKmPerPass*s.lengthKm;},0)/stoneRows.reduce(function(a,s){return a+s.lengthKm;},0)).toFixed(1):"--"}
                        <span style={{fontSize:11,fontWeight:400,marginLeft:4,color:cl.muted}}>stones/km/pass</span>
                      </div>
                      <div style={{fontSize:10,color:"#4a6a74",marginTop:4}}>weighted avg, both rails</div>
                    </div>
                    <div style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"10px 14px"}}>
                      <div style={{fontSize:10,color:cl.dim,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Total stones</div>
                      <div style={{fontSize:16,fontWeight:700,color:cl.teal,fontFamily:"monospace"}}>
                        {(stoneView==="first"?grandTotalStones:grandTotalStonesH).toFixed(0)}
                        <span style={{fontSize:11,fontWeight:400,marginLeft:4,color:cl.muted}}>stones</span>
                      </div>
                      <div style={{fontSize:10,color:"#4a6a74",marginTop:4}}>{((stoneView==="first"?grandTotalStones:grandTotalStonesH)*(STONE_WEIGHT_KG[machineKey]||1.4)/1000).toFixed(2)} t total weight</div>
                    </div>
                    <div style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"10px 14px"}}>
                      <div style={{fontSize:10,color:cl.dim,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Stone cost</div>
                      {(stoneView==="first"?grandTotalStCost:grandTotalStCostH) !== null ? (
                        <div style={{fontSize:16,fontWeight:700,color:cl.amber,fontFamily:"monospace"}}>{fmt(stoneView==="first"?grandTotalStCost:grandTotalStCostH)}</div>
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
                            return <th key={h} style={{padding:"8px 12px",textAlign:"left",color:cl.dim,fontWeight:600,fontSize:10,letterSpacing:1}}>{h}</th>;
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {stoneRows.map(function(s,i){
                          var passes    = stoneView==="first" ? s.passes    : s.passesH;
                          var totSt     = stoneView==="first" ? s.totalStones    : s.totalStonesH;
                          var totWt     = stoneView==="first" ? s.totalWeightKg  : s.totalWeightH;
                          var totCost   = stoneView==="first" ? s.totalCostStones: s.totalCostH;
                          return(
                          <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.04)",background:i%2===0?"rgba(125,211,200,0.02)":"transparent"}}>
                            <td style={{padding:"8px 12px",color:"#e8f4f3",fontWeight:500}}>{s.seg.label}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.purple}}>{s.grade}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{s.lengthKm.toFixed(1)} km</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.teal}}>{passes}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{s.ratePerKmPerPass.toFixed(1)}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{s.stonesPerPass.toFixed(0)}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{totSt.toFixed(0)}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{totWt.toFixed(0)} kg</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.amber}}>{totCost!==null?fmt(totCost):"-"}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{borderTop:"2px solid rgba(125,211,200,0.2)",background:"rgba(125,211,200,0.04)"}}>
                          <td colSpan={6} style={{padding:"10px 12px",color:cl.teal,fontWeight:700,fontSize:12}}>TOTAL {stoneView==="first"?"(first cycle)":"("+horizon+"yr)"}</td>
                          <td style={{padding:"10px 12px",fontFamily:"monospace",color:cl.teal,fontWeight:800,fontSize:13}}>{(stoneView==="first"?grandTotalStones:grandTotalStonesH).toFixed(0)} stones</td>
                          <td style={{padding:"10px 12px",fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{((stoneView==="first"?grandTotalStones:grandTotalStonesH)*(STONE_WEIGHT_KG[machineKey]||1.4)/1000).toFixed(2)} t</td>
                          <td style={{padding:"10px 12px",fontFamily:"monospace",color:cl.amber,fontWeight:700}}>{(stoneView==="first"?grandTotalStCost:grandTotalStCostH)!==null?fmt(stoneView==="first"?grandTotalStCost:grandTotalStCostH):"-"}</td>
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
   body:"Rail Wear and Maintenance Simulator v1.2 - Created by Mohamed BOUDIA.\n\nPURPOSE: Estimates rail wear progression, grinding cycles, reprofiling interventions, replacement timelines, and full lifecycle costs for tram, metro/LRT, and heavy rail.\n\nPHYSICS ENGINE: Archard wear model (1953) + Eisenmann dynamic load formula + RCF damage accumulation.\n\nCALIBRATION: Infrabel/TU Delft 2023 big-data study (5338 km, Belgium 2012-2019) and Guangzhou Metro field measurements (2021-2022, China).\n\nCONTEXTS: Tram (Q_ref=10t), Metro/LRT (Q_ref=15t), Heavy rail (Q_ref=22.5t). Each radius band simulated independently on annual time step.\n\nMAINTENANCE STRATEGIES:\n- Preventive grinding: MGT-scheduled, crown only, 0.20mm/pass\n- Corrective grinding: 3x interval, up to 4 passes, 0.55mm/pass\n- Heavy rail RCF control: grinding is triggered when the MGT cycle is reached OR when the heavy-context RCF trigger is reached (r1=0.45, r2=0.32, r3=0.30, r4=0.32, r5=0.38)\n- Reprofiling: geometry-triggered, crown + gauge face, radius-based removal\n\nSTANDARDS: EN 13674-1:2011, UIC 714R, EN 15692, prEN 17343, Network Rail NR/L2/TRK/001, IHHA 2019.",
   links:[
     {label:"EN 13674-1:2011 - Rail profiles and wear limits",url:"https://www.en-standard.eu/bs-en-13674-1-2011-railway-applications-track-rail/",type:"standard"},
     {label:"UIC 714R - Rail defect catalogue",url:"https://uic.org/IMG/pdf/714r.pdf",type:"standard"},
     {label:"prEN 17343 - Rail grinding specification (CEN)",url:"https://standards.cen.eu/dyn/www/f?p=204:110:0::::FSP_PROJECT:67843",type:"standard"},
   ]
  },
  {id:"mgt",title:"MGT - Traffic Loading",
   body:"DEFINITION: Gross MGT/yr = (Passes/day x Axle load x Bogies x Axles/bogie x 365) / 1,000,000. Multiple train types summed linearly.\n\nEQUIVALENT MGT (damage): MGT_eq = MGT x (Q_axle / Q_ref)^3. A 20t axle causes ~8x more wear than a 10t axle at same gross tonnage. Exponent n=3 for wear (Archard), n=4 for fatigue/RCF.\n\nPASSES/DAY MODES:\n1. Manual: direct trains/day entry\n2. Weekly profile: (5 x weekday + saturday + sunday) / 7\n3. Mileage profile: (fleet x km/train/yr) / (section_km x 365)\n\nPARAMETER IMPACTS:\n- Passes/day: direct linear effect. Doubling passes = doubling wear.\n- Axle load: cubic effect via eq. MGT. +10% axle load = +33% wear damage. Most sensitive parameter.\n- Bogies x Axles/bogie: linear effect on total axle passes.\n\nREFERENCE LOADS: Tram=10t, Metro=15t, Heavy=22.5t (mixed freight/passenger).",
   links:[
     {label:"Archard J.F. (1953) - Contact and Rubbing of Flat Surfaces, J.Applied Physics 24(8)",url:"https://doi.org/10.1063/1.1721448",type:"paper"},
     {label:"IHHA Wheel-Rail Interface Guidelines, 5th ed. (2019)",url:"https://www.ihha.net/",type:"standard"},
     {label:"EN 13674-1:2011 Annex A - Load equivalence",url:"https://www.en-standard.eu/bs-en-13674-1-2011-railway-applications-track-rail/",type:"standard"},
   ],
   details:[
     {heading:"Gross MGT/yr vs Equivalent MGT -- the critical difference",
      text:"Gross MGT/yr measures total WEIGHT passing over a point. It describes line busyness but does NOT directly predict wear or RCF damage, because two trains with different axle loads cause very different damage at the same gross tonnage.\n\nEquivalent MGT corrects for this using the power law:\n\nMGT_eq = MGT_gross x (Q_axle / Q_ref)^n\n\nWhere:\n- Q_axle = actual axle load of the train\n- Q_ref = reference axle load for context (Tram 10t, Metro 15t, Heavy 22.5t)\n- n = 3 for wear/abrasion (Archard model)\n- n = 4 for RCF/fatigue damage\n\nPractical consequence: a line carrying 5 MGT/yr of heavy freight (25t axle, Q_ref=22.5t) generates MGT_eq = 5 x (25/22.5)^3 = 6.8 MGT_eq -- 36% more damage than gross tonnage suggests. A mixed line where 20% of trains are heavy freight can have equivalent MGT 2-3x higher than gross MGT."},
     {table:[["Axle load","Ratio to 15t ref","Wear factor (n=3)","RCF factor (n=4)"],
             ["10t (tram)","x0.67","x0.30","x0.20"],
             ["12t (light metro)","x0.80","x0.51","x0.41"],
             ["15t (metro ref)","x1.00","x1.00","x1.00"],
             ["17t (heavy metro)","x1.13","x1.44","x1.63"],
             ["20t (regional)","x1.33","x2.37","x3.16"],
             ["25t (freight)","x1.67","x4.63","x7.72"]]},
     {heading:"Passes/day calculation modes",
      text:"MANUAL MODE\nDirect entry of trains/day. Use when the timetable frequency is known. Most straightforward.\n\nWEEKLY PROFILE MODE\nFormula: passes/day = (5 x weekday + saturday + sunday) / 7\nUse when your line has significantly different service levels on weekends (typical for commuter lines). A metro with 200 trains Mon-Fri but only 120 on weekends has an effective 180 trains/day -- using 200 would overestimate wear by ~11%.\n\nMILEAGE PROFILE MODE\nFormula: passes/day = (fleet_size x mileage_per_train_km_yr) / (section_km x 365)\nUse when you have fleet utilization data from your operator (annual reports, maintenance contracts). Useful when timetable data is unavailable but fleet KPI data is accessible.\n\nAll three modes feed the same MGT formula -- they are simply different ways to derive the passes/day input. The active mode is shown with a badge (FROM PROFILE or FROM MILEAGE) on the Passes/day field."},
     {heading:"Multiple train types -- fleet mixing",
      text:"When multiple train types share a line, Gross MGT is the sum across all types:\n\nMGT_total = Sum(Passes_i x AxleLoad_i x Bogies_i x Axles_i x 365 / 1e6)\n\nEquivalent MGT weights the damage contribution of each fleet type:\n\nMGT_eq = Sum(MGT_i x (Q_i / Q_ref)^3)\n\nA fleet mix of 80% light metro (12t) and 20% heavier rolling stock (17t) on a metro line (Q_ref=15t) has a combined MGT_eq noticeably higher than the gross figure suggests. Always check the equivalent MGT displayed in the simulation results -- it is the operationally relevant number for maintenance planning."},
   ]
  },
  {id:"radius",title:"Radius Bands and Wear Factors",
   body:"CONCEPT: Five radius bands define vertical multiplier f_V and lateral multiplier f_L relative to large-radius / tangent track. r5 keeps the vertical reference at 1.0 but now uses a reduced lateral factor (0.65) to reflect the much lower gauge-face wear observed above 800 m.\n\nBAND TABLE (f_V / f_L):\n- r1: R<100m       6.0 / 15.0  Severe flange/gauge face contact\n- r2: R100-200m    4.0 / 9.0   Significant lateral creep\n- r3: R200-400m    2.5 / 5.0   Mixed wear modes\n- r4: R400-800m    1.5 / 2.5   Mostly crown contact\n- r5: R>=800m      1.0 / 0.65  Large-radius / tangent residual lateral wear\n\nIMPACT: Wrong band = 50-300% error. Wrong representative radius within band = 5-15% error. Rail grade hardness benefit is progressively capped on tighter curves: R400HT saves 38% on large-radius / tangent track but only 14% on R<150m.",
   links:[
     {label:"Infrabel/TU Delft (2023) - Big-data analysis of rail wear, Wear 522",url:"https://doi.org/10.1016/j.wear.2022.204764",type:"paper"},
     {label:"Magel et al. (2017) - Wheel-Rail Tribology, Elsevier",url:"https://doi.org/10.1016/B978-0-12-809819-4.00001-X",type:"paper"},
     {label:"EN 13231-3:2012 - Inspection and acceptance of rail grinding",url:"https://standards.cen.eu/dyn/www/f?p=204:110:0::::FSP_PROJECT:28028",type:"standard"},
   ],
   details:[
     {heading:"Radius Bands and Wear Factors",
      text:"Each segment is assigned to one of 5 radius bands. The band determines two key multipliers:\n\nf_V (vertical): amplifies crown wear\nf_L (lateral): amplifies flange/gauge face wear\n\nTight curves have much higher lateral factors because wheel flange contact is intense and the sliding friction against the rail gauge face is the dominant wear mechanism."},
     {table:[["Band","Radius","f_V","f_L","Dominant mechanism"],
             ["r1","R < 100 m","6.0","15.0","Flange sliding - severe gauge face wear"],
             ["r2","R 100-200 m","4.0","9.0","Mixed flange + crown contact"],
             ["r3","R 200-400 m","2.5","5.0","Transitional - both mechanisms active"],
             ["r4","R 400-800 m","1.5","2.5","Crown contact dominant - RCF peak zone"],
             ["r5","R > 800 m (large radius / tangent)","1.0","0.65","Mostly rolling - limited gauge-face wear"]]},
     {heading:"Why lateral wear dominates in tight curves",
      text:"In curves below R200m, the wheel bogie cannot steer freely and the outer wheel flange bears hard against the gauge face. The contact is no longer rolling - it is a combination of rolling and intense lateral sliding. This produces wear rates 15x higher than tangent track.\n\nIn contrast, the inner rail in tight curves can experience RCF from the back of the flange contact, while the outer rail suffers primarily gauge face wear."},
   ]
  },
  {id:"wear",title:"Wear Rate Model",
   body:"BASE RATE: 0.82 mm/100MGT vertical crown wear. R260 grade, tangent, ballasted track, 80 km/h. Source: Infrabel/TU Delft 2023 (5338 km statistical analysis).\n\nFORMULA:\nwearRate_V = 0.82 x f_V(band) x hardnessEffect x f_railType x f_trackForm x f_speed\nwearRate_L = 1.00 x 1.5 x f_L(band) x hardnessEffect x f_railType x f_trackForm x f_speed x f_lubr\nhardnessEffect = 1 - (1 - f_wear_grade) / (1 + f_L x 0.3)\n\nPARAMETER IMPACTS:\n- Rail grade: harder steels reduce wear on tangent and gentle curves; their benefit progressively weakens in tight curves. Softer grades such as R200 now correctly amplify wear relative to R260.\n- Rail type: Groove +20% vertical, +50% lateral vs vignole.\n- Track form: Slab +10-15%, Embedded +15-20% vs ballasted.\n- Speed: <40 km/h = -10% vertical. >120 km/h = +10-35% vertical.",
   links:[
     {label:"Infrabel/TU Delft (2023) - Full paper, Wear 522",url:"https://doi.org/10.1016/j.wear.2022.204764",type:"paper"},
     {label:"Esveld C. (2001) - Modern Railway Track, 2nd ed.",url:"https://www.mrt-productions.nl/",type:"book"},
     {label:"Magel E. (2011) - Rolling Contact Fatigue: A Comprehensive Review, NRCC/FRA",url:"https://railroads.dot.gov/sites/fra.dot.gov/files/fra_net/15009/Magel_RCF_Review_2011.pdf",type:"paper"},
   ],
   details:[
     {heading:"Formula breakdown: wearRate_V",
      text:"wearRate_V = 0.82 x f_V(band) x hardnessEffect x f_railType x f_trackForm x f_speed\n\n0.82 = base vertical wear rate (mm/100MGT) calibrated on R260, tangent, ballasted track, 80 km/h, from Infrabel/TU Delft 2023 measurements.\n\nf_V(band) = radius amplifier for vertical wear (1.0 to 6.0 depending on curve radius).\n\nEach other factor is a multiplier around 1.0 representing deviations from the reference condition."},
     {heading:"Formula breakdown: wearRate_L",
      text:"wearRate_L = 1.00 x 1.5 x f_L(band) x hardnessEffect x f_railType x f_trackForm x f_speed x f_lubr\n\nThe 1.5 base multiplier reflects that lateral (gauge face) wear is structurally 50% more aggressive than vertical wear even at reference conditions, due to the sliding contact nature of flange/gauge interaction.\n\nf_lubr applies to lateral wear only. Lubrication reduces flange/gauge friction, but the running table remains governed by crown contact and speed effects."},
     {heading:"hardnessEffect formula - why it caps in tight curves",
      text:"hardnessEffect = 1 - (1 - f_wear_grade) / (1 + f_L x 0.3)\n\nThis formula progressively reduces the benefit of hard rail grades in tight curves. In large-radius / tangent track (r5, f_L=0.65), a R400HT rail (f_wear=0.38) gives a strong wear reduction vs R260. But in a R<100m curve (f_L=15), the same hard grade still helps, though much less.\n\nThe same logic now works symmetrically for softer steels: R200 is correctly more wearing than R260, but that penalty is also damped in extremely tight curves where sliding dominates everything.\n\nReason: in tight curves, wear is driven by abrasive sliding at very high contact forces - a regime where the material advantage or penalty becomes less dominant than contact geometry."},
     {table:[["Grade","f_wear","Effect tangent","Effect R<100m"],
             ["R200","1.34","+34% wear","+7% wear"],
             ["R260 (ref)","1.00","0%","0%"],
             ["R320Cr","0.70","-23% wear","-6% wear"],
             ["R350HT","0.50","-33% wear","-10% wear"],
             ["R400HT","0.38","-41% wear","-13% wear"]]},
   ]
  },
  {id:"rcf",title:"RCF - Rolling Contact Fatigue",
   body:"DEFINITION: Cyclic plastic deformation at wheel-rail contact causing surface/sub-surface crack initiation. RCF index (0 to 1) = accumulated damage relative to failure threshold.\n\nRCF PARADOX (magic wear rate): Moderate curves (r4, R400-800m) have HIGHER RCF than tight curves (r1). Tight curves wear fast enough to remove the crack layer before propagation. Moderate curves initiate cracks but lack sufficient wear to remove them.\n\nRCF THRESHOLDS:\n- 0.0-0.3: Healthy - preventive grinding sufficient\n- 0.3-0.7: Moderate - corrective grinding required\n- 0.7-1.0: Critical - replacement mandatory (cracks >5-8mm deep)\n\nHEAVY CONTEXT EARLY-GRIND TRIGGERS:\n- r1: 0.45\n- r2: 0.32\n- r3: 0.30\n- r4: 0.32\n- r5: 0.38\nIn heavy rail, grinding is triggered when the MGT interval is reached OR when the segment RCF index reaches its band trigger, provided the rail still has sufficient vertical reserve and remains below replacement threshold.\n\nSPECIAL ZONES AND CORRUGATION:\nOn tram / metro special zones, corrugation risk can add a corrective trigger through corrMGT even when the RCF index remains below the normal corrective threshold. This is a pragmatic proxy for short-pitch surface defects that are not explicitly modelled as a separate roughness state variable.\n\nLUBRICATION EFFECT ON RCF:\nLubrication now also moderates RCF growth through a dedicated band-based factor. The effect is intentionally weaker than on lateral wear: it reduces damaging creepage and flange/gauge friction, but it is not treated as a direct cure for crown-contact fatigue.\n\nFORMULA: RCF_increment/yr = rcfBase x MGT x (1 - min(0.80, wearRate/5.0))\nwith rcfBase = ctx.rcfRate x grade.f_rcf x f_speed x f_lubr_rcf\nAfter grinding: RCF reduced by passes x rcfReduction x (1 + (1-RCF) x 0.5)",
   links:[
     {label:"Infrabel/Int.J.Fatigue (2025) - 212 instrumented curves analysis",url:"https://doi.org/10.1016/j.ijfatigue.2024.108342",type:"paper"},
     {label:"Ringsberg J.W. (2001) - Life prediction of RCF crack initiation, Int.J.Fatigue 23(7)",url:"https://doi.org/10.1016/S0142-1123(01)00011-5",type:"paper"},
     {label:"Squires G. et al. (2006) - Rolling Contact Fatigue, RSSB T174",url:"https://www.rssb.co.uk/research-catalogue/CatalogueItem/T174",type:"paper"},
     {label:"UIC 712R - Rail defect catalogue (RCF classification)",url:"https://uic.org/IMG/pdf/712r.pdf",type:"standard"},
   ],
   details:[
     {heading:"RCF Index thresholds explained",
      text:"The RCF Index (0 to 1) is a normalized cumulative damage ratio calibrated against the failure threshold. It does not directly measure crack length - it measures how far the material has progressed toward its fatigue limit.\n\n0.00 to 0.30 - HEALTHY (Shakedown zone)\nThe rail surface has strain-hardened and reached elastic shakedown. Each wheel passage no longer produces net plastic deformation. Micro-deformations stay below the crack nucleation threshold. No corrective action required.\n\n0.30 to 0.70 - MODERATE (Ratchetting zone)\nEach wheel passage accumulates a small irreversible plastic strain. Crack nucleation begins near the lower bound (~0.30). Surface cracks are typically 0-1 mm deep at initiation (RCF 0.30-0.45), growing to 3-5 mm as index approaches 0.70. Detectable by ultrasound from ~0.45. Corrective grinding must be planned before 0.70.\n\nHeavy rail logic: the simulator can trigger grinding earlier when the band-specific heavy threshold is reached: r1 0.45, r2 0.32, r3 0.30, r4 0.32, r5 0.38. This avoids moderate-curve segments reaching the replacement threshold without an intermediate grinding opportunity.\n\n0.70 to 1.00 - CRITICAL (Propagation zone)\nCracks have propagated beyond 5 mm. Risk of spalling, head checking, or sub-surface fracture. The simulator triggers replacement at RCF_MAX = 0.70 - a conservative margin reflecting real-world maintenance practice (Infrabel, Network Rail)."},
     {heading:"The RCF paradox - why R400-800m is most critical",
      text:"RCF net damage = RCF accumulation - protective wear\n\nIn tight curves (R<200m): lateral wear is so intense it removes the damaged surface layer faster than RCF can accumulate. This is the magic wear rate or beneficial wear (Kapoor 1994). The rail self-renews by abrasion.\n\nIn R400-800m curves: contact forces are sufficient to cause ratchetting plasticity, but NOT sufficient to wear the rail fast enough to remove the damaged layer. Damage accumulates cycle after cycle unchecked. This is why f_L values in BANDS show higher grinding intervals for r4 than r1 in heavy rail - you grind r4 for RCF, not for wear.\n\nIn tangent track (R>800m): lateral forces are near zero. Ratchetting is limited. RCF progresses slowly."},
     {heading:"Ratchetting mechanism",
      text:"Ratchetting is progressive, irreversible plastic deformation under cyclic loading. At each wheel passage, contact pressures of 800-1500 MPa locally exceed the steel yield strength. The surface layer plastically deforms in the rolling/sliding direction by ~0.001 mm per passage. This strain accumulates until the material ductility limit is reached and a micro-crack initiates, typically 20-45 degrees below the surface.\n\nGrinding removes this ratchetted layer (0.1-0.3mm) before cracks can propagate. This is the physical justification for preventive grinding: intervene before the damage becomes structural."},
   ]
  },
  {id:"grinding",title:"Grinding Strategy",
   body:"PREVENTIVE strategy:\n- Interval: base table per band/context (tram: r1 disabled, r2 12, r3 18, r4 28, r5 40 MGT | metro: r1 disabled, r2 18, r3 24, r4 36, r5 55 | heavy: r1 999, r2 20, r3 30, r4 50, r5 80)\n- Special zones with corrugation risk can override the preventive interval through corrMGT\n- Removal per pass: 0.20mm | Post-grind wear factor: 0.75 | RCF reduction: ~30%\n\nCORRECTIVE strategy:\n- Tram / metro: condition-based, not simple 3x interval. Triggered by vertical wear and/or RCF threshold; special zones can also trigger on corrugation MGT when corrugation risk is active\n- Heavy rail: triggered when the MGT cycle is reached OR when band RCF reaches the heavy threshold\n- Removal: 0.55mm/pass, up to 4 passes | Post-grind factor: 0.92\n- Corrugation-only corrective trigger on special zones is capped to 1 pass\n\nHEAVY RCF-BASED EARLY TRIGGER:\n- In heavy rail, grinding is triggered when the MGT cycle is reached OR when RCF reaches the band trigger\n- r1: 0.45 | r2: 0.32 | r3: 0.30 | r4: 0.32 | r5: 0.38\n- The early trigger remains bounded by reserve feasibility and does not override replacement once RCF reaches 0.70\n\nREPROFILING interaction:\n- Reprofiling restores crown AND gauge face -- next scheduled grinding pass is skipped (skip-next-grinding toggle, active by default)\n- Post-reprofiling wear factor: 0.70 (better than grinding alone -- wider contact ellipse restored)\n- reprRemV = reprRemL x 0.30 (Speno TB-2019-04 calibration)\n- R<100m: reprRemL=3.0mm -> reprRemV=0.9mm | R100-200m: 2.0->0.6mm | R200-400m: 1.0->0.3mm | R400-800m: 0.5->0.15mm | R>=800m: disabled in all modes",
   links:[
     {label:"Grassie S.L. (2005) - Rail corrugation: measurement, understanding and treatment, Wear 258",url:"https://doi.org/10.1016/j.wear.2004.03.066",type:"paper"},
     {label:"Infrabel - Grinding Management Report (2022)",url:"https://www.infrabel.be/en/rail-safety",type:"report"},
     {label:"EN 13231-3:2012 - Rail grinding acceptance criteria",url:"https://standards.cen.eu/dyn/www/f?p=204:110:0::::FSP_PROJECT:28028",type:"standard"},
     {label:"BNSF Railway - Preventive-gradual grinding programme overview",url:"https://www.bnsf.com/",type:"report"},
   ],
   details:[
     {heading:"Preventive strategy - parameter detail",
      text:"Interval (MGT-based): The grinding interval is expressed in MGT, not calendar time, because traffic tonnage drives damage accumulation. A segment carrying 10 MGT/yr on r4 metro is ground every ~3.6 years (36 MGT base). The same segment at 5 MGT/yr is ground every ~7.2 years. On r1, preventive grinding is intentionally disabled for tram, metro and heavy because a pure vertical pass has little value in very tight curves where lateral wear and reprofiling dominate.\n\nHeavy rail addition: the simulator can trigger grinding before the nominal MGT interval if the segment RCF reaches its band threshold (r1 0.45, r2 0.32, r3 0.30, r4 0.32, r5 0.38).\n\nRemoval 0.20 mm/pass: This removes exactly the ratchetted surface layer where micro-cracks initiate. It is the minimum depth to reach sound material without unnecessarily consuming grinding reserve.\n\nPost-grinding wear factor 0.75: After reprofilage, the restored wheel-rail conformity distributes contact pressure over a wider ellipse, reducing local stress and future wear rate by ~25% for the next several MGT. Calibrated from Guangzhou Metro 2021 post-grinding monitoring.\n\nRCF reduction ~30%/pass: Each preventive pass physically removes the damaged layer, resetting the damage index downward. With a healthy bonus (RCF < 0.3), the reduction slightly exceeds 30% because cracks are still superficial and entirely within the removed layer."},
     {heading:"Corrective strategy - parameter detail",
      text:"Tram / metro corrective logic is now condition-based. Standard segments trigger when vertical wear reaches the context threshold (tram 35% of V limit, metro 30%) or when RCF reaches 0.35 / 0.30 respectively. Special zones use a stricter vertical threshold (tram 45%, metro 40%) to avoid over-triggering from local fVExtra alone.\n\nSpecial zones with corrugation risk add a third corrective trigger: mgtSinceLastGrinding >= corrMGT. This keeps corrugation-sensitive areas active even when neither RCF nor vertical wear fully represents the surface defect. If corrugation is the only trigger, the intervention is limited to 1 pass.\n\nRemoval 0.55 mm/pass, up to 4 passes: deeper fissures require deeper material removal to reach sound sub-surface metal. The number of passes still scales with pre-grind RCF severity.\n\nPost-grinding factor 0.92 (only -8%): After deep corrective grinding, the sub-surface microstructure has been heavily strain-hardened by prolonged ratchetting cycles. This hardened layer provides less geometric benefit than a preventive reprofile, and it will re-crack faster in the next damage cycle."},
     {heading:"Grinding reserve consumption comparison",
      text:"The grinding reserve is the total metal available for removal before the rail cross-section falls below the minimum acceptable profile. This is the ultimate constraint on rail life."},
     {table:[["","Preventive","Corrective"],
             ["Metal per intervention","0.20 mm","2.2 mm (4 passes)"],
             ["Post-grind wear factor","x0.75 (-25%)","x0.92 (-8%)"],
             ["Typical rail life","400-600 MGT","200-350 MGT"],
             ["Max interventions R350HT (17mm)","85","7"],
             ["Max interventions R260 (15mm)","75","6"]]},
   ]
  },
  {id:"lubrication",title:"Flange Lubrication",
   body:"FUNCTION: Reduces flange/gauge face friction. Primary effect: LATERAL wear reduction. Secondary effect: moderate reduction in RCF growth on curves through reduced damaging creepage.\n\nLATERAL WEAR FACTORS BY BAND (r1 R<100m to r5 tangent):\n- No lubrication:         1.00 / 1.00 / 1.00 / 1.00 / 1.00\n- Poor/badly maintained:  0.80 / 0.83 / 0.90 / 0.97 / 1.00\n- Standard wayside:       0.45 / 0.52 / 0.68 / 0.92 / 1.00\n- Good (wayside+onboard): 0.28 / 0.35 / 0.55 / 0.88 / 1.00\n- Optimal (lab only):     0.20 / 0.25 / 0.45 / 0.82 / 1.00\n\nRCF FACTORS BY BAND:\n- No lubrication:         1.00 / 1.00 / 1.00 / 1.00 / 1.00\n- Poor/badly maintained:  0.97 / 0.97 / 0.98 / 0.99 / 1.00\n- Standard wayside:       0.90 / 0.88 / 0.90 / 0.96 / 1.00\n- Good (wayside+onboard): 0.85 / 0.82 / 0.86 / 0.94 / 1.00\n- Optimal (lab only):     0.80 / 0.78 / 0.83 / 0.92 / 1.00\n\nIMPACT: Standard wayside strongly reduces lateral wear in tight curves and provides a smaller, secondary moderation of RCF growth. Tangent track remains effectively unaffected.\n\nWARNING: Optimal is unrealistic in service. Good is the practical maximum due to contamination, rain, and maintenance gaps.",
   links:[
     {label:"Arias-Cuevas et al. (2010) - Friction modifiers in dry/wet conditions, Wear 268",url:"https://doi.org/10.1016/j.wear.2009.09.006",type:"paper"},
     {label:"Shanghai Metro Line 2 lateral wear study (2021), J.Rail and Rapid Transit",url:"https://doi.org/10.1177/0954409720915584",type:"paper"},
     {label:"Banverket (2018) - Field trials on lateral wear with friction modifiers (Sweden)",url:"https://www.trafikverket.se/",type:"report"},
   ],
   details:[
     {heading:"How lubrication works physically",
      text:"Flange lubrication introduces a friction modifier between the wheel flange and the rail gauge face. This reduces friction CoF from ~0.50 dry down to 0.10-0.25.\n\nIts primary effect is on LATERAL wear. The crown/table contact stays mostly dry because:\n- Lubricant is applied at gauge face level, not on the running table\n- The running surface must maintain CoF > 0.30 for braking and traction\n- Migrating lubricant is quickly removed by wheel rolling action\n\nThe simulator therefore applies a strong factor to wearRate_L and only a smaller secondary factor to RCF growth."},
     {heading:"Lubrication factors and their physical basis",
      text:"f_lubr is a cycle-averaged multiplier on lateral wear rate. Immediately after application, reduction can be very strong, but degrades between applications as lubricant is consumed. The simulator uses band-based averaged values for lateral wear plus a more conservative band-based factor for RCF moderation."},
     {table:[["Mode","r1 wearL","r2 wearL","r3 wearL","r1 RCF","r2 RCF","Typical system"],
             ["None","1.00","1.00","1.00","1.00","1.00","No lubrication"],
             ["Poor","0.80","0.83","0.90","0.97","0.97","Badly maintained greasers"],
             ["Standard","0.45","0.52","0.68","0.90","0.88","Wayside lubrication"],
             ["Good","0.28","0.35","0.55","0.85","0.82","Wayside + onboard"],
             ["Optimal","0.20","0.25","0.45","0.80","0.78","Lab / idealized"]]},
     {heading:"When lubrication is and is not beneficial",
      text:"Lubrication is highly effective in curves below R400m where lateral wear dominates. In tight curves (R<200m), reducing lateral wear by 50-75% can extend rail life by 30-60% and reduce grinding frequency.\n\nIn tangent track and large-radius curves (R>800m), lateral wear is minimal and lubrication provides little benefit. Excessive lubrication in tangent zones can reduce braking CoF below safety thresholds.\n\nPractical rule: apply lubrication selectively in curves R<400m."},
   ]
  },
  {id:"brownfield",title:"Brownfield Mode",
   body:"PURPOSE: Start simulation from existing worn rail. Essential for inherited projects, condition assessments, and remaining life evaluations.\n\nINPUT PARAMETERS (per segment):\n- Vertical wear (mm): depth from original profile height. Impact: simulation starts here; replacement sooner.\n- Lateral wear (mm): gauge face wear at 14mm below running surface (EN 13674-1 convention).\n- RCF index (0 to 1): from UT inspection or surface assessment. Above 0.3 triggers corrective grinding in year 1.\n- Accumulated MGT: total since installation. Used for lifecycle cost amortisation.\n\nHEALTH INDICATOR: health = max(wearV/limitV, wearL/limitL, RCF). Good <40%, Moderate 40-70%, Poor >70%.\n\nMETAL RESERVE: initial_reserve = nominal_reserve - (wearV x 0.8). The 0.8 factor accounts for grinding-consumed reserve not visible in wear measurement.\n\nTYPICAL USE: Input last inspection report values. Simulator shows: years remaining, urgent grinding need, updated budget.",
   links:[
     {label:"EN 13231-1:2016 - Acceptance of railway track geometry after maintenance",url:"https://standards.cen.eu/dyn/www/f?p=204:110:0::::FSP_PROJECT:38793",type:"standard"},
     {label:"EN 13674-1:2011 - Rail wear measurement convention (clause 5.4)",url:"https://www.en-standard.eu/bs-en-13674-1-2011-railway-applications-track-rail/",type:"standard"},
     {label:"Network Rail NR/SP/TRK/001 - Track inspection handbook (2021)",url:"https://www.networkrail.co.uk/industry-and-commercial/",type:"standard"},
   ],
   details:[
     {heading:"What brownfield mode changes in the simulation",
      text:"Greenfield (default): simulation starts from a new rail with zero wear, zero RCF, zero MGT. Every segment begins in perfect condition.\n\nBrownfield: you provide the current condition of each segment - existing vertical wear, lateral wear, RCF index, and accumulated MGT. The simulation continues from that point, calculating remaining life to the first replacement threshold.\n\nA segment already at 6mm vertical wear (9mm metro limit) will reach replacement in 1-3 years instead of 15-20 years for a new rail. This is critical for realistic lifecycle planning on inherited infrastructure."},
     {heading:"How to estimate initial RCF index from visual inspection",
      text:"RCF index is the hardest parameter to measure directly. Use these visual inspection guidelines:\n\n0.00 to 0.20: No visible surface damage - smooth, shiny rail surface\n0.20 to 0.45: Light surface cracks visible under raking light - early head checks\n0.45 to 0.65: Moderate head checks or squats clearly visible - corrective action needed\n0.65 to 0.85: Severe cracking, spalling beginning - urgent intervention required\n\nFor precise values, ultrasonic testing (UT) or eddy current inspection provide quantitative crack depth measurements that can be converted to an approximate RCF index."},
     {heading:"The health score calculation",
      text:"health = max(wearV / limitV, wearL / limitL, rcf)\n\nThis single 0-to-1 indicator shows how close the segment is to any replacement threshold. The color coding is:\n\nGreen (health < 0.40): GOOD - substantial remaining life\nAmber (0.40 to 0.70): MODERATE - degradation visible, plan intervention in 3-8 years\nRed (> 0.70): POOR - approaching replacement, priority intervention\n\nThe health score uses whichever criterion (vertical wear, lateral wear, or RCF) is closest to its limit - reflecting the real maintenance logic where any single threshold triggers replacement."},
   ]
  },
  {id:"replacement",title:"Replacement Criteria",
   body:"REPLACEMENT triggered when ANY ONE condition is met:\n\n1. VERTICAL WEAR >= limit:\n   Tram: 7mm | Metro: 9mm | Heavy rail: 12mm\n\n2. LATERAL WEAR >= limit:\n   Tram: 8mm | Metro: 11mm | Heavy rail: 14mm\n\n3. VERTICAL RESERVE <= min threshold:\n   Initial: R200=13mm, R260=15mm, R320Cr=16mm, R350HT=17mm, R400HT=18mm\n   Min: 3.0-4.0mm by grade (configurable via Reserve Thresholds toggle)\n   Consumed by: grinding (0.20-2.2mm/intervention) + reprofiling (reprRemL x 0.30)\n   Feasibility check: reprofiling not triggered if post-operation reserve < min threshold\n\n4. LATERAL RESERVE <= min threshold:\n   Initial: R200=7mm, R260=8mm, R320Cr=9mm, R350HT=9mm, R400HT=10mm\n   Min: 3.0-3.5mm by grade (configurable via Reserve Thresholds toggle)\n   Consumed by: reprofiling only (reprRemL per intervention, radius-based)\n   Feasibility check: reprofiling not triggered if post-operation resL < min threshold\n\n5. RCF INDEX >= 0.70:\n   Cracks 5-8mm deep. Grinding cannot reach without exhausting metal reserve.",
   links:[
     {label:"EN 13674-1:2011 Table 2 - Wear limits for vignole rail",url:"https://www.en-standard.eu/bs-en-13674-1-2011-railway-applications-track-rail/",type:"standard"},
     {label:"UIC 714R - Rail defect action levels (2004)",url:"https://uic.org/IMG/pdf/714r.pdf",type:"standard"},
     {label:"Network Rail NR/L2/TRK/001 - Track inspection and maintenance (2022)",url:"https://www.networkrail.co.uk/industry-and-commercial/",type:"standard"},
     {label:"Infrabel TR 00059 - Rail inspection and renewal criteria (2021)",url:"https://www.infrabel.be/en/about-infrabel/technical-references",type:"standard"},
   ],
   details:[
     {heading:"The three replacement triggers in detail",
      text:"The simulator checks all three conditions at every step and triggers replacement the moment ANY ONE is exceeded.\n\n1. VERTICAL WEAR >= limit\nRail head height reduced beyond safe limit. The wheel drops too far into the rail, increasing flanging load dangerously. Set by EN 13674-1 Table 2.\n\n2. LATERAL WEAR >= limit\nGauge face worn beyond safe limit. Creates derailment risk in curves where rail is already tilted under lateral load. Lateral limit is typically higher than vertical because the rail tolerates more gauge face loss before safety is compromised.\n\n3. RCF Index >= 0.70\nExtensive sub-surface cracking makes the rail structurally unsafe even if dimensional wear limits are not yet reached. A rail replaced for RCF often still has significant wear reserve - the failure mode is fatigue, not abrasion."},
     {table:[["Context","Vertical limit","Lateral limit","Typical section"],
             ["Tram","7 mm","8 mm","41-54 kg/m"],
             ["Metro / LRT","9 mm","11 mm","54-60 kg/m"],
             ["Heavy Rail","12 mm","14 mm","54-60 kg/m"]]},
     {heading:"Grinding reserve vs wear reserve",
      text:"The wear limit is the absolute dimensional maximum. But the grinding reserve (metal available for removal by grinding) may be exhausted before the wear limit is reached.\n\nR350HT example (17mm grinding reserve, corrective strategy at 2.2mm per intervention):\n17mm / 2.2mm = 7.7 -> only 7 interventions before reserve is exhausted, even if wear limit is not yet reached.\n\nWith preventive strategy (0.20mm per intervention):\n17mm / 0.20mm = 85 interventions - the rail reaches its wear limit from traffic, not from grinding overconsumption.\n\nThis is one of the strongest economic arguments for preventive over corrective grinding."},
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
  {id:"reprofiling",title:"Reprofiling Strategy",
   body:"DEFINITION: Reprofiling restores the full transversal rail profile -- crown (vertical) AND gauge face (lateral). Unlike grinding which targets the crown only, reprofiling removes metal in both V and L directions.\n\nTRIGGER: Geometry-driven, not MGT-scheduled. Initiated when lateral wear reaches the configured threshold (default 60% of lateral limit).\n\nFEASIBILITY CHECK: Reprofiling is only triggered if both vertical and lateral reserves will remain above minimum thresholds after the operation. If either reserve would be exhausted, reprofiling is skipped and replacement follows naturally.\n\nMETAL REMOVAL: reprRemL by radius band (r1=3.0mm, r2=2.0mm, r3=1.0mm, r4=0.5mm, r5=0mm) + reprRemV = reprRemL x 0.30 (Speno TB-2019-04).\n\nRADIUS RULE: Reprofiling is disabled for all segments and special zones with representative radius >= 800 m, even if the global (non radius-based) mode is selected.\n\nGRINDING INTERACTION: Crown restored by reprofiling -- next scheduled grinding pass is skipped (skip-next-grinding toggle, active by default). Post-reprofiling wear factor: 0.70.\n\nPRIORITY RULE: If replacement is triggered in the same year as reprofiling, the reprofiling is discarded -- replacement takes priority. The schedule chart will never show both events in the same year.",
   links:[
     {label:"Magel E. et al. (2017) - Wheel-Rail Tribology, Elsevier",url:"https://www.elsevier.com/books/wheel-rail-interface-handbook/lewis/978-1-84569-412-8",type:"book"},
     {label:"Speno International TB-2019-04 - Reprofiling metal removal data",url:"https://www.speno.ch/en/services/rail-grinding/",type:"report"},
     {label:"Network Rail NR/L2/TRK/001 - Track inspection and maintenance (2022)",url:"https://www.networkrail.co.uk/industry-and-commercial/supply-chain/rail-industry-and-technical-standards/",type:"standard"},
     {label:"IHHA Wheel-Rail Interface Guidelines, 5th ed. (2019) - Reprofiling criteria",url:"https://www.ihha.net/",type:"standard"},
     {label:"Esveld C. (2001) - Modern Railway Track, 2nd ed., MRT Productions",url:"https://www.mrt-productions.nl/",type:"book"},
   ],
   details:[
     {heading:"Why reprofiling differs from grinding",
      text:"Preventive grinding acts only on the running surface (crown): 0.1-0.3mm vertical, gauge face untouched.\n\nReprofiling acts on the full transversal section:\n- Crown (vertical): 0.5-1.0mm -- restores running table geometry\n- Gauge face (lateral): 2-4mm -- restores flange contact slope and gauge width\n\nOn tight curves (R<200m), lateral wear reaches its limit before vertical -- reprofiling is the binding constraint."},
     {table:[["Operation","Axis","Removal per pass","RCF effect","Trigger"],
             ["Preventive grinding","Vertical only","0.1-0.3 mm","Reset 25-30%","MGT interval"],
             ["Corrective grinding","Vertical only","0.3-0.55 mm x N","Reset 18% x N","RCF threshold"],
             ["Reprofiling","V and L","0.5-1mm V + 2-4mm L","Reset 40-60%","Geometry threshold"]]},
     {heading:"Trigger threshold and frequency",
      text:"Simulator trigger: % of lateral wear limit.\n\nIHHA (2019): reprofile at 50-70% of limit.\nNetwork Rail NR/L2/TRK/001: reprofile when profile deviation exceeds 2mm.\nInfrabel TR 00059: reprofile when less than 25% lateral reserve remains.\n\nFrequency in practice:\n- R<100m: every 3-5 years\n- R100-300m: every 6-10 years\n- R>300m: rarely or never\n\nDefault threshold in simulator: 60% of lateral limit (IHHA 2019)."},
     {heading:"Impact on grinding reserve and lifecycle",
      text:"Each reprofiling consumes both vertical and lateral grinding reserves.\n\nReserves per grade:\n- Vertical: R200=13mm, R260=15mm, R320Cr=16mm, R350HT=17mm, R400HT=18mm\n- Lateral: R200=7mm, R260=8mm, R320Cr=9mm, R350HT=9mm, R400HT=10mm\n- Minimum thresholds: 3.0-4.0mm V and L (EN 13674-1, Magel 2017, Network Rail NR/L2)\n\nOn tight-curve segments with frequent reprofiling, the lateral reserve may be exhausted in 2-3 interventions at 3mm each. The skip-next-grinding feature avoids double-consuming the vertical reserve when reprofiling and grinding coincide."},
   ]
  },
  {id:"stones",title:"Grinding Stone Consumption",
   body:"FUNCTION: Grinding stones (abrasive wheels) are consumables mounted on each grinding head. They wear during operation.\n\nCONSUMPTION FACTORS:\n1. Radius (most critical): Tight curves require 5-8x more stones than tangent. Higher contact angles increase stone face wear.\n   Base rates (stones/km/rail/pass): r1=2.0-5.0 / r2=1.25-3.25 / r3=0.75-1.75 / r4=0.50-1.10 / r5=0.40-1.00\n   (range: small machine to Speno specialist)\n2. Rail grade hardness: Harder rail wears stones faster. Factors: R260=1.0x, R320Cr=1.15x, R350HT=1.30x, R400HT=1.45x.\n3. Machine type: Stone weight - small=0.9 kg, line=1.4 kg, Speno=2.2 kg.\n\nCOST: Typical unit price 5-20 EUR/stone. Stone cost = 30-50% of own-fleet grinding cost.\n\nCUSTOM RATE: Enter your measured rate for the R200-400m band. All other bands scale proportionally from the preset ratio.",
   links:[
     {label:"Speno International TB-2019-04 - Stone consumption factors by curve radius",url:"https://www.speno.ch/en/services/rail-grinding/",type:"report"},
     {label:"Loram Technologies - Abrasive consumption field data (2021)",url:"https://www.loram.com/capabilities/rail-grinding/",type:"report"},
     {label:"Rame I. et al. (2018) - Abrasive wear of grinding wheels in rail grinding, Wear 406-407",url:"https://doi.org/10.1016/j.wear.2018.01.012",type:"paper"},
     {label:"Vossloh Rail Services - Grinding wheel application guide (2020)",url:"https://www.vossloh.com/en/products-and-solutions/rail-services/",type:"report"},
   ],
   details:[
     {heading:"What grinding stones are and why they wear",
      text:"Grinding stones (abrasive segments) are consumable blocks of bonded abrasive mounted on each grinding head. Typical weight: 0.9 kg (small machine) to 2.2 kg (Speno/Loram). As the stone rotates against the rail at high speed, both rail and stone lose material simultaneously.\n\nStone wear depends on three factors:\n\n1. Curve radius: tight curves force intense lateral contact. A stone in R<100m wears 5-8x faster than in tangent track.\n\n2. Rail grade hardness: harder rail (R400HT) is more abrasive to the stone. R400HT consumes ~45% more stones than R260 for the same length ground.\n\n3. Machine size: larger machines spread work across more heads per pass, but each stone still wears at the same rate per unit of rail."},
     {heading:"Rate formula explained",
      text:"Rate (stones/km/pass) = baseRate[machine][band] x gradeFactor[grade] x 2 rails\n\nThe x2 multiplier accounts for both rails being ground simultaneously. The rate in the table column is already x2 (both rails). The Preset rates line below the table shows per rail only - both are correct for their respective context.\n\nGradeFactor by grade: R200=0.90 / R260=1.00 (ref) / R320Cr=1.15 / R350HT=1.30 / R400HT=1.45"},
     {table:[["Machine","R<100m","R100-200","R200-400","R400-800","Tangent","Stone weight"],
             ["Small (tram/metro)","4.0","2.5","1.5","1.0","0.8","0.9 kg"],
             ["Line machine","6.5","3.8","2.2","1.4","1.2","1.4 kg"],
             ["Speno/Loram","10.0","6.0","3.5","2.2","2.0","2.2 kg"]]},
     {heading:"First cycle vs full horizon - procurement planning",
      text:"First cycle: stone quantity to the first rail replacement. Use this for single maintenance contracts.\n\nFull horizon: total over all replacement cycles for the contract duration. Use this for:\n- Long-term framework contracts with fixed stone supply\n- Budget planning over 10-30 year concession agreements\n- Warehouse sizing for remote locations where emergency resupply is difficult\n\nThe Implied EUR/ml indicator in Unit Rates helps cross-check your stone unit price against the grinding cost rate, alerting you when the two are inconsistent (badge turns red with over/underestimate warning)."},
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
   body:"VERSION 1.2 - Annual time step.\n\nNOW MODELLED (v1.2 additions):\n- Reprofiling model: geometry-triggered, radius-based reprRemL, feasibility check, priority rule (replacement overrides same-year reprofiling)\n- reprRemV = reprRemL x 0.30 (calibrated on Speno TB-2019-04)\n- Radius-based reprRemL defaults: r1=3.0mm, r2=2.0mm, r3=1.0mm, r4=0.5mm, r5=0mm (configurable per band)\n- R>=800m reprofiling locked out for both standard segments and special zones\n- Tram / metro corrective grinding: condition-based logic on vertical wear and RCF instead of simple 3x preventive spacing\n- Special-zone corrective logic: optional corrugation trigger using corrMGT, plus debug traces for trigger cause and pre/post values in chart tooltips\n- Reserve thresholds configurable via toggle (min V and L, default 3.0-4.0mm by grade)\n- Reprofiling Cost tab with mobilisation\n- Metal reserve chart: dual V and L curves with dynamic reference lines\n- Schedule chart: Grinding / Reprofiling / Replacement bars\n- Strategy Comparison: reprofiling costs in KPIs and tables\n- Summary table: Reprofiling cost column\n\nNOT MODELLED:\n- Inner/outer rail asymmetry: outer rail always critical. Inner ~30-60% of outer rate.\n- Wheel profile evolution over time.\n- Seasonal variation: autumn leaf fall +15-25% wear; winter ice alters friction mode.\n- Switch and crossing wear: different mechanisms, out of scope.\n- Corrugation remains represented through special-zone triggers, not through an explicit surface roughness state variable.\n- Rail inclination / canting effects on contact geometry.\n- Temperature effects on rail steel properties.\n- Annual time step can still smooth short-term trigger sequencing within a given year.\n\nSCOPE: Calibrated on European heavy rail (Belgium) and Chinese metro. Validate locally for other contexts.\n\nCOST DATA: Rates based on 2022-2023. Live exchange rates via exchangerate-api.com.",
   links:[
     {label:"RSSB T1009 - Rail wear database (UK network)",url:"https://www.rssb.co.uk/research-catalogue/CatalogueItem/T1009",type:"report"},
     {label:"FRA Track Safety Standards (US DOT)",url:"https://railroads.dot.gov/safety/track-safety/track-safety-standards",type:"standard"},
     {label:"DB Netz Richtlinie 824 - Schienenverschleiss (Germany)",url:"https://www.dbinfrago.com/db-infrago/en/technical-standards",type:"standard"},
     {label:"Esveld C. (2001) - Modern Railway Track, 2nd ed. (MRT Productions)",url:"https://www.mrt-productions.nl/",type:"book"},
   ]
  },
  {id:"tamping",title:"Ballast Tamping Strategy",
  body:"PURPOSE: The Ballast Tamping module estimates preventive tamping schedules, ballast top-up requirements, degarnissage cycles, and associated costs for ballasted track. It is only active when Track Form = Ballast.\n\nSCOPE: Covers 5 radius bands (r1 to r5) and any Special Zones (stations, sharp curves). Each simulated segment uses its assigned representative speed, which influences tamping frequency through the speed factor. Special zones follow their simulated geometry and traffic settings.\n\nFREQUENCY MODEL: Interval (MGT) = TAMP_BASE_MGT[context][band] x f_platform x f_speed\n\nPLATFORM QUALITY FACTOR (f_platform):\n  P1 - Excellent (stable granular) : 1.20 -- less degradation, longer interval\n  P2 - Good (consolidated cohesive) : 1.00 -- reference\n  P3 - Fair (clay, soft soil) : 0.70 -- faster settlement, shorter interval\n  P4 - Poor (heterogeneous fill) : 0.45 -- very frequent tamping required\n\nSPEED FACTOR (f_speed):\n  f_speed = sqrt(V_ref / V_segment)   with V_ref = 80 km/h\n  Higher speed = tighter geometric tolerances = more frequent tamping\n  Example: 160 km/h segment -> f_speed = sqrt(80/160) = 0.71 -> 29% shorter interval\n\nBALLAST TOP-UP: Each tamping intervention displaces and attrits ballast. Default top-up by band (kg/m/intervention):\n  r1 R<100m: 50 kg/m | r2 100-200m: 40 | r3 200-400m: 30 | r4 400-800m: 20 | r5 R>=800m: 15\n  Values are configurable. Tighter curves lose more ballast laterally.\n\nDEGARNISSAGE: After N tamping cycles, ballast contamination, fouling, and drainage loss become material. In practice, many networks trigger ballast cleaning or renewal after about 5-7 tamping cycles depending on fouling rate, drainage condition, and local maintenance standards.\n  Default N = 6 cycles (ORE B17: 5-7 typical)\n  Degarnissage top-up = 8x standard appoint rate (UIC 714R / NR/L2/TRK/004)\n\nCOST MODEL: Total = Operation + Mobilisation + Ballast top-up + Degarnissage\n  Operation: EUR/ml x length x n_interventions (sub) or (fuelLph x gasoilEurL + maintEurH + labourTeamEurH) / prodMlH (own)\n  Mobilisation: fixed cost per intervention (own fleet = 0)\n  Ballast: appT x ballastEurT (delivered price)\n  Degarnissage: degarnOpMl x length x nDegarn + degarnBallastT x ballastEurT\n\nSTANDARDS: UIC 712R, UIC 714R, EN 13848-5, ORE B17, Network Rail NR/L2/TRK/004.",
   links:[
     {label:"UIC 712R - Recommendations for the evaluation of the state of ballasted track (2002)",url:"https://uic.org/spip.php?article491",type:"standard"},
     {label:"UIC 714R - Classification of lines for the purpose of track maintenance (2004)",url:"https://uic.org/spip.php?article491",type:"standard"},
     {label:"EN 13848-5 - Railway applications. Track geometry quality. Geometry quality levels (2008)",url:"https://www.en-standard.eu/bs-en-13848-5-2008-railway-applications-track-geometry-quality/",type:"standard"},
     {label:"Lichtberger B. (2005) - Track Compendium, Eurailpress",url:"https://eurailpress.de/",type:"book"},
     {label:"Esveld C. (2001) - Modern Railway Track, 2nd ed. Ch.8 Ballast degradation model",url:"https://www.mrt-productions.nl/",type:"book"},
     {label:"ORE B17 - Recommendations for the design of ballasted track (1983)",url:"https://uic.org/",type:"report"},
     {label:"Network Rail NR/L2/TRK/004 - Ballast specification and management (2019)",url:"https://www.networkrail.co.uk/industry-and-commercial/infrastructure-projects/",type:"standard"},
     {label:"Infrabel REX ballast management study (2023) - Internal technical report",url:"https://www.infrabel.be/",type:"report"},
   ],
   details:[
     {heading:"Tamping interval formula and calibration",
      text:"Interval (MGT) = BASE x f_platform x f_speed\n\nBASE values (Gross MGT, not Equiv. MGT):\n\nContext    r1     r2     r3     r4     r5\nTram       8     12     18     25     35\nMetro     14     20     27     38     48\nHeavy     15     22     30     40     65\n\nWhy Gross MGT for tamping (not Equiv. MGT):\nBallast settlement follows a near-linear damage law (exponent 1-1.5 per Lichtberger 2005), unlike rail fatigue which uses exponent 3-4 (Wohler). At equal Gross MGT, a light metro axle (14t) degrades ballast only ~2x less than a heavy freight axle (25t). The Equiv.MGT formula would artificially reduce the metro contribution by 10-15x, which is physically wrong for tamping.\n\nCalibration sources: RATP REX 2019, STIB Brussels 2021, Guangzhou Metro 2022, Singapore LTA 2020 (metro). Infrabel REX 2023, Network Rail NR/L2/TRK/001 (heavy)."},
     {heading:"Platform quality and its effect on tamping frequency",
      text:"The subgrade platform is the dominant factor in ballast settlement rate (Esveld 2001, sec.8.3).\n\nP1 - Stable granular (gravel, coarse sand, good drainage)\n  f=1.20 -- 20% longer interval than reference\n  Typical: modern lines on engineered embankment, hard rock tunnels\n\nP2 - Good consolidated cohesive (stiff clay, marl)\n  f=1.00 -- reference (Infrabel type 2 soil classification)\n  Typical: most Western European main lines\n\nP3 - Fair cohesive (soft clay, silt, moderate drainage)\n  f=0.70 -- 30% shorter interval\n  Typical: older lines on natural embankment, alluvial plains\n\nP4 - Poor heterogeneous fill (mixed soil, poor drainage, high water table)\n  f=0.45 -- intervals almost halved\n  Typical: soft ground areas, some urban metro alignments, tropical soils\n\nNote: platform quality is a network-wide parameter in the simulator. For mixed-quality networks, use P2 as default and adjust per project."},
     {heading:"Ballast degradation and degarnissage cycle",
      text:"Ballast degrades cumulatively through three mechanisms:\n1. ATTRITION: each tamping cycle breaks and rounds grain edges (-0.3 to 0.8% volume per cycle)\n2. LATERAL MIGRATION: ballast shifts out of shoulder profile during tamping (1-3 kg/m/cycle)\n3. CONTAMINATION: fines from subgrade, brake dust, and crushed grains accumulate\n\nDegarnissage threshold: once fouling becomes excessive, drainage and geometry retention deteriorate materially. In practice, many networks schedule ballast cleaning or renewal after about 5-7 tamping cycles depending on contamination rate, moisture condition, and local standards.\n\nDefault top-up rates (kg/m/intervention):\n  Tight curves (r1, R<100m): 50 kg/m -- high lateral forces\n  Standard curves (r3, 200-400m): 30 kg/m -- moderate loss\n  Straight track (r5, R>800m): 15 kg/m -- minimal lateral loss\n\nDegarnissage requires 8x the top-up appoint rate to fully replace degraded ballast (NR/L2/TRK/004). For r3: 30 x 8 = 240 kg/m of fresh ballast."},
     {heading:"Own fleet cost model -- formula and parameters",
      text:"opPerMl = (fuelLph x gasoilEurL + maintEurH + labourTeamEurH) / prodMlH\n\nParameters:\n  fuelLph: diesel consumption of tamping machine (L/h)\n    Light (08-16): 22 L/h\n    Standard (09-3X): 35 L/h\n    Heavy (09-4X): 55 L/h\n\n  gasoilEurL: local diesel price (EUR/L)\n    WEU: 1.20 | EEU: 1.00 | MENA: 0.80 | SSA: 0.95 | SEA: 0.90 | LATAM: 1.05\n\n  maintEurH: maintenance + amortisation per hour (EUR/h)\n    Light: 120 | Standard: 180 | Heavy: 260\n\n  labourTeamEurH: total team cost per hour (EUR/h) = rate/person x team size\n    Standard WEU: 55 EUR/h x 4 persons = 220 EUR/h\n\n  prodMlH: track length processed per hour (m/h, including passes and repositioning)\n    Light: 175 m/h | Standard: 300 m/h | Heavy: 425 m/h\n\nExample -- Standard 09-3X, WEU own fleet:\n  (35 x 1.20 + 180 + 220) / 300 = 442 / 300 = 1.47 EUR/ml\n  vs a typical subcontract WEU preset around 11 EUR/ml, which includes contractor overhead, mobilisation structure, market conditions, and delivery risk in addition to direct operating cost.\n\nManual override: any individual parameter can be overridden via the toggle in the Tamping Cost tab."},
     {table:[["Parameter","Default","Range","Source"],
             ["Interval base metro r1","14 MGT","8-20 MGT","RATP REX 2019"],
             ["Interval base metro r5","48 MGT","35-65 MGT","Singapore LTA 2020"],
             ["Interval base heavy r5","65 MGT","50-80 MGT","Infrabel REX 2023"],
             ["f_platform P3","0.70","0.50-0.85","Esveld 2001 sec.8.3"],
             ["f_speed formula","sqrt(80/V)","--","UIC 712R adapted"],
             ["Degarnissage cycles","6","5-7","ORE B17"],
             ["Degarnissage top-up factor","8x","6-10x","NR/L2/TRK/004"],
             ["Top-up r1 (R<100m)","50 kg/m","30-80 kg/m","Infrabel REX 2023"],
             ["Top-up r5 (R>=800m)","15 kg/m","10-25 kg/m","Network Rail 2019"]]},
   ]
  },
];



// ---- BALLAST TAMPING PANEL ----

function BallastPanel(props) {
  var segs        = props.segs || [];
  var result      = props.result;
  var horizon     = props.horizon || 30;
  var context     = props.context || "metro";
  var globalSpeed = props.globalSpeed || 80;
  var platform    = props.platform || "P2";
  var appoint     = props.appoint || TAMP_APPOINT_DEFAULT;
  var degCycles   = props.degCycles || 6;
  var ballastDens = props.ballastDens || 1.7;
  var aidx        = props.aidx != null ? props.aidx : -1;
  var onSegSelect = props.onSegSelect || function(){};
  var cl2 = cl;
  var ctx = context==="tram"?"tram":context==="heavy"?"heavy":"metro";
  var fp  = TAMP_PLATFORM[platform] || 1.0;
  var BAND_LABELS = {r1:"R<100m",r2:"100-200m",r3:"200-400m",r4:"400-800m",r5:"R>=800m"};

  var rows = segs.filter(function(s){ return (s.active || s.isSpecialZone || s.lengthKm > 0) && s.lengthKm > 0; }).map(function(seg, si) {
    var band      = TAMP_BAND(seg.repr || seg.radius || 300);
    var baseInt   = (TAMP_BASE_MGT[ctx] || TAMP_BASE_MGT.metro)[band] || 25;
    var segSpeed  = seg.speed || globalSpeed;
    var fSpeed    = Math.sqrt(Math.max(20, TAMP_V_REF) / Math.max(20, segSpeed));
    var tampMGT   = baseInt * fp * fSpeed;
    var res       = result && result.results ? result.results[si] : null;
    var mgtPY     = res ? res.mgtPY : 5;
    var yrsPerInt = mgtPY > 0 ? tampMGT / mgtPY : tampMGT / 5;
    var nInterv   = Math.max(0, Math.floor(horizon / yrsPerInt));
    var nDegarn   = Math.floor(nInterv / degCycles);
    var lenMl     = seg.lengthKm * 1000;
    var appKgMl   = appoint[band] || TAMP_APPOINT_DEFAULT[band] || 20;
    var appointT  = appKgMl * lenMl / 1000;
    var degarnT   = appKgMl * TAMP_DEGARN_FACTOR * lenMl / 1000;
    var totalAppT = appointT * nInterv;
    var totalDegT = degarnT  * nDegarn;
    return {
      seg:seg, band:band, tampMGT:tampMGT, yrsPerInt:yrsPerInt,
      nInterv:nInterv, nDegarn:nDegarn, segSpeed:segSpeed,
      appointT:appointT, degarnT:degarnT,
      totalBallastT: totalAppT + totalDegT,
    };
  });

  var totInterv  = rows.reduce(function(a,r){return a+r.nInterv;},0);
  var totDegarn  = rows.reduce(function(a,r){return a+r.nDegarn;},0);
  var totBallast = rows.reduce(function(a,r){return a+r.totalBallastT;},0);

  var chartData = [];
  for(var yr=1; yr<=horizon; yr++) {
    var entry = {year:yr};
    rows.forEach(function(r) {
      var intNum  = r.yrsPerInt > 0 ? Math.floor(yr / r.yrsPerInt) : 0;
      var prevNum = r.yrsPerInt > 0 ? Math.floor((yr-1) / r.yrsPerInt) : 0;
      var fires   = intNum > prevNum && intNum > 0;
      var isDeg   = fires && intNum % degCycles === 0;
      entry["t_"+r.seg.id] = fires && !isDeg ? 1 : 0;
      entry["d_"+r.seg.id] = fires &&  isDeg ? 1 : 0;
    });
    chartData.push(entry);
  }

  function fmt1(v){ return (+v).toFixed(1); }
  function fmtT(v){ return v>=1000?(v/1000).toFixed(1)+"k t":(+v).toFixed(0)+" t"; }

  return (
    <div style={{display:"grid",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
        {[[totInterv,cl2.teal,"Total Interventions","tamping passes over "+horizon+" yrs"],
          [totDegarn,cl2.warn,"Degarnissages","full ballast renewals"],
          [fmtT(totBallast),cl2.amber,"Total Ballast","top-up + renewal combined"]
        ].map(function(k,i){
          return <div key={i} style={{background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"14px 18px",border:"1px solid rgba(255,255,255,0.08)"}}>
            <div style={{fontSize:10,color:cl2.dim,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>{k[2]}</div>
            <div style={{fontSize:26,fontWeight:800,color:k[1]}}>{k[0]}</div>
            <div style={{fontSize:11,color:cl2.dim,marginTop:2}}>{k[3]}</div>
          </div>;
        })}
      </div>

      <Card title="Tamping Parameters">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
          <div>
            <Lbl>Platform Quality</Lbl>
            <Sel value={platform} onChange={props.onPlatformChange} opts={[
              {v:"P1",l:"P1 - Excellent (stable granular)"},
              {v:"P2",l:"P2 - Good (consolidated)"},
              {v:"P3",l:"P3 - Fair (cohesive clay)"},
              {v:"P4",l:"P4 - Poor (heterogeneous fill)"},
            ]}/>
            <div style={{fontSize:10,color:cl2.dim,marginTop:3}}>f_platform = {TAMP_PLATFORM[platform]} | Interval factor</div>
          </div>
          <div>
            <Lbl>Cycles before degarnissage</Lbl>
            <Inp value={degCycles} onChange={function(v){props.onDegCyclesChange(Math.max(2,Math.min(12,+v)));}} min={2} max={12} step={1}/>
            <div style={{fontSize:10,color:cl2.dim,marginTop:3}}>ORE B17: 5-7 typical</div>
          </div>
          <div>
            <Lbl>Ballast density (t/m3)</Lbl>
            <Inp value={ballastDens} onChange={props.onBallastDensChange} min={1.4} max={2.0} step={0.05}/>
            <div style={{fontSize:10,color:cl2.dim,marginTop:3}}>Granite ~1.7, limestone ~1.6</div>
          </div>
        </div>
      </Card>

      <Card title="Ballast Top-up by Radius Band (kg/m/intervention)">
        <div style={{fontSize:11,color:cl2.dim,marginBottom:10}}>
          Tighter curves lose more ballast laterally. Degarnissage = {TAMP_DEGARN_FACTOR}x top-up rate (UIC 714R / Network Rail NR/L2/TRK/004).
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10}}>
          {["r1","r2","r3","r4","r5"].map(function(band){
            var val = appoint[band] || TAMP_APPOINT_DEFAULT[band];
            return (
              <div key={band} style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"10px 12px",border:"1px solid rgba(255,255,255,0.08)"}}>
                <div style={{fontSize:10,color:cl2.teal,fontWeight:700,marginBottom:6}}>{BAND_LABELS[band]}</div>
                <Lbl>Top-up (kg/m)</Lbl>
                <Inp value={val} onChange={function(v){var n=Object.assign({},appoint);n[band]=+v;props.onAppointChange(n);}} min={5} max={200} step={5}/>
                <div style={{fontSize:9,color:cl2.dim,marginTop:4}}>Degarn: {(val*TAMP_DEGARN_FACTOR).toFixed(0)} kg/m</div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Results by Segment">
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{borderBottom:"1px solid rgba(125,211,200,0.2)"}}>
                {["Segment","Band","Speed","Interval (MGT)","Interval (yrs)","Interventions","Degarnissages","Top-up/int (t)","Degarn/event (t)","Total Ballast"].map(function(h){
                  return <th key={h} style={{padding:"7px 10px",textAlign:"left",fontSize:10,color:cl2.dim,fontWeight:600,textTransform:"uppercase",letterSpacing:1}}>{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(function(r,i){
                return (
                  <tr key={r.seg.id} onClick={function(){onSegSelect(i);}} style={{cursor:"pointer",borderTop:"1px solid rgba(255,255,255,0.05)",background:aidx===i?"rgba(125,211,200,0.08)":i%2===0?"rgba(255,255,255,0.01)":"transparent"}}>
                    <td style={{padding:"8px 10px",color:"#e8f4f3",fontWeight:500}}>{r.seg.label}</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace",color:cl2.teal}}>{r.band.toUpperCase()}</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace"}}>{r.segSpeed} km/h</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace"}}>{fmt1(r.tampMGT)} MGT</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace"}}>{fmt1(r.yrsPerInt)} yrs</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace",color:cl2.teal,fontWeight:700}}>{r.nInterv}</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace",color:r.nDegarn>0?cl2.warn:cl2.dim,fontWeight:r.nDegarn>0?700:400}}>{r.nDegarn}</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace"}}>{fmt1(r.appointT)} t</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace",color:cl2.amber}}>{fmt1(r.degarnT)} t</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace",fontWeight:700}}>{fmtT(r.totalBallastT)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{borderTop:"2px solid rgba(125,211,200,0.3)"}}>
                <td colSpan={5} style={{padding:"8px 10px",fontSize:11,color:cl2.teal,fontWeight:700}}>TOTAL {horizon} YEARS</td>
                <td style={{padding:"8px 10px",fontFamily:"monospace",color:cl2.teal,fontWeight:700}}>{totInterv}</td>
                <td style={{padding:"8px 10px",fontFamily:"monospace",color:cl2.warn,fontWeight:700}}>{totDegarn}</td>
                <td colSpan={2}/>
                <td style={{padding:"8px 10px",fontFamily:"monospace",fontWeight:700,color:cl2.amber}}>{fmtT(totBallast)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card title={"Tamping Schedule -- "+horizon+"-Year Horizon"+(aidx>=0&&rows[aidx]?" -- "+rows[aidx].seg.label:"")}>
        <div style={{fontSize:11,color:cl2.dim,marginBottom:8,display:"flex",gap:20}}>
          <span><span style={{display:"inline-block",width:10,height:10,background:cl2.teal,borderRadius:2,marginRight:4}}/>Tamping</span>
          <span><span style={{display:"inline-block",width:10,height:10,background:cl2.warn,borderRadius:2,marginRight:4}}/>Degarnissage</span>
        </div>
        <ResponsiveContainer width="100%" height={Math.max(140,rows.length*44+60)}>
          <BarChart data={chartData} barSize={aidx>=0?18:8}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
            <XAxis dataKey="year" stroke="#4a6a74" tick={{fontSize:10}}/>
            <YAxis stroke="#4a6a74" tick={{fontSize:10}} tickFormatter={function(){return "";}} width={8}/>
            <Tooltip content={function(p){
              if(!p.active||!p.payload||!p.payload.length) return null;
              var evts=p.payload.filter(function(x){return x.value>0;});
              if(!evts.length) return null;
              return <div style={{background:"#1a2f38",border:"1px solid rgba(125,211,200,0.2)",borderRadius:6,padding:"8px 12px",fontSize:11}}>
                <div style={{color:cl2.teal,fontWeight:700,marginBottom:4}}>Year {p.label}</div>
                {evts.map(function(e){
                  var isDeg=e.dataKey.startsWith("d_");
                  var segId=e.dataKey.slice(2);
                  var seg=rows.find(function(r){return r.seg.id===segId;});
                  return <div key={e.dataKey} style={{color:isDeg?cl2.warn:cl2.teal}}>{isDeg?"Degarnissage":"Tamping"}: {seg?seg.seg.label:segId}</div>;
                })}
              </div>;
            }}/>
            {rows.filter(function(r,i){ return aidx<0||aidx===i; }).map(function(r){
              return [
                <Bar key={"t_"+r.seg.id} dataKey={"t_"+r.seg.id} stackId={r.seg.id} fill={cl2.teal} opacity={0.9} radius={[2,2,0,0]}/>,
                <Bar key={"d_"+r.seg.id} dataKey={"d_"+r.seg.id} stackId={r.seg.id} fill={cl2.warn} opacity={0.95} radius={[2,2,0,0]}/>,
              ];
            })}
          </BarChart>
        </ResponsiveContainer>
        <div style={{marginTop:6,fontSize:10,color:cl2.dim}}>
          Platform: {platform} (f={TAMP_PLATFORM[platform]}) | Degarnissage every {degCycles} cycles | V_ref={TAMP_V_REF} km/h
        </div>
      </Card>
    </div>
  );
}



// ---- TAMPING COST PANEL ----

function TampingCostPanel(props) {
  var segs        = props.segs || [];
  var result      = props.result;
  var horizon     = props.horizon || 30;
  var context     = props.context || "metro";
  var platform    = props.platform || "P2";
  var appoint     = props.appoint || TAMP_APPOINT_DEFAULT;
  var degCycles   = props.degCycles || 6;
  var globalSpeed = props.globalSpeed || 80;
  var currencyMap = props.currencyMap || CURRENCIES;
  var currency    = props.currency || "EUR";
  var cl2 = cl;

  const [machineKey, setMachine] = useState(props.initMachine || "standard");
  const [mode,       setMode]    = useState(props.initMode || "sub");
  const [region,     setRegion]  = useState(props.initRegion || "WEU");
  const [nightHrs,   setNight]   = useState(props.initNight || 6);
  const [ballastPxOv,setBallPx]  = useState(props.initBallastPxOv !== undefined ? props.initBallastPxOv : null);
  const [cOpPerMl,   setCOp]     = useState(props.initCOpPerMl !== undefined ? props.initCOpPerMl : null);
  const [cMobilFix,  setCMF]     = useState(props.initCMobilFix !== undefined ? props.initCMobilFix : null);
  const [cDegarnMl,  setCDeg]    = useState(props.initCDegarnMl !== undefined ? props.initCDegarnMl : null);
  const [ownManual,  setOwnManual] = useState(!!props.initOwnManual);
  const [ownFuelLph, setOwnFuelLph] = useState(props.initOwnFuelLph !== undefined ? props.initOwnFuelLph : null);
  const [ownGasoil,  setOwnGasoil]  = useState(props.initOwnGasoil !== undefined ? props.initOwnGasoil : null);
  const [ownMaintH,  setOwnMaintH]  = useState(props.initOwnMaintH !== undefined ? props.initOwnMaintH : null);
  const [ownLabourH, setOwnLabourH] = useState(props.initOwnLabourH !== undefined ? props.initOwnLabourH : null);
  const [ownProdMlH, setOwnProdMlH] = useState(props.initOwnProdMlH !== undefined ? props.initOwnProdMlH : null);

  var sym = (currencyMap[currency]||currencyMap.EUR||CURRENCIES.EUR).symbol;
  var fx  = (currencyMap[currency]||currencyMap.EUR||CURRENCIES.EUR).rate;

  var machine = TAMP_MACHINES_BOUR[machineKey] || TAMP_MACHINES_BOUR.standard;
  var ownPreset = machine.ownedRates ? {
    fuelLph: machine.ownedRates.fuelLph,
    gasoilEurL: TAMP_DIESEL_EUR_L[region] || TAMP_DIESEL_EUR_L.WEU,
    maintEurH: machine.ownedRates.maintEurH,
    labourTeamEurH: (machine.ownedRates.labour[region]||machine.ownedRates.labour.WEU) * machine.ownedRates.team,
    labourPerHeadEurH: machine.ownedRates.labour[region]||machine.ownedRates.labour.WEU,
    team: machine.ownedRates.team,
    prodMlH: machine.prodMlH,
  } : null;
  var ownOverrides = mode==="owned" && ownManual ? {
    fuelLph: ownFuelLph,
    gasoilEurL: ownGasoil,
    maintEurH: ownMaintH,
    labourTeamEurH: ownLabourH,
    prodMlH: ownProdMlH,
  } : null;
  var tcp     = calcTampCostPerMl(machine, mode, region, nightHrs, currencyMap, currency, ownOverrides);
  var opPerMl   = cOpPerMl  !== null ? cOpPerMl  * fx : tcp.perMl;
  var mobilFix  = cMobilFix !== null ? cMobilFix * fx : tcp.mobilFix;

  var ballastPreset = TAMP_BALLAST_PRICE[region] || TAMP_BALLAST_PRICE.WEU;
  var ballastEurT   = ballastPxOv !== null ? ballastPxOv * fx
                      : (ballastPreset.carriere + ballastPreset.delivery) * fx;

  var degarnOp  = TAMP_DEGARN_OP[region] || TAMP_DEGARN_OP.WEU;
  var degarnOpMl  = cDegarnMl !== null ? cDegarnMl * fx : degarnOp.opPerMl * fx;
  var degarnMobFx = degarnOp.mobilFix * fx;

  var ctx = context==="tram"?"tram":context==="heavy"?"heavy":"metro";
  var fp  = TAMP_PLATFORM[platform] || 1.0;

  var rows = segs.filter(function(s){ return (s.active||s.isSpecialZone||s.lengthKm>0)&&s.lengthKm>0; }).map(function(seg,si) {
    var band      = TAMP_BAND(seg.repr || seg.radius || 300);
    var baseInt   = (TAMP_BASE_MGT[ctx]||TAMP_BASE_MGT.metro)[band]||25;
    var segSpeed  = seg.speed || globalSpeed;
    var fSpeed    = Math.sqrt(Math.max(20,TAMP_V_REF)/Math.max(20,segSpeed));
    var tampMGT   = baseInt * fp * fSpeed;
    var res       = result&&result.results ? result.results[si] : null;
    var mgtPY     = res ? res.mgtPY : 5;
    var yrsPerInt = mgtPY>0 ? tampMGT/mgtPY : tampMGT/5;
    var nInterv   = Math.max(0, Math.floor(horizon/yrsPerInt));
    var nDegarn   = Math.floor(nInterv/degCycles);
    var lenMl     = seg.lengthKm*1000;
    var appKgMl   = appoint[band]||TAMP_APPOINT_DEFAULT[band]||20;
    var appointT  = appKgMl*lenMl/1000;
    var degarnAppT = appKgMl*TAMP_DEGARN_FACTOR*lenMl/1000;

    var cOpCyc    = opPerMl * lenMl;
    var cMobCyc   = mobilFix;
    var cBallCyc  = appointT * ballastEurT;
    var cDegOpCyc = degarnOpMl * lenMl + degarnMobFx;
    var cDegBalCyc= degarnAppT * ballastEurT;

    var totalOpC   = cOpCyc   * nInterv;
    var totalMobC  = cMobCyc  * nInterv;
    var totalBallC = cBallCyc * nInterv;
    var totalDegC  = (cDegOpCyc + cDegBalCyc) * nDegarn;
    var totalC     = totalOpC + totalMobC + totalBallC + totalDegC;

    return {
      seg:seg, band:band, lenMl:lenMl, nInterv:nInterv, nDegarn:nDegarn,
      totalOpC:totalOpC, totalMobC:totalMobC, totalBallC:totalBallC, totalDegC:totalDegC, totalC:totalC,
    };
  });

  var gOp   = rows.reduce(function(a,r){return a+r.totalOpC;},0);
  var gMob  = rows.reduce(function(a,r){return a+r.totalMobC;},0);
  var gBall = rows.reduce(function(a,r){return a+r.totalBallC;},0);
  var gDeg  = rows.reduce(function(a,r){return a+r.totalDegC;},0);
  var gTot  = gOp+gMob+gBall+gDeg;

  function fmtC(v){ return v>=1e6?(v/1e6).toFixed(2)+"M "+sym:v>=1e3?(v/1e3).toFixed(1)+"k "+sym:v.toFixed(0)+" "+sym; }
  function notifyParent(overrides){
    if(!props.onParamsChange) return;
    props.onParamsChange(Object.assign({
      machineKey:machineKey,
      mode:mode,
      region:region,
      nightHrs:nightHrs,
      ballastPxOv:ballastPxOv,
      cOpPerMl:cOpPerMl,
      cMobilFix:cMobilFix,
      cDegarnMl:cDegarnMl,
      ownManual:ownManual,
      ownFuelLph:ownFuelLph,
      ownGasoil:ownGasoil,
      ownMaintH:ownMaintH,
      ownLabourH:ownLabourH,
      ownProdMlH:ownProdMlH,
    }, overrides||{}));
  }
  function resetOp(){ setCOp(null); setCMF(null); notifyParent({cOpPerMl:null,cMobilFix:null}); }
  function resetDeg(){ setCDeg(null); notifyParent({cDegarnMl:null}); }
  function resetBall(){ setBallPx(null); notifyParent({ballastPxOv:null}); }
  function initOwnManual(nextMachineKey, nextRegion) {
    var mk = nextMachineKey || machineKey;
    var rg = nextRegion || region;
    var m = TAMP_MACHINES_BOUR[mk] || TAMP_MACHINES_BOUR.standard;
    if(!m || !m.ownedRates) return;
    var nextFuel = m.ownedRates.fuelLph;
    var nextGasoil = TAMP_DIESEL_EUR_L[rg] || TAMP_DIESEL_EUR_L.WEU;
    var nextMaint = m.ownedRates.maintEurH;
    var nextLab = (m.ownedRates.labour[rg]||m.ownedRates.labour.WEU) * m.ownedRates.team;
    var nextProd = m.prodMlH;
    setOwnFuelLph(nextFuel);
    setOwnGasoil(nextGasoil);
    setOwnMaintH(nextMaint);
    setOwnLabourH(nextLab);
    setOwnProdMlH(nextProd);
    notifyParent({ownFuelLph:nextFuel,ownGasoil:nextGasoil,ownMaintH:nextMaint,ownLabourH:nextLab,ownProdMlH:nextProd});
  }
  function resetOwnManual() {
    setOwnFuelLph(null);
    setOwnGasoil(null);
    setOwnMaintH(null);
    setOwnLabourH(null);
    setOwnProdMlH(null);
    notifyParent({ownFuelLph:null,ownGasoil:null,ownMaintH:null,ownLabourH:null,ownProdMlH:null});
  }
  useEffect(function(){
    notifyParent();
  }, [machineKey, mode, region, nightHrs, ballastPxOv, cOpPerMl, cMobilFix, cDegarnMl, ownManual, ownFuelLph, ownGasoil, ownMaintH, ownLabourH, ownProdMlH]);

  return (
    <div style={{display:"grid",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12}}>
        {[[fmtC(gOp+gMob),cl2.teal,"Operation + Mob.","tamping machine over "+horizon+" yrs"],
          [fmtC(gBall),cl2.amber,"Ballast Top-up","purchased + delivered"],
          [fmtC(gDeg),cl2.warn,"Degarnissages","op + ballast renewal"],
          [fmtC(gTot),"#e8f4f3","Total Lifecycle","all tamping costs"],
        ].map(function(k,i){
          return <div key={i} style={{background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"14px 18px",border:"1px solid rgba(255,255,255,0.08)"}}>
            <div style={{fontSize:10,color:cl2.dim,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>{k[2]}</div>
            <div style={{fontSize:22,fontWeight:800,color:k[1]}}>{k[0]}</div>
            <div style={{fontSize:11,color:cl2.dim,marginTop:2}}>{k[3]}</div>
          </div>;
        })}
      </div>

      <Card title="Machine and Rates">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12}}>
          <div>
            <Lbl>Mode</Lbl>
            <div style={{display:"flex",gap:6}}>
              {["sub","owned"].map(function(m){
                return <div key={m} onClick={function(){
                  setMode(m);
                  notifyParent({mode:m});
                  if(m==="sub") {
                    setOwnManual(false);
                    resetOwnManual();
                    notifyParent({ownManual:false});
                  } else if(m==="owned" && !ownManual) {
                    initOwnManual();
                  }
                  resetOp();
                }}
                  style={{flex:1,padding:"5px 0",textAlign:"center",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:600,
                    background:mode===m?"rgba(125,211,200,0.15)":"rgba(255,255,255,0.04)",
                    border:"1px solid "+(mode===m?"rgba(125,211,200,0.4)":"rgba(255,255,255,0.1)"),
                    color:mode===m?cl2.teal:cl2.dim}}>
                  {m==="sub"?"Subcontract":"Own fleet"}
                </div>;
              })}
            </div>
          </div>
          <div>
            <Lbl>{mode==="owned"?"Machine":"Machine type"}</Lbl>
            <Sel value={machineKey} onChange={function(v){setMachine(v); notifyParent({machineKey:v}); resetOp(); if(mode==="owned" && !ownManual){initOwnManual(v, region);}}}
              opts={Object.keys(TAMP_MACHINES_BOUR).map(function(k){return {v:k,l:TAMP_MACHINES_BOUR[k].label};})}/>
            <div style={{fontSize:10,color:cl2.dim,marginTop:3}}>{(mode==="owned" && tcp.prodMlH ? tcp.prodMlH : machine.prodMlH)} m/h productivity</div>
          </div>
          <div>
            <Lbl>Region</Lbl>
            <Sel value={region} onChange={function(v){setRegion(v); notifyParent({region:v}); resetOp(); resetDeg(); resetBall(); if(mode==="owned" && !ownManual){initOwnManual(machineKey, v);}}}
              opts={["WEU","EEU","MENA","SSA","SEA","LATAM"].map(function(r){return {v:r,l:r};})}/>
          </div>
          <div>
            <Lbl>Night hours / intervention</Lbl>
            <Inp value={nightHrs} onChange={function(v){setNight(v); notifyParent({nightHrs:v});}} min={2} max={10} step={0.5}/>
            <div style={{fontSize:10,color:cl2.dim,marginTop:3}}>{tcp.mlPerNight.toFixed(0)} m/night capacity</div>
          </div>
        </div>
        {mode==="sub"&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:12,padding:"10px 12px",background:"rgba(125,211,200,0.04)",borderRadius:8,border:"1px solid rgba(125,211,200,0.1)"}}>
            <div>
              <Lbl>Op rate (EUR/ml){cOpPerMl!==null&&<span style={{color:cl2.amber,marginLeft:4}}>CUSTOM</span>}</Lbl>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <Inp value={cOpPerMl!==null?cOpPerMl:+(tcp.perMl/fx).toFixed(2)} onChange={function(v){setCOp(+v); notifyParent({cOpPerMl:+v});}} min={0.5} max={50} step={0.5}/>
                {cOpPerMl!==null&&<div onClick={function(){setCOp(null);}} style={{fontSize:10,color:cl2.dim,cursor:"pointer",whiteSpace:"nowrap"}}>Reset</div>}
              </div>
            </div>
            <div>
              <Lbl>Mobilisation (EUR/intervention){cMobilFix!==null&&<span style={{color:cl2.amber,marginLeft:4}}>CUSTOM</span>}</Lbl>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <Inp value={cMobilFix!==null?cMobilFix:+(tcp.mobilFix/fx).toFixed(0)} onChange={function(v){setCMF(+v); notifyParent({cMobilFix:+v});}} min={0} max={50000} step={500}/>
                {cMobilFix!==null&&<div onClick={function(){setCMF(null);}} style={{fontSize:10,color:cl2.dim,cursor:"pointer",whiteSpace:"nowrap"}}>Reset</div>}
              </div>
            </div>
          </div>
        )}
        {mode==="owned"&&ownPreset&&(
          <div style={{marginTop:12,padding:"12px 14px",background:"rgba(125,211,200,0.04)",borderRadius:8,border:"1px solid rgba(125,211,200,0.1)"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:ownManual?12:8}}>
              <div onClick={function(){
                setOwnManual(function(v){
                  var next=!v;
                  if(next) initOwnManual();
                  if(!next) resetOwnManual();
                  notifyParent({ownManual:next});
                  return next;
                });
              }} style={{width:28,height:16,borderRadius:8,background:ownManual?cl2.teal:"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",border:"1px solid "+(ownManual?"rgba(125,211,200,0.4)":"rgba(255,255,255,0.15)")}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:ownManual?14:2}}/>
              </div>
              <div style={{fontSize:11,color:ownManual?cl2.teal:cl2.dim,fontWeight:600}}>Manual parameters</div>
            </div>
            {!ownManual&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div style={{background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:10,color:cl2.teal,fontWeight:700,letterSpacing:1,marginBottom:8}}>AUTO-CALCULATED (PRESET)</div>
                  <div style={{fontSize:11,color:cl2.dim,marginBottom:4}}>Fuel: <b style={{color:"#e8f4f3"}}>{ownPreset.fuelLph} L/h</b></div>
                  <div style={{fontSize:11,color:cl2.dim,marginBottom:4}}>Gasoil: <b style={{color:"#e8f4f3"}}>{ownPreset.gasoilEurL.toFixed(2)} EUR/L</b></div>
                  <div style={{fontSize:11,color:cl2.dim,marginBottom:4}}>Maintenance: <b style={{color:"#e8f4f3"}}>{ownPreset.maintEurH.toFixed(0)} EUR/h</b></div>
                  <div style={{fontSize:11,color:cl2.dim,marginBottom:4}}>Labour: <b style={{color:"#e8f4f3"}}>{ownPreset.labourPerHeadEurH.toFixed(0)} x {ownPreset.team} = {ownPreset.labourTeamEurH.toFixed(0)} EUR/h</b></div>
                  <div style={{fontSize:11,color:cl2.dim}}>Productivity: <b style={{color:"#e8f4f3"}}>{ownPreset.prodMlH} m/h</b></div>
                </div>
                <div style={{background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"10px 12px",display:"flex",flexDirection:"column",justifyContent:"center"}}>
                  <div style={{fontSize:10,color:cl2.dim,marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>Own Fleet Formula</div>
                  <div style={{fontSize:11,color:cl2.dim,marginBottom:6}}>(fuelLph x gasoilEurL + maintEurH + labourTeamEurH) / prodMlH</div>
                  <div style={{fontSize:12,color:cl2.teal,fontWeight:700}}>Hourly cost: {tcp.hourlyCostEur.toFixed(1)} EUR/h</div>
                  <div style={{fontSize:16,color:"#e8f4f3",fontWeight:800,marginTop:6}}>Op rate: {tcp.perMlEur.toFixed(2)} EUR/ml</div>
                </div>
              </div>
            )}
            {ownManual&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div><Lbl>Fuel consumption</Lbl><Inp value={ownFuelLph!==null?ownFuelLph:ownPreset.fuelLph} onChange={function(v){setOwnFuelLph(+v); notifyParent({ownFuelLph:+v});}} min={1} max={200} step={1}/><div style={{fontSize:10,color:cl2.dim,marginTop:3}}>L/h</div></div>
                    <div><Lbl>Gasoil price</Lbl><Inp value={ownGasoil!==null?ownGasoil:ownPreset.gasoilEurL} onChange={function(v){setOwnGasoil(+v); notifyParent({ownGasoil:+v});}} min={0.2} max={5} step={0.05}/><div style={{fontSize:10,color:cl2.dim,marginTop:3}}>EUR/L</div></div>
                    <div><Lbl>Maintenance</Lbl><Inp value={ownMaintH!==null?ownMaintH:ownPreset.maintEurH} onChange={function(v){setOwnMaintH(+v); notifyParent({ownMaintH:+v});}} min={10} max={1000} step={5}/><div style={{fontSize:10,color:cl2.dim,marginTop:3}}>EUR/h</div></div>
                    <div><Lbl>Labour team rate</Lbl><Inp value={ownLabourH!==null?ownLabourH:ownPreset.labourTeamEurH} onChange={function(v){setOwnLabourH(+v); notifyParent({ownLabourH:+v});}} min={10} max={1000} step={5}/><div style={{fontSize:10,color:cl2.dim,marginTop:3}}>EUR/h team included</div></div>
                    <div><Lbl>Productivity</Lbl><Inp value={ownProdMlH!==null?ownProdMlH:ownPreset.prodMlH} onChange={function(v){setOwnProdMlH(+v); notifyParent({ownProdMlH:+v});}} min={20} max={1000} step={5}/><div style={{fontSize:10,color:cl2.dim,marginTop:3}}>m/h</div></div>
                  </div>
                </div>
                <div style={{background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:10,color:cl2.teal,fontWeight:700,letterSpacing:1,marginBottom:8}}>MANUAL OVERRIDE</div>
                  <div style={{fontSize:11,color:cl2.dim,marginBottom:4}}>Fuel: <b style={{color:"#e8f4f3"}}>{tcp.fuelLph.toFixed(1)} L/h</b></div>
                  <div style={{fontSize:11,color:cl2.dim,marginBottom:4}}>Gasoil: <b style={{color:"#e8f4f3"}}>{tcp.gasoilEurL.toFixed(2)} EUR/L</b></div>
                  <div style={{fontSize:11,color:cl2.dim,marginBottom:4}}>Maintenance: <b style={{color:"#e8f4f3"}}>{tcp.maintEurH.toFixed(1)} EUR/h</b></div>
                  <div style={{fontSize:11,color:cl2.dim,marginBottom:4}}>Labour: <b style={{color:"#e8f4f3"}}>{tcp.labourTeamEurH.toFixed(1)} EUR/h</b></div>
                  <div style={{fontSize:11,color:cl2.dim,marginBottom:8}}>Productivity: <b style={{color:"#e8f4f3"}}>{tcp.prodMlH.toFixed(1)} m/h</b></div>
                  <div style={{fontSize:12,color:cl2.teal,fontWeight:700}}>Hourly cost: {tcp.hourlyCostEur.toFixed(1)} EUR/h</div>
                  <div style={{fontSize:16,color:"#e8f4f3",fontWeight:800,marginTop:6}}>Op rate: {tcp.perMlEur.toFixed(2)} EUR/ml</div>
                  <div style={{fontSize:10,color:cl2.dim,marginTop:8}}>Formula: (fuel x gasoil + maintenance + labour team) / productivity</div>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="Ballast Price">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
          <div>
            <Lbl>Ballast delivered (EUR/t){ballastPxOv!==null&&<span style={{color:cl2.amber,marginLeft:4}}>CUSTOM</span>}</Lbl>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <Inp value={ballastPxOv!==null?ballastPxOv:+((ballastPreset.carriere+ballastPreset.delivery)).toFixed(1)} onChange={function(v){setBallPx(+v); notifyParent({ballastPxOv:+v});}} min={5} max={120} step={1}/>
              {ballastPxOv!==null&&<div onClick={resetBall} style={{fontSize:10,color:cl2.dim,cursor:"pointer",whiteSpace:"nowrap"}}>Reset</div>}
            </div>
            <div style={{fontSize:10,color:cl2.dim,marginTop:3}}>Preset: {ballastPreset.carriere} quarry + {ballastPreset.delivery} delivery</div>
          </div>
          <div>
            <Lbl>Degarnissage op rate (EUR/ml){cDegarnMl!==null&&<span style={{color:cl2.amber,marginLeft:4}}>CUSTOM</span>}</Lbl>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <Inp value={cDegarnMl!==null?cDegarnMl:+(degarnOp.opPerMl).toFixed(1)} onChange={function(v){setCDeg(+v); notifyParent({cDegarnMl:+v});}} min={5} max={150} step={1}/>
              {cDegarnMl!==null&&<div onClick={resetDeg} style={{fontSize:10,color:cl2.dim,cursor:"pointer",whiteSpace:"nowrap"}}>Reset</div>}
            </div>
            <div style={{fontSize:10,color:cl2.dim,marginTop:3}}>Operation only -- ballast added separately</div>
          </div>
          <div style={{background:"rgba(251,191,36,0.05)",borderRadius:8,padding:"10px 12px",border:"1px solid rgba(251,191,36,0.12)"}}>
            <div style={{fontSize:10,color:cl2.amber,fontWeight:700,marginBottom:6}}>DEGARNISSAGE TOTAL RATE</div>
            <div style={{fontSize:11,color:cl2.dim,marginBottom:4}}>Op: {fmtC(degarnOpMl)}/ml</div>
            <div style={{fontSize:11,color:cl2.dim,marginBottom:4}}>Ballast (~{(TAMP_APPOINT_DEFAULT.r3*TAMP_DEGARN_FACTOR/1000).toFixed(2)}t/m): {fmtC((TAMP_APPOINT_DEFAULT.r3*TAMP_DEGARN_FACTOR/1000)*ballastEurT)}/ml</div>
            <div style={{fontSize:12,color:cl2.amber,fontWeight:700}}>Total ~{fmtC(degarnOpMl+(TAMP_APPOINT_DEFAULT.r3*TAMP_DEGARN_FACTOR/1000)*ballastEurT)}/ml</div>
          </div>
        </div>
      </Card>

      <Card title="Cost by Segment">
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{borderBottom:"1px solid rgba(125,211,200,0.2)"}}>
                {["Segment","Int.","Degarn.","Operation","Mobilisation","Ballast top-up","Degarnissage","Total"].map(function(h){
                  return <th key={h} style={{padding:"7px 10px",textAlign:"left",fontSize:10,color:cl2.dim,fontWeight:600,textTransform:"uppercase",letterSpacing:1}}>{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(function(r,i){
                return (
                  <tr key={r.seg.id} style={{borderTop:"1px solid rgba(255,255,255,0.05)",background:i%2===0?"rgba(255,255,255,0.01)":"transparent"}}>
                    <td style={{padding:"8px 10px",color:"#e8f4f3",fontWeight:500}}>{r.seg.label}</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace",color:cl2.dim}}>{r.nInterv}</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace",color:r.nDegarn>0?cl2.warn:cl2.dim}}>{r.nDegarn}</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace"}}>{fmtC(r.totalOpC)}</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace"}}>{fmtC(r.totalMobC)}</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace",color:cl2.amber}}>{fmtC(r.totalBallC)}</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace",color:cl2.warn}}>{fmtC(r.totalDegC)}</td>
                    <td style={{padding:"8px 10px",fontFamily:"monospace",fontWeight:700}}>{fmtC(r.totalC)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{borderTop:"2px solid rgba(125,211,200,0.3)"}}>
                <td colSpan={3} style={{padding:"8px 10px",fontSize:11,color:cl2.teal,fontWeight:700}}>TOTAL {horizon} YEARS</td>
                <td style={{padding:"8px 10px",fontFamily:"monospace",fontWeight:700}}>{fmtC(gOp)}</td>
                <td style={{padding:"8px 10px",fontFamily:"monospace",fontWeight:700}}>{fmtC(gMob)}</td>
                <td style={{padding:"8px 10px",fontFamily:"monospace",fontWeight:700,color:cl2.amber}}>{fmtC(gBall)}</td>
                <td style={{padding:"8px 10px",fontFamily:"monospace",fontWeight:700,color:cl2.warn}}>{fmtC(gDeg)}</td>
                <td style={{padding:"8px 10px",fontFamily:"monospace",fontWeight:800,color:"#e8f4f3"}}>{fmtC(gTot)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div style={{fontSize:10,color:cl2.dim,marginTop:8}}>
          Rates: {fmtC(opPerMl)}/ml op + {fmtC(mobilFix)}/intervention mob | Ballast: {fmtC(ballastEurT)}/t | Degarnissage op: {fmtC(degarnOpMl)}/ml | Platform: {platform} (f={TAMP_PLATFORM[platform]})
        </div>
      </Card>
    </div>
  );
}


// ---- COMPARISON PANEL ----

function ComparePanel(props) {
  var simResult = props.simResult;
  var params    = props.params;
  var horizon   = props.horizon;
  var context   = props.context;
  var currencies = props.currencyMap || CURRENCIES;
  var grindRate = props.grindEurPerMl || 22;
  var replRate  = props.replEurPerMl  || 380;
  var gcp       = props.grindCostParams || {perMl:grindRate, mobilCostPerInt:0, mobilPerInt:true};
  var currency = props.currency || "EUR";
  var sym = (currencies[currency]||currencies.EUR||CURRENCIES.EUR).symbol;
  var fx  = (currencies[currency]||currencies.EUR||CURRENCIES.EUR).rate;
  // Grade-aware replacement rate function  - falls back to flat replRate if not provided
  function getReplRate(grade) {
    if(props.calcReplRate) return props.calcReplRate(grade);
    return replRate;
  }

  const [prevResult, setPrev]   = useState(null);  // always preventive
  const [corrResult, setCorr]   = useState(null);  // always corrective
  const [running,    setRun]    = useState(false);
  const [aidx,       setAi]     = useState(0);
  const [chartTab,   setChTab]  = useState("wear");
  const [cmpParamsHash, setCmpHash] = useState(null);
  const [kpiView,    setKpiView]= useState("first"); // "first" or "full"

  // Hash excludes strategy  - comparison always runs both regardless
  var paramsHash = params ? JSON.stringify({
    context:      params.context,
    trains:       params.trains,
    railType:     params.railType,
    trackMode:    params.trackMode,
    speed:        params.speed,
    lubrication:  params.lubrication,
    horizonYears: params.horizonYears,
    segKeys: (params.segments||[]).map(function(s){
      return s.id+"_"+s.radius+"_"+s.railGrade+"_"+(s.initWearV||0)+"_"+(s.initRCF||0);
    }).join("|"),
    reprActive:      props.reprActive,
    reprThresh:      props.reprThresh,
    reprRemL:        props.reprRemL,
    reprRcfR:        props.reprRcfR,
    reprSkip:        props.reprSkip,
    reprRadiusBased: props.reprRadiusBased,
    reprBandR1: props.reprRemLByBand?props.reprRemLByBand.r1:null,
    reprBandR2: props.reprRemLByBand?props.reprRemLByBand.r2:null,
    reprBandR3: props.reprRemLByBand?props.reprRemLByBand.r3:null,
    reprBandR4: props.reprRemLByBand?props.reprRemLByBand.r4:null,
    customResActive: params.customResActive,
    customMinRes:    params.customMinRes,
    customLimV:      params.customLimV,
    customLimL:      params.customLimL,
  }) : null;
  var isStale      = (prevResult||corrResult) && cmpParamsHash && paramsHash && cmpParamsHash !== paramsHash;
  var hasComparison = !!(prevResult && corrResult);

  function runComparison() {
    if (!params) return;
    setRun(true);
    try {
      var reprParams = {reprActive:props.reprActive,reprThresh:props.reprThresh,reprRemL:props.reprRemL,reprRemV:props.reprRemV,reprRcfR:props.reprRcfR,reprSkip:props.reprSkip!==false,reprRadiusBased:props.reprRadiusBased,reprRemLByBand:props.reprRemLByBand,customResActive:params.customResActive,customMinRes:params.customMinRes,customLimV:params.customLimV,customLimL:params.customLimL};
      var rP = runSim(Object.assign({}, params, reprParams, { strategy: "preventive" }));
      var rC = runSim(Object.assign({}, params, reprParams, { strategy: "corrective" }));
      setPrev(rP);
      setCorr(rC);
      setCmpHash(paramsHash);
      setAi(0);
    } catch(e) { }
    setRun(false);
  }

  function fmt(v) {
    if (v >= 1e6) return (v/1e6).toFixed(2)+"M "+sym;
    if (v >= 1e3) return (v/1e3).toFixed(1)+"k "+sym;
    return v.toFixed(0)+" "+sym;
  }
  function fmtDelta(v) {
    var s = v >= 0 ? "+" : "";
    if (Math.abs(v) >= 1e6) return s+(v/1e6).toFixed(2)+"M "+sym;
    if (Math.abs(v) >= 1e3) return s+(v/1e3).toFixed(1)+"k "+sym;
    return s+v.toFixed(0)+" "+sym;
  }

  // Per-segment data  - always prev vs corr
  var segData = hasComparison ? prevResult.results.map(function(pr, i) {
    var cr = corrResult.results[i];
    if (!cr) return null;
    var pPasses    = pr.data ? pr.data.reduce(function(a,d){return a+d.ground;},0) : 0;
    var cPasses    = cr.data ? cr.data.reduce(function(a,d){return a+d.ground;},0) : 0;
    var lenMl      = (pr.seg.lengthKm || 0) * 1000;
    var segGrade   = pr.seg.grade || pr.seg.railGrade || "R260";
    var segReplRate = getReplRate(segGrade) * fx;
    var grindPerMl  = gcp.perMl * fx;
    var grindMobil  = gcp.mobilCostPerInt * fx;
    var pGrindOp   = lenMl * pPasses * grindPerMl;
    var cGrindOp   = lenMl * cPasses * grindPerMl;
    var pMobil     = grindMobil>0?(gcp.mobilPerInt?grindMobil*pPasses:grindMobil):0;
    var cMobil     = grindMobil>0?(gcp.mobilPerInt?grindMobil*cPasses:grindMobil):0;
    var pGrindCost = pGrindOp + pMobil;
    var cGrindCost = cGrindOp + cMobil;
    var pReplCost  = pr.repY ? lenMl * segReplRate : 0;
    var cReplCost  = cr.repY ? lenMl * segReplRate : 0;
    var reprOpRate  = props.reprActive ? (props.liveReprRate||0)  * fx : 0;
    var reprMobRate = props.reprActive ? (props.liveReprMobil||0) * fx : 0;
    var pReprCost = (lenMl * reprOpRate + reprMobRate) * (pr.reprCount||0);
    var cReprCost = (lenMl * reprOpRate + reprMobRate) * (cr.reprCount||0);
    var pTotal    = pGrindCost + pReplCost + pReprCost;
    var cTotal    = cGrindCost + cReplCost + cReprCost;
    return {
      seg: pr.seg, i: i,
      prevData: pr.data, corrData: cr.data,
      pPasses: pPasses, cPasses: cPasses,
      pRepl: pr.repY,   cRepl: cr.repY,
      pGrindCost: pGrindCost, cGrindCost: cGrindCost,
      pReplCost:  pReplCost,  cReplCost:  cReplCost,
      pReprCost:  pReprCost,  cReprCost:  cReprCost,
      pTotal: pTotal, cTotal: cTotal,
      saving: cTotal - pTotal,
    };
  }).filter(Boolean) : [];

  var totalPrev   = segData.reduce(function(a,s){return a+s.pTotal;},0);
  var totalCorr   = segData.reduce(function(a,s){return a+s.cTotal;},0);
  var totalSaving = totalCorr - totalPrev;

  // Full-horizon lifecycle computation (same logic as the table below, lifted for the banner)
  var fullHorizonData = segData.map(function(s) {
    function cycleCalc(firstRepY, firstPasses, firstGrindCost, firstReplCost, firstReprCost) {
      var firstReprCostV = firstReprCost||0;
      if (!firstRepY) return {repls:0, passes:firstPasses, grindCost:firstGrindCost, replCost:0, reprCost:firstReprCostV, total:firstGrindCost};
      var cycleLen=firstRepY, yr=0, repls=0, passes=0, grindCost=0, replCost=0, reprCost=0;
      while(yr + cycleLen <= horizon) {
        yr+=cycleLen; repls+=1; passes+=firstPasses; grindCost+=firstGrindCost; replCost+=firstReplCost; reprCost+=firstReprCostV;
      }
      var frac=(horizon-yr)/cycleLen;
      if(frac>0){passes+=Math.round(firstPasses*frac); grindCost+=firstGrindCost*frac; reprCost+=firstReprCostV*frac;}
      return {repls:repls, passes:passes, grindCost:grindCost, replCost:replCost, reprCost:reprCost, total:grindCost+replCost+reprCost};
    }
    var ph=cycleCalc(s.pRepl,s.pPasses,s.pGrindCost,s.pReplCost,s.pReprCost);
    var ch=cycleCalc(s.cRepl,s.cPasses,s.cGrindCost,s.cReplCost,s.cReprCost);
    return {pTotal:ph.total, cTotal:ch.total, pRepls:ph.repls, cRepls:ch.repls, pPass:ph.passes, cPass:ch.passes, pReprCost:ph.reprCost, cReprCost:ch.reprCost, pGrind:ph.grindCost, cGrind:ch.grindCost, pRepl:ph.replCost, cRepl:ch.replCost};
  });
  var fhTotalPrev   = fullHorizonData.reduce(function(a,r){return a+r.pTotal;},0);
  var fhTotalCorr   = fullHorizonData.reduce(function(a,r){return a+r.cTotal;},0);
  var fhTotalSaving = fhTotalCorr - fhTotalPrev;
  var fhTotalReplsP = fullHorizonData.reduce(function(a,r){return a+r.pRepls;},0);
  var fhTotalReplsC = fullHorizonData.reduce(function(a,r){return a+r.cRepls;},0);
  var prevRepls   = hasComparison ? prevResult.results.filter(function(r){return r.repY;}).length : 0;
  var corrRepls   = hasComparison ? corrResult.results.filter(function(r){return r.repY;}).length : 0;

  var asr     = segData[aidx];
  var prevSeg = asr && asr.prevData;
  var corrSeg = asr && asr.corrData;

  // Merge year data  - both V, L and RCF for each strategy
  function mergeData(pData, cData) {
    if (!pData || !cData) return [];
    var maxY = Math.max(pData.length, cData.length);
    var out  = [];
    for (var y = 0; y < maxY; y++) {
      var row = { year: (pData[y]||cData[y]).year };
      if (pData[y]) { row.pV=pData[y].wearV; row.pL=pData[y].wearL; row.pRCF=pData[y].rcf; }
      if (cData[y]) { row.cV=cData[y].wearV; row.cL=cData[y].wearL; row.cRCF=cData[y].rcf; }
      out.push(row);
    }
    return out;
  }

  var chartData = asr ? mergeData(prevSeg, corrSeg) : [];
  var _baseLim = LIMITS[context]||{v:9,l:11};
  var limV = (props.params&&props.params.customLimV!=null)?props.params.customLimV:_baseLim.v;
  var limL = (props.params&&props.params.customLimL!=null)?props.params.customLimL:_baseLim.l;
  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,padding:"12px 16px",background:"rgba(0,0,0,0.2)",borderRadius:10,border:"1px solid rgba(125,211,200,0.1)"}}>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:"#e8f4f3"}}>Strategy Comparison: Preventive vs Corrective</div>
          <div style={{fontSize:11,color:cl.dim,marginTop:3}}>
            Always computes both strategies with your exact project parameters.
            {hasComparison && <span style={{color:cl.teal}}> Comparison ready.</span>}
          </div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          {isStale && (
            <div style={{fontSize:11,color:cl.amber,padding:"5px 10px",background:"rgba(251,191,36,0.1)",borderRadius:6,border:"1px solid rgba(251,191,36,0.3)"}}>
              Parameters changed - re-run comparison
            </div>
          )}
          <Btn onClick={runComparison} active={true} sm={false}>
            {running ? "Computing..." : (hasComparison ? "Re-run Comparison" : "Run Comparison")}
          </Btn>
        </div>
      </div>

      {!hasComparison && (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:300,color:"#4a6a74",textAlign:"center",gap:14,border:"1px dashed rgba(125,211,200,0.12)",borderRadius:12}}>
          <div style={{fontSize:32}}>vs</div>
          <div style={{fontSize:14,fontWeight:600,color:cl.dim}}>Click "Run Comparison" to compute both strategies</div>
          <div style={{fontSize:12,color:"#4a6a74",maxWidth:420}}>Both Preventive and Corrective will be simulated with your exact parameters: trains, segments, rail type, speed, lubrication, and brownfield conditions.</div>
        </div>
      )}

      {hasComparison && (
        <div>
          {/* KPI view toggle */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:11,color:cl.dim}}>
              {kpiView==="first"
                ? "Showing first cycle values (to first replacement)"
                : "Showing full "+horizon+"-year horizon values (all cycles)"}
            </div>
            <div style={{display:"flex",gap:0,border:"1px solid rgba(125,211,200,0.25)",borderRadius:6,overflow:"hidden"}}>
              <div onClick={function(){setKpiView("first");}}
                style={{padding:"5px 14px",fontSize:11,fontWeight:600,cursor:"pointer",
                  background:kpiView==="first"?cl.teal:"transparent",
                  color:kpiView==="first"?"#0d1f26":cl.dim}}>
                First cycle
              </div>
              <div onClick={function(){setKpiView("full");}}
                style={{padding:"5px 14px",fontSize:11,fontWeight:600,cursor:"pointer",
                  background:kpiView==="full"?cl.teal:"transparent",
                  color:kpiView==="full"?"#0d1f26":cl.dim,
                  borderLeft:"1px solid rgba(125,211,200,0.25)"}}>
                Full {horizon}-year horizon
              </div>
            </div>
          </div>

          {/* KPI cards */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:16}}>
            {(function(){
              var fhReplsP = fullHorizonData.reduce(function(a,r){return a+r.pRepls;},0);
              var fhReplsC = fullHorizonData.reduce(function(a,r){return a+r.cRepls;},0);
              var fhPassP  = fullHorizonData.reduce(function(a,r){return a+r.pPass;},0);
              var fhPassC  = fullHorizonData.reduce(function(a,r){return a+r.cPass;},0);
              var fhGrindP = fullHorizonData.reduce(function(a,r){return a+r.pGrind;},0);
              var fhGrindC = fullHorizonData.reduce(function(a,r){return a+r.cGrind;},0);
              var fhReprP  = fullHorizonData.reduce(function(a,r){return a+(r.pReprCost||0);},0);
              var fhReprC  = fullHorizonData.reduce(function(a,r){return a+(r.cReprCost||0);},0);
              var isFirst  = kpiView==="first";
              var items = [
                ["Replacements",
                  isFirst?(prevRepls+" segments"):(fhReplsP+" replacements"),
                  isFirst?(corrRepls+" segments"):(fhReplsC+" replacements"),
                  isFirst?(prevRepls<=corrRepls?"preventive":"corrective"):(fhReplsP<=fhReplsC?"preventive":"corrective")],
                ["Total grindings",
                  isFirst?(prevResult.results.reduce(function(a,r){return a+r.gCount;},0)+" passes"):(fhPassP+" passes"),
                  isFirst?(corrResult.results.reduce(function(a,r){return a+r.gCount;},0)+" passes"):(fhPassC+" passes"),
                  "preventive"],
                ["Grind cost",
                  isFirst?fmt(segData.reduce(function(a,s){return a+s.pGrindCost;},0)):fmt(fhGrindP),
                  isFirst?fmt(segData.reduce(function(a,s){return a+s.cGrindCost;},0)):fmt(fhGrindC),
                  "corrective"],
                ["Lifecycle cost",
                  isFirst?fmt(totalPrev):fmt(fhTotalPrev),
                  isFirst?fmt(totalCorr):fmt(fhTotalCorr),
                  isFirst?(totalPrev<=totalCorr?"preventive":"corrective"):(fhTotalPrev<=fhTotalCorr?"preventive":"corrective")],
              ].concat(props.reprActive?[["Reprofiling cost",
                isFirst?fmt(segData.reduce(function(a,s){return a+(s.pReprCost||0);},0)):fmt(fhReprP),
                isFirst?fmt(segData.reduce(function(a,s){return a+(s.cReprCost||0);},0)):fmt(fhReprC),
                "corrective"]]:[]);
              return items.map(function(item,i){
                var winner=item[3];
                return (
                  <div key={i} style={{background:"rgba(0,0,0,0.2)",borderRadius:10,padding:"12px 14px",border:"1px solid rgba(255,255,255,0.06)"}}>
                    <div style={{fontSize:10,color:cl.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{item[0]}</div>
                    <div style={{display:"flex",gap:8}}>
                      <div style={{flex:1,padding:"6px 10px",borderRadius:6,background:winner==="preventive"?"rgba(125,211,200,0.12)":"rgba(255,255,255,0.03)",border:"1px solid "+(winner==="preventive"?"rgba(125,211,200,0.3)":"rgba(255,255,255,0.06)")}}>
                        <div style={{fontSize:9,color:cl.teal,fontWeight:700,textTransform:"uppercase",marginBottom:3}}>Preventive</div>
                        <div style={{fontSize:13,fontWeight:700,color:cl.teal,fontFamily:"monospace"}}>{item[1]}</div>
                      </div>
                      <div style={{flex:1,padding:"6px 10px",borderRadius:6,background:winner==="corrective"?"rgba(251,191,36,0.12)":"rgba(255,255,255,0.03)",border:"1px solid "+(winner==="corrective"?"rgba(251,191,36,0.3)":"rgba(255,255,255,0.06)")}}>
                        <div style={{fontSize:9,color:cl.amber,fontWeight:700,textTransform:"uppercase",marginBottom:3}}>Corrective</div>
                        <div style={{fontSize:13,fontWeight:700,color:cl.amber,fontFamily:"monospace"}}>{item[2]}</div>
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          {/* Saving banner */}
          <div style={{marginBottom:16,borderRadius:10,overflow:"hidden",border:"1px solid "+(totalSaving>0||fhTotalSaving>0?"rgba(125,211,200,0.25)":"rgba(248,113,113,0.25)")}}>
            {/* Banner title */}
            <div style={{padding:"10px 18px",background:totalSaving>0||fhTotalSaving>0?"rgba(125,211,200,0.08)":"rgba(248,113,113,0.08)"}}>
              <div style={{fontSize:12,fontWeight:700,color:totalSaving>0?cl.teal:cl.warn}}>
                {totalSaving>0&&fhTotalSaving>0?"Preventive strategy is cheaper  - both on first cycle and over the full "+horizon+"-year horizon":
                 totalSaving<=0&&fhTotalSaving<=0?"Corrective strategy is cheaper  - both on first cycle and over the full "+horizon+"-year horizon":
                 totalSaving>0?"Preventive cheaper on first cycle  - check full horizon":
                 "Corrective cheaper on first cycle  - check full horizon"}
              </div>
              <div style={{fontSize:11,color:cl.dim,marginTop:3}}>
                Grinding: {gcp.perMl.toFixed(0)} {sym}/ml/pass op.{gcp.mobilCostPerInt>0?" + "+Math.round(gcp.mobilCostPerInt)+" EUR mobil/"+(gcp.mobilPerInt?"pass":"horizon"):""}
                {" | "}Replacement: {replRate.toFixed(0)} {sym}/ml
              </div>
            </div>
            {/* Two columns */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr"}}>
              {/* First cycle */}
              <div style={{padding:"14px 18px",borderRight:"1px solid rgba(255,255,255,0.08)",background:"rgba(0,0,0,0.1)"}}>
                <div style={{fontSize:10,color:cl.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>First cycle only</div>
                <div style={{fontSize:26,fontWeight:800,color:totalSaving>0?cl.teal:cl.warn,fontFamily:"monospace",marginBottom:4}}>{fmtDelta(totalSaving)}</div>
                <div style={{fontSize:11,color:cl.dim}}>
                  {totalSaving>0?"Preventive saves on first rail cycle":"Corrective saves on first rail cycle"}
                </div>
                <div style={{marginTop:8,display:"flex",gap:14,fontSize:11}}>
                  <span style={{color:cl.teal}}>PREV: <b>{fmt(totalPrev)}</b></span>
                  <span style={{color:cl.amber}}>CORR: <b>{fmt(totalCorr)}</b></span>
                </div>
              </div>
              {/* Full horizon */}
              <div style={{padding:"14px 18px",background:"rgba(0,0,0,0.15)"}}>
                <div style={{fontSize:10,color:cl.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Full {horizon}-year horizon</div>
                <div style={{fontSize:26,fontWeight:800,color:fhTotalSaving>0?cl.teal:cl.warn,fontFamily:"monospace",marginBottom:4}}>{fmtDelta(fhTotalSaving)}</div>
                <div style={{fontSize:11,color:cl.dim}}>
                  {fhTotalSaving>0?"Preventive saves over full contract":"Corrective saves over full contract"}
                </div>
                <div style={{marginTop:8,display:"flex",gap:14,fontSize:11}}>
                  <span style={{color:cl.teal}}>PREV: <b>{fmt(fhTotalPrev)}</b> ({fhTotalReplsP} repls)</span>
                  <span style={{color:cl.amber}}>CORR: <b>{fmt(fhTotalCorr)}</b> ({fhTotalReplsC} repls)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Segment selector */}
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            {segData.map(function(s,i){return(
              <Btn key={i} onClick={function(){setAi(i);}} active={aidx===i} sm={true}>{s.seg.label}</Btn>
            );})}
          </div>

          {/* Chart tabs */}
          <div style={{display:"flex",gap:6,marginBottom:12}}>
            {[["wear","Wear V and L"],["rcf","RCF Index"],["cost","Lifecycle Cost"]].map(function(item){
              return <Btn key={item[0]} onClick={function(){setChTab(item[0]);}} active={chartTab===item[0]} sm={true}>{item[1]}</Btn>;
            })}
          </div>

          <div style={{background:"rgba(0,0,0,0.2)",borderRadius:12,padding:18,border:"1px solid rgba(125,211,200,0.1)",marginBottom:16}}>

            {chartTab==="wear" && asr && (
              <div>
                <div style={{fontSize:12,color:cl.dim,marginBottom:10,display:"flex",gap:16,flexWrap:"wrap"}}>
                  <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:20,height:3,background:cl.teal,display:"inline-block"}}/> Preventive V</span>
                  <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:20,height:3,background:cl.amber,display:"inline-block"}}/> Corrective V</span>
                  <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:20,height:2,background:cl.teal,display:"inline-block",borderTop:"2px dashed "+cl.teal}}/> Preventive L</span>
                  <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:20,height:2,background:cl.amber,display:"inline-block",borderTop:"2px dashed "+cl.amber}}/> Corrective L</span>
                  <span style={{color:"#4a6a74"}}>V limit: <b style={{color:cl.warn}}>{limV}mm</b> | L limit: <b style={{color:cl.warn}}>{limL}mm</b></span>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="gpV" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={cl.teal}  stopOpacity={0.22}/><stop offset="95%" stopColor={cl.teal}  stopOpacity={0}/></linearGradient>
                      <linearGradient id="gcV" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={cl.amber} stopOpacity={0.22}/><stop offset="95%" stopColor={cl.amber} stopOpacity={0}/></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                    <XAxis dataKey="year" stroke="#4a6a74" tick={{fontSize:11}}/>
                    <YAxis stroke="#4a6a74" tick={{fontSize:11}} unit=" mm"/>
                    <Tooltip content={<Tip/>}/><Legend wrapperStyle={{fontSize:11}}/>
                    <ReferenceLine y={limV} stroke={cl.warn} strokeDasharray="4 3" label={{value:"V lim "+limV+"mm",fill:cl.warn,fontSize:9}}/>
                    <ReferenceLine y={limL} stroke={cl.warn} strokeDasharray="4 3" label={{value:"L lim "+limL+"mm",fill:cl.warn,fontSize:9}}/>
                    <Area type="monotone" dataKey="pV" name="Preventive V (mm)" stroke={cl.teal}  fill="url(#gpV)" strokeWidth={2}   dot={false} connectNulls={true}/>
                    <Area type="monotone" dataKey="cV" name="Corrective V (mm)" stroke={cl.amber} fill="url(#gcV)" strokeWidth={2}   dot={false} connectNulls={true}/>
                    <Area type="monotone" dataKey="pL" name="Preventive L (mm)" stroke={cl.teal}  fill="none"      strokeWidth={1.5} dot={false} strokeDasharray="6 3" connectNulls={true}/>
                    <Area type="monotone" dataKey="cL" name="Corrective L (mm)" stroke={cl.amber} fill="none"      strokeWidth={1.5} dot={false} strokeDasharray="6 3" connectNulls={true}/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {chartTab==="rcf" && asr && (
              <div>
                <div style={{fontSize:12,color:cl.dim,marginBottom:12}}>RCF Index - <b style={{color:cl.teal}}>Preventive</b> vs <b style={{color:cl.amber}}>Corrective</b> - Limit: 0.70</div>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="gpR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={cl.teal}  stopOpacity={0.2}/><stop offset="95%" stopColor={cl.teal}  stopOpacity={0}/></linearGradient>
                      <linearGradient id="gcR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={cl.amber} stopOpacity={0.2}/><stop offset="95%" stopColor={cl.amber} stopOpacity={0}/></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                    <XAxis dataKey="year" stroke="#4a6a74" tick={{fontSize:11}}/>
                    <YAxis stroke="#4a6a74" tick={{fontSize:11}} domain={[0,1]}/>
                    <Tooltip content={<Tip/>}/><Legend wrapperStyle={{fontSize:12}}/>
                    <ReferenceLine y={0.3} stroke={cl.green} strokeDasharray="4 4" label={{value:"Preventive OK",fill:cl.green,fontSize:10}}/>
                    <ReferenceLine y={0.7} stroke={cl.warn}  strokeDasharray="4 4" label={{value:"Replacement", fill:cl.warn, fontSize:10}}/>
                    <Area type="monotone" dataKey="pRCF" name="Preventive RCF" stroke={cl.teal}  fill="url(#gpR)" strokeWidth={2}   dot={false} connectNulls={true}/>
                    <Area type="monotone" dataKey="cRCF" name="Corrective RCF"  stroke={cl.amber} fill="url(#gcR)" strokeWidth={2}   dot={false} strokeDasharray="6 3" connectNulls={true}/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {chartTab==="cost" && (
              <div>
                <div style={{fontSize:12,color:cl.dim,marginBottom:14}}>Lifecycle cost breakdown - grinding: {gcp.perMl.toFixed(0)} {sym}/ml/pass{gcp.mobilCostPerInt>0?" + "+Math.round(gcp.mobilCostPerInt)+" EUR mobil/"+(gcp.mobilPerInt?"pass":"horizon"):""} | replacement: {replRate.toFixed(0)} {sym}/ml</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr style={{background:"rgba(255,255,255,0.03)"}}>
                        {["Segment","Repl.yr PREV","Repl.yr CORR","Delta yr","Passes PREV","Passes CORR","Grind PREV","Grind CORR","Repl PREV","Repl CORR","Repr PREV","Repr CORR","Total PREV","Total CORR","Saving"].map(function(h){
                          return <th key={h} style={{padding:"7px 10px",textAlign:"left",color:cl.dim,fontWeight:600,whiteSpace:"nowrap",fontSize:10}}>{h}</th>;
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {segData.map(function(s,i){
                        var deltaYr = (s.cRepl||(horizon+1)) - (s.pRepl||(horizon+1));
                        var savCol  = s.saving>0?cl.teal:s.saving<0?cl.warn:cl.dim;
                        return(
                          <tr key={i} onClick={function(){setAi(i);setChTab("wear");}} style={{borderTop:"1px solid rgba(255,255,255,0.04)",cursor:"pointer",background:aidx===i?"rgba(125,211,200,0.04)":"transparent"}}>
                            <td style={{padding:"7px 10px",color:"#e8f4f3",fontWeight:500,whiteSpace:"nowrap"}}>{s.seg.label}</td>
                            <td style={{padding:"7px 10px",fontFamily:"monospace",color:cl.teal}}>{s.pRepl?"Yr "+s.pRepl:"> "+horizon+"yr"}</td>
                            <td style={{padding:"7px 10px",fontFamily:"monospace",color:cl.amber}}>{s.cRepl?"Yr "+s.cRepl:"> "+horizon+"yr"}</td>
                            <td style={{padding:"7px 10px",fontFamily:"monospace",color:deltaYr>0?cl.teal:deltaYr<0?cl.warn:cl.dim,fontWeight:700}}>{deltaYr>0?"+":""}{deltaYr!==0?deltaYr+"yr":"="}</td>
                            <td style={{padding:"7px 10px",fontFamily:"monospace",color:cl.teal}}>{s.pPasses}</td>
                            <td style={{padding:"7px 10px",fontFamily:"monospace",color:cl.amber}}>{s.cPasses}</td>
                            <td style={{padding:"7px 10px",fontFamily:"monospace"}}>{fmt(s.pGrindCost)}</td>
                            <td style={{padding:"7px 10px",fontFamily:"monospace"}}>{fmt(s.cGrindCost)}</td>
                            <td style={{padding:"7px 10px",fontFamily:"monospace"}}>{s.pReplCost>0?fmt(s.pReplCost):"-"}</td>
                            <td style={{padding:"7px 10px",fontFamily:"monospace"}}>{s.cReplCost>0?fmt(s.cReplCost):"-"}</td>
                            {props.reprActive&&<td style={{padding:"7px 10px",fontFamily:"monospace",color:(s.pReprCost||0)>0?cl.teal:cl.dim}}>{(s.pReprCost||0)>0?fmt(s.pReprCost):"-"}</td>}
                            {props.reprActive&&<td style={{padding:"7px 10px",fontFamily:"monospace",color:(s.cReprCost||0)>0?cl.amber:cl.dim}}>{(s.cReprCost||0)>0?fmt(s.cReprCost):"-"}</td>}
                            <td style={{padding:"7px 10px",fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{fmt(s.pTotal)}</td>
                            <td style={{padding:"7px 10px",fontFamily:"monospace",color:cl.amber,fontWeight:700}}>{fmt(s.cTotal)}</td>
                            <td style={{padding:"7px 10px",fontFamily:"monospace",color:savCol,fontWeight:700}}>{fmtDelta(s.saving)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{borderTop:"2px solid rgba(125,211,200,0.2)",background:"rgba(125,211,200,0.04)"}}>
                        <td colSpan={10} style={{padding:"9px 10px",color:cl.teal,fontWeight:700,fontSize:12}}>TOTAL (first cycle)</td>
                        {props.reprActive&&<td style={{padding:"9px 10px",fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{fmt(segData.reduce(function(a,s){return a+(s.pReprCost||0);},0))}</td>}
                        {props.reprActive&&<td style={{padding:"9px 10px",fontFamily:"monospace",color:cl.amber,fontWeight:700}}>{fmt(segData.reduce(function(a,s){return a+(s.cReprCost||0);},0))}</td>}
                        <td style={{padding:"9px 10px",fontFamily:"monospace",color:cl.teal,fontWeight:800}}>{fmt(totalPrev)}</td>
                        <td style={{padding:"9px 10px",fontFamily:"monospace",color:cl.amber,fontWeight:800}}>{fmt(totalCorr)}</td>
                        <td style={{padding:"9px 10px",fontFamily:"monospace",color:totalSaving>0?cl.teal:cl.warn,fontWeight:800,fontSize:14}}>{fmtDelta(totalSaving)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* FULL HORIZON TABLE */}
                {(function(){
                  // Compute full horizon for each segment by repeating cycles from greenfield
                  var fullRows = segData.map(function(s) {
                    var lenMl = (s.seg.lengthKm||0)*1000;

                    function computeFullHorizon(firstRepY, firstPasses, firstGrindCost, firstReplCost, firstReprCost) {
                      var firstReprCostV = firstReprCost||0;
                      if(!firstRepY) {
                        return {repls:0, passes:firstPasses, grindCost:firstGrindCost, replCost:0, reprCost:firstReprCostV, total:firstGrindCost+firstReprCostV};
                      }
                      var cycleLen    = firstRepY;
                      var cycleGrind  = firstGrindCost;
                      var cyclePasses = firstPasses;
                      var cycleRepl   = firstReplCost;
                      var cycleRepr   = firstReprCostV;
                      var totalRepls  = 0, totalPass = 0, totalGrind = 0, totalRepl = 0, totalRepr = 0;
                      var yr          = 0;
                      while(yr + cycleLen <= horizon) {
                        yr += cycleLen;
                        totalRepls += 1;
                        totalPass  += cyclePasses;
                        totalGrind += cycleGrind;
                        totalRepl  += cycleRepl;
                        totalRepr  += cycleRepr;
                      }
                      var remaining = horizon - yr;
                      if(remaining > 0 && cycleLen > 0) {
                        var frac = remaining / cycleLen;
                        totalPass  += Math.round(cyclePasses * frac);
                        totalGrind += cycleGrind * frac;
                        totalRepr  += cycleRepr  * frac;
                      }
                      return {repls:totalRepls, passes:totalPass, grindCost:totalGrind, replCost:totalRepl, reprCost:totalRepr, total:totalGrind+totalRepl+totalRepr};
                    }

                    var ph = computeFullHorizon(s.pRepl, s.pPasses, s.pGrindCost, s.pReplCost, s.pReprCost);
                    var ch = computeFullHorizon(s.cRepl, s.cPasses, s.cGrindCost, s.cReplCost, s.cReprCost);
                    return {
                      seg:    s.seg,
                      pRepls: ph.repls,     cRepls: ch.repls,
                      pPass:  ph.passes,    cPass:  ch.passes,
                      pGrind: ph.grindCost, cGrind: ch.grindCost,
                      pRepl:  ph.replCost,  cRepl:  ch.replCost,
                      pRepr:  ph.reprCost,  cRepr:  ch.reprCost,
                      pTotal: ph.total,     cTotal: ch.total,
                      saving: ch.total - ph.total,
                    };
                  });

                  var fTotPGrind  = fullRows.reduce(function(a,r){return a+r.pGrind;},0);
                  var fTotCGrind  = fullRows.reduce(function(a,r){return a+r.cGrind;},0);
                  var fTotPRepl   = fullRows.reduce(function(a,r){return a+r.pRepl;},0);
                  var fTotCRepl   = fullRows.reduce(function(a,r){return a+r.cRepl;},0);
                  var fTotP       = fullRows.reduce(function(a,r){return a+r.pTotal;},0);
                  var fTotC       = fullRows.reduce(function(a,r){return a+r.cTotal;},0);
                  var fSaving     = fTotC - fTotP;

                  return (
                    <div style={{marginTop:20}}>
                      <div style={{fontSize:11,letterSpacing:2,color:cl.teal,fontWeight:700,textTransform:"uppercase",marginBottom:10}}>
                        Full Horizon Lifecycle ({horizon} years) - Greenfield at each replacement
                      </div>

                      {/* KPI summary row */}
                      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:14}}>
                        {[
                          ["Total replacements", fullRows.reduce(function(a,r){return a+r.pRepls;},0)+" PREV", fullRows.reduce(function(a,r){return a+r.cRepls;},0)+" CORR", cl.teal],
                          ["Total grind passes",  fullRows.reduce(function(a,r){return a+r.pPass;},0)+" PREV",  fullRows.reduce(function(a,r){return a+r.cPass;},0)+" CORR",  cl.teal],
                          ["Total grind cost",    fmt(fTotPGrind)+" PREV", fmt(fTotCGrind)+" CORR", cl.teal],
                          ["Total repl. cost",    fmt(fTotPRepl)+" PREV",  fmt(fTotCRepl)+" CORR",  cl.amber],
                          ["Lifecycle saving",    fSaving>0?"PREV cheaper":"CORR cheaper", fmtDelta(fSaving), fSaving>0?cl.teal:cl.warn],
                        ].map(function(item,i){return(
                          <div key={i} style={{background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"10px 12px",border:"1px solid rgba(255,255,255,0.06)"}}>
                            <div style={{fontSize:9,color:cl.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>{item[0]}</div>
                            {i<4?(
                              <div>
                                <div style={{fontSize:11,color:cl.teal,fontFamily:"monospace",marginBottom:2}}>{item[1]}</div>
                                <div style={{fontSize:11,color:cl.amber,fontFamily:"monospace"}}>{item[2]}</div>
                              </div>
                            ):(
                              <div>
                                <div style={{fontSize:11,color:item[3],fontFamily:"monospace",marginBottom:2}}>{item[1]}</div>
                                <div style={{fontSize:14,fontWeight:800,color:item[3],fontFamily:"monospace"}}>{item[2]}</div>
                              </div>
                            )}
                          </div>
                        );})}
                      </div>

                      <div style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead>
                            <tr style={{background:"rgba(0,0,0,0.3)"}}>
                              {["Segment","Repls PREV","Repls CORR","Passes PREV","Passes CORR","Grind PREV","Grind CORR","Repl PREV","Repl CORR","Repr PREV","Repr CORR","Total PREV","Total CORR","Saving "+horizon+"yr"].map(function(h){
                                return <th key={h} style={{padding:"7px 10px",textAlign:"left",color:cl.teal,fontWeight:600,whiteSpace:"nowrap",fontSize:10}}>{h}</th>;
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {fullRows.map(function(r,i){
                              var savCol = r.saving>0?cl.teal:r.saving<0?cl.warn:cl.dim;
                              return(
                                <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.04)",background:i%2===0?"rgba(125,211,200,0.02)":"transparent"}}>
                                  <td style={{padding:"7px 10px",color:"#e8f4f3",fontWeight:500,whiteSpace:"nowrap"}}>{r.seg.label}</td>
                                  <td style={{padding:"7px 10px",fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{r.pRepls}</td>
                                  <td style={{padding:"7px 10px",fontFamily:"monospace",color:cl.amber,fontWeight:700}}>{r.cRepls}</td>
                                  <td style={{padding:"7px 10px",fontFamily:"monospace",color:cl.teal}}>{r.pPass}</td>
                                  <td style={{padding:"7px 10px",fontFamily:"monospace",color:cl.amber}}>{r.cPass}</td>
                                  <td style={{padding:"7px 10px",fontFamily:"monospace"}}>{fmt(r.pGrind)}</td>
                                  <td style={{padding:"7px 10px",fontFamily:"monospace"}}>{fmt(r.cGrind)}</td>
                                  <td style={{padding:"7px 10px",fontFamily:"monospace"}}>{r.pRepl>0?fmt(r.pRepl):"-"}</td>
                                  <td style={{padding:"7px 10px",fontFamily:"monospace"}}>{r.cRepl>0?fmt(r.cRepl):"-"}</td>
                                  {props.reprActive&&<td style={{padding:"7px 10px",fontFamily:"monospace",color:(r.pRepr||0)>0?cl.teal:cl.dim}}>{(r.pRepr||0)>0?fmt(r.pRepr):"-"}</td>}
                                  {props.reprActive&&<td style={{padding:"7px 10px",fontFamily:"monospace",color:(r.cRepr||0)>0?cl.amber:cl.dim}}>{(r.cRepr||0)>0?fmt(r.cRepr):"-"}</td>}
                                  <td style={{padding:"7px 10px",fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{fmt(r.pTotal)}</td>
                                  <td style={{padding:"7px 10px",fontFamily:"monospace",color:cl.amber,fontWeight:700}}>{fmt(r.cTotal)}</td>
                                  <td style={{padding:"7px 10px",fontFamily:"monospace",color:savCol,fontWeight:800}}>{fmtDelta(r.saving)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{borderTop:"2px solid rgba(125,211,200,0.25)",background:"rgba(125,211,200,0.06)"}}>
                              <td colSpan={9} style={{padding:"9px 10px",color:cl.teal,fontWeight:700,fontSize:12}}>TOTAL {horizon} YEARS</td>
                              {props.reprActive&&<td style={{padding:"9px 10px",fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{fmt(fullRows.reduce(function(a,r){return a+(r.pRepr||0);},0))}</td>}
                              {props.reprActive&&<td style={{padding:"9px 10px",fontFamily:"monospace",color:cl.amber,fontWeight:700}}>{fmt(fullRows.reduce(function(a,r){return a+(r.cRepr||0);},0))}</td>}
                              <td style={{padding:"9px 10px",fontFamily:"monospace",color:cl.teal,fontWeight:800,fontSize:13}}>{fmt(fTotP)}</td>
                              <td style={{padding:"9px 10px",fontFamily:"monospace",color:cl.amber,fontWeight:800,fontSize:13}}>{fmt(fTotC)}</td>
                              <td style={{padding:"9px 10px",fontFamily:"monospace",color:fSaving>0?cl.teal:cl.warn,fontWeight:800,fontSize:15}}>{fmtDelta(fSaving)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      <div style={{marginTop:8,fontSize:11,color:"#4a6a74",lineHeight:1.6}}>
                        Assumption: each replacement starts from new rail (greenfield). Cycle length = year of first replacement. Partial final cycle: grinding costs prorated, no replacement charged if horizon ends before next replacement year.
                      </div>
                    </div>
                  );
                })()}

                <div style={{marginTop:10,fontSize:11,color:"#4a6a74"}}>
                  Rates from your Grinding Cost tab configuration: {gcp.perMl.toFixed(0)} {sym}/ml/pass operation{gcp.mobilCostPerInt>0?", "+Math.round(gcp.mobilCostPerInt)+" EUR mobilisation "+(gcp.mobilPerInt?"per intervention":"once per horizon"):""}. Replacement: {replRate.toFixed(0)} {sym}/ml from Replacement Cost tab.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function ReprofilingCostPanel(props) {
  var simResult = props.simResult;
  var horizon   = props.horizon;
  var context   = props.context;
  var cl2=cl;
  var currencies = props.currencyMap || CURRENCIES;
  var currencyOpts = props.currencyOptions || Object.keys(currencies).map(function(k){return {v:k,l:currencies[k].label};});

  // Reprofiling uses same machine family as grinding but deeper operation rates
  // Presets: subcontract ~65 EUR/ml, own fleet calculated from machine rates x deeper factor
  var REPR_SUB_RATES = {
    small: {opPerMl:{WEU:45,EEU:32,MENA:28,SSA:22,SEA:25,LATAM:30}, mobilFix:{WEU:5000,EEU:3500,MENA:3000,SSA:2500,SEA:2800,LATAM:3200}, mobilPerKm:{WEU:3.5,EEU:2.5,MENA:2.2,SSA:1.8,SEA:2.0,LATAM:2.5}},
    line:  {opPerMl:{WEU:65,EEU:48,MENA:42,SSA:32,SEA:38,LATAM:45}, mobilFix:{WEU:9000,EEU:6500,MENA:5500,SSA:4500,SEA:5000,LATAM:6000}, mobilPerKm:{WEU:5.0,EEU:3.8,MENA:3.2,SSA:2.5,SEA:3.0,LATAM:3.8}},
    speno: {opPerMl:{WEU:90,EEU:68,MENA:58,SSA:46,SEA:52,LATAM:62}, mobilFix:{WEU:14000,EEU:10000,MENA:8500,SSA:7000,SEA:8000,LATAM:9500}, mobilPerKm:{WEU:6.5,EEU:5.0,MENA:4.2,SSA:3.5,SEA:4.0,LATAM:5.0}},
  };

  const [machineKey, setMachine] = useState(props.initMachine || "line");
  const [mode,       setMode]    = useState("sub");
  const [region,     setRegion]  = useState(props.initRegion || "WEU");
  const [currency,   setCurrency]= useState(props.initCurrency || "EUR");
  const [distKm,     setDist]    = useState(80);
  const [mobilPerInt,setMobil]   = useState(true);
  const [showRates,  setShowR]   = useState(false);
  // Custom rate overrides
  const [cOpPerMl,   setCOp]  = useState(null);
  const [cMobilFix,  setCMF]  = useState(null);
  const [cMobilKm,   setCMK]  = useState(null);

  var sym = (currencies[currency]||currencies.EUR||CURRENCIES.EUR).symbol;
  var fx  = (currencies[currency]||currencies.EUR||CURRENCIES.EUR).rate;
  var machine = GRIND_MACHINES[machineKey] || GRIND_MACHINES.line;
  var subRates = REPR_SUB_RATES[machineKey] || REPR_SUB_RATES.line;
  var opEur  = cOpPerMl  !== null ? cOpPerMl  : (subRates.opPerMl[region]  || subRates.opPerMl.WEU);
  var mfEur  = cMobilFix !== null ? cMobilFix : (subRates.mobilFix[region] || subRates.mobilFix.WEU);
  var mkEur  = cMobilKm  !== null ? cMobilKm  : (subRates.mobilPerKm[region]||subRates.mobilPerKm.WEU);
  var opLocal  = opEur * fx;
  var mfLocal  = mfEur * fx;
  var mkLocal  = mkEur * fx;
  var mobilCostPerInt = mfLocal + mkLocal * distKm;

  // Compute per-segment reprofiling cost
  var reprRows = simResult ? simResult.results.filter(function(r){return r.reprCount&&r.reprCount>0;}).map(function(r){
    var lenMl = (r.seg.lengthKm||0)*1000;
    var reprCount = r.reprCount||0;
    var opCost = lenMl * opLocal;
    var mobCost = mobilPerInt ? mobilCostPerInt * reprCount : mobilCostPerInt;
    var costPerInt = opCost + (mobilPerInt ? mobilCostPerInt : 0);
    var totalCost = opCost * reprCount + mobCost;
    return {seg:r.seg, reprCount:reprCount, lenKm:r.seg.lengthKm||0, opCost:opCost, costPerInt:costPerInt, totalCost:totalCost};
  }) : [];
  var grandTotal = reprRows.reduce(function(a,r){return a+r.totalCost;},0);
  var totalReprs = reprRows.reduce(function(a,r){return a+r.reprCount;},0);
  var grandTotalMl = reprRows.reduce(function(a,r){return a+r.lenKm;},0)*1000;

  function fmt(v){return v>=1e6?(v/1e6).toFixed(2)+"M "+sym:v>=1e3?(v/1e3).toFixed(1)+"k "+sym:v.toFixed(0)+" "+sym;}

  var machineOpts = Object.keys(GRIND_MACHINES).map(function(k){return {v:k,l:GRIND_MACHINES[k].label};});
  var regionOpts  = Object.keys(REGIONS).filter(function(k){return k!=="CUSTOM";}).map(function(k){return {v:k,l:REGIONS[k].label};});

  return (
    <div style={{display:"grid",gridTemplateColumns:"280px 1fr",gap:16}}>
      <div style={{overflowY:"auto",maxHeight:660,paddingRight:8}}>
        <div style={{marginBottom:12}}>
          <Lbl>Machine type</Lbl>
          <Sel value={machineKey} onChange={function(v){setMachine(v);setCOp(null);setCMF(null);setCMK(null);}} opts={machineOpts}/>
          <div style={{fontSize:10,color:cl2.dim,marginTop:4,lineHeight:1.5}}>Same machine family as grinding. Reprofiling uses deeper passes (6-12 passes vs 1-4).</div>
        </div>
        <div style={{marginBottom:12}}>
          <Lbl>Region / Country preset</Lbl>
          <Sel value={region} onChange={function(v){setRegion(v);setCOp(null);setCMF(null);setCMK(null);}} opts={regionOpts}/>
        </div>
        <div style={{marginBottom:12}}>
          <Lbl>Display currency</Lbl>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <Sel value={currency} onChange={function(v){setCurrency(v);if(props.onCurrencyChange)props.onCurrencyChange(v);}} opts={currencyOpts}/>
            <div onClick={function(){if(props.onShowRates)props.onShowRates();}} style={{fontSize:10,cursor:"pointer",padding:"3px 8px",borderRadius:4,border:"1px solid rgba(125,211,200,0.3)",color:cl2.teal,whiteSpace:"nowrap"}}>{props.ratesStatus==="live"?"Live rates":"Edit rates"}</div>
          </div>
        </div>
        <div style={{marginBottom:12}}>
          <Lbl>Operating mode</Lbl>
          <div style={{display:"flex",gap:6}}><Btn onClick={function(){setMode("sub");}} active={mode==="sub"} sm={true}>Subcontract</Btn></div>
          <div style={{fontSize:10,color:cl2.dim,marginTop:4}}>Own fleet reprofiling is modelled as subcontract rates (specialist operation). Adjust rates below to reflect your actual costs.</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          <div><Lbl>Distance from depot (km)</Lbl><Inp value={distKm} onChange={function(v){setDist(+v);}} min={0} max={500} step={10}/></div>
        </div>
        <div style={{marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <div style={{fontSize:11,color:cl2.dim,fontWeight:600}}>Mobilisation per intervention</div>
            <div onClick={function(){setMobil(function(v){return !v;});}} style={{width:26,height:15,borderRadius:8,background:mobilPerInt?cl2.teal:"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",border:"1px solid rgba(255,255,255,0.2)"}}>
              <div style={{width:9,height:9,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:mobilPerInt?13:2}}/>
            </div>
            <span style={{fontSize:10,color:mobilPerInt?cl2.teal:cl2.dim}}>{mobilPerInt?"per intervention":"once total"}</span>
          </div>
        </div>
        <div style={{borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:10,marginTop:4}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:11,color:cl2.dim,fontWeight:600}}>Reprofiling unit rates</div>
            <div onClick={function(){setShowR(function(v){
              var next=!v;
              if(next){if(cOpPerMl===null)setCOp(opEur);if(cMobilFix===null)setCMF(mfEur);if(cMobilKm===null)setCMK(mkEur);}
              return next;
            });}} style={{fontSize:10,color:cl2.dim,cursor:"pointer",padding:"2px 8px",background:"rgba(255,255,255,0.04)",borderRadius:4}}>
              {showRates?"collapse":"edit rates"}
            </div>
          </div>
          <div style={{fontSize:11,color:cl2.dim,marginBottom:4}}>
            Operation: <b style={{color:cl2.teal,fontFamily:"monospace"}}>{(opLocal).toFixed(0)} {sym}/ml</b>
            {" | "}Mobilisation: <b style={{color:cl2.teal,fontFamily:"monospace"}}>{fmt(mobilCostPerInt)}</b>
          </div>
          {showRates&&(
            <div style={{display:"grid",gap:6}}>
              <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6}}>
                <span style={{fontSize:11,color:cl2.dim}}>Operation rate</span>
                <input type="number" value={cOpPerMl!==null?cOpPerMl:opEur} min={0} step={1}
                  onChange={function(e){setCOp(+e.target.value);}}
                  style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                <span style={{fontSize:11,color:cl2.muted}}>EUR/ml</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6}}>
                <span style={{fontSize:11,color:cl2.dim}}>Mobilisation fix</span>
                <input type="number" value={cMobilFix!==null?cMobilFix:mfEur} min={0} step={100}
                  onChange={function(e){setCMF(+e.target.value);}}
                  style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                <span style={{fontSize:11,color:cl2.muted}}>EUR</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"140px 1fr 80px",alignItems:"center",gap:6}}>
                <span style={{fontSize:11,color:cl2.dim}}>Mobilisation /km</span>
                <input type="number" value={cMobilKm!==null?cMobilKm:mkEur} min={0} step={0.1}
                  onChange={function(e){setCMK(+e.target.value);}}
                  style={Object.assign({},iS,{width:"100%",textAlign:"right"})}/>
                <span style={{fontSize:11,color:cl2.muted}}>EUR/km</span>
              </div>
              <div style={{fontSize:10,color:"#4a6a74",marginTop:2}}>Rates are 2-3x grinding rates reflecting deeper metal removal and slower speed.</div>
            </div>
          )}
        </div>
      </div>

      <div>
        {!simResult&&(
          <div style={{background:"rgba(0,0,0,0.15)",borderRadius:10,padding:24,textAlign:"center",color:"#4a6a74",fontSize:12}}>
            Run simulation first to see reprofiling cost breakdown.
          </div>
        )}
        {simResult&&!props.reprActive&&(
          <div style={{background:"rgba(251,191,36,0.06)",border:"1px solid rgba(251,191,36,0.2)",borderRadius:10,padding:20,textAlign:"center"}}>
            <div style={{color:cl2.amber,fontSize:13,fontWeight:700,marginBottom:6}}>Reprofiling model is disabled</div>
            <div style={{color:cl2.dim,fontSize:11}}>Enable the Reprofiling Model in Rail Parameters to activate reprofiling cost calculations.</div>
          </div>
        )}
        {simResult&&props.reprActive&&(
          <div>
            <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
              <Kpi label="Total reprofiling cost" value={fmt(grandTotal)} unit=""/>
              <Kpi label="Total interventions" value={totalReprs} unit="operations"/>
              <Kpi label="Avg cost per intervention" value={totalReprs>0?fmt(grandTotal/totalReprs):"-"} unit=""/>
              <Kpi label="Rate applied" value={(opLocal).toFixed(0)} unit={sym+"/ml"}/>
            </div>
            {reprRows.length===0&&(
              <div style={{background:"rgba(125,211,200,0.05)",border:"1px solid rgba(125,211,200,0.15)",borderRadius:8,padding:16,textAlign:"center",color:cl2.dim,fontSize:12}}>
                No reprofiling interventions triggered in this simulation. Adjust the threshold in Reprofiling Model parameters.
              </div>
            )}
            {reprRows.length>0&&(
              <div style={{background:"rgba(0,0,0,0.15)",borderRadius:10,border:"1px solid rgba(125,211,200,0.08)",overflow:"hidden"}}>
                <div style={{padding:"12px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:11,letterSpacing:2,color:cl2.teal,textTransform:"uppercase",fontWeight:700}}>
                  Cost breakdown by segment
                </div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr style={{background:"rgba(255,255,255,0.03)"}}>
                        {["Segment","Length","Reprofiling ops","Cost per op","Op cost total","Mobil cost","Total"].map(function(h){
                          return <th key={h} style={{padding:"8px 12px",textAlign:"left",color:cl2.dim,fontWeight:600,fontSize:10,letterSpacing:1,whiteSpace:"nowrap"}}>{h}</th>;
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {reprRows.map(function(r,i){
                        var mobTotal = mobilPerInt ? mobilCostPerInt*r.reprCount : mobilCostPerInt;
                        return(
                          <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.04)",background:i%2===0?"rgba(125,211,200,0.02)":"transparent"}}>
                            <td style={{padding:"8px 12px",color:"#e8f4f3",fontWeight:500}}>{r.seg.label}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{r.lenKm.toFixed(1)} km</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl2.amber,fontWeight:700}}>{r.reprCount}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{fmt(r.costPerInt)}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{fmt(r.opCost*r.reprCount)}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{fmt(mobTotal)}</td>
                            <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl2.teal,fontWeight:700}}>{fmt(r.totalCost)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{borderTop:"2px solid rgba(125,211,200,0.2)",background:"rgba(125,211,200,0.04)"}}>
                        <td colSpan={2} style={{padding:"10px 12px",color:cl2.teal,fontWeight:700,fontSize:12}}>TOTAL ({horizon}yr horizon)</td>
                        <td style={{padding:"10px 12px",fontFamily:"monospace",color:cl2.amber,fontWeight:700}}>{totalReprs}</td>
                        <td style={{padding:"10px 12px"}}></td>
                        <td style={{padding:"10px 12px",fontFamily:"monospace",color:cl2.teal,fontWeight:700}}>{fmt(reprRows.reduce(function(a,r){return a+r.opCost*r.reprCount;},0))}</td>
                        <td style={{padding:"10px 12px",fontFamily:"monospace",color:cl2.teal,fontWeight:700}}>{fmt(reprRows.reduce(function(a,r){return a+(mobilPerInt?mobilCostPerInt*r.reprCount:mobilCostPerInt);},0))}</td>
                        <td style={{padding:"10px 12px",fontFamily:"monospace",color:cl2.teal,fontWeight:800,fontSize:13}}>{fmt(grandTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div style={{padding:"8px 16px",fontSize:10,color:"#4a6a74"}}>
                  Rate: {opLocal.toFixed(0)} {sym}/ml operation + {fmt(mobilCostPerInt)} mobilisation {mobilPerInt?"per intervention":"total"}.
                  {" "}Reprofiling rates are 2-3x grinding rates (deeper passes, specialist equipment).
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function HelpModal(props){
  const [tab, setTab] = useState("overview");
  const [detOpen, setDetOpen] = useState(false);
  var orderedHelp = useMemo(function(){
    var items = HELP.slice();
    var tampIdx = items.findIndex(function(h){return h.id==="tamping";});
    var limIdx = items.findIndex(function(h){return h.id==="limits";});
    if(tampIdx>=0 && limIdx>=0 && tampIdx>limIdx){
      var tamp = items.splice(tampIdx,1)[0];
      limIdx = items.findIndex(function(h){return h.id==="limits";});
      items.splice(limIdx,0,tamp);
    }
    return items;
  },[]);
  var sec=orderedHelp.find(function(h){return h.id===tab;}) || HELP.find(function(h){return h.id===tab;});
  var linkTypeColor={paper:cl.teal,standard:cl.amber,report:cl.purple,book:"#60a5fa"};
  var linkTypeLabel={paper:"Paper",standard:"Standard",report:"Report",book:"Book"};
  return(
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>
      <div style={{background:"linear-gradient(160deg,#0d1f2a,#0a1820)",border:"1px solid rgba(125,211,200,0.2)",borderRadius:16,width:"100%",maxWidth:900,maxHeight:"85vh",display:"flex",flexDirection:"column",boxShadow:"0 32px 80px rgba(0,0,0,0.6)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 24px",borderBottom:"1px solid rgba(125,211,200,0.12)",flexShrink:0}}>
          <div>
            <div style={{fontSize:10,letterSpacing:3,color:cl.teal,fontWeight:700,textTransform:"uppercase"}}>Rail Wear Simulator v1.2</div>
            <div style={{fontSize:18,fontWeight:800,color:"#e8f4f3"}}>Documentation, Methodology and Sources</div>
          </div>
          <button onClick={props.onClose} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,color:cl.text,cursor:"pointer",width:34,height:34,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>x</button>
        </div>
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>
          <div style={{width:185,flexShrink:0,borderRight:"1px solid rgba(125,211,200,0.08)",padding:"10px 8px",overflowY:"auto"}}>
            {orderedHelp.map(function(h){return(
              <div key={h.id} onClick={function(){setTab(h.id);setDetOpen(false);}} style={{padding:"7px 10px",borderRadius:7,cursor:"pointer",background:tab===h.id?"rgba(125,211,200,0.1)":"transparent",borderLeft:"3px solid "+(tab===h.id?cl.teal:"transparent"),marginBottom:2}}>
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
            {sec&&sec.details&&(
              <div style={{marginTop:16,borderTop:"1px solid rgba(125,211,200,0.1)",paddingTop:12}}>
                <div onClick={function(){setDetOpen(function(v){return !v;});}}
                  style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",padding:"8px 12px",borderRadius:8,background:detOpen?"rgba(125,211,200,0.06)":"rgba(255,255,255,0.02)",border:detOpen?"1px solid rgba(125,211,200,0.2)":"1px solid rgba(125,211,200,0.08)",transition:"background 0.2s"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:10,fontWeight:700,color:cl.teal,letterSpacing:2,textTransform:"uppercase"}}>Details</span>
                    <span style={{fontSize:11,color:cl.dim}}>In-depth explanation</span>
                  </div>
                  <span style={{fontSize:12,color:cl.teal,fontWeight:700}}>{detOpen?"collapse":"expand"}</span>
                </div>
                {detOpen&&(
                  <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:14}}>
                    {sec.details.map(function(d,di){
                      return(
                        <div key={di} style={{background:"rgba(0,0,0,0.15)",borderRadius:8,padding:"14px 16px",borderLeft:"3px solid rgba(125,211,200,0.3)"}}>
                          {d.heading&&<div style={{fontSize:12,fontWeight:700,color:cl.teal,marginBottom:8,letterSpacing:1,textTransform:"uppercase"}}>{d.heading}</div>}
                          <div style={{fontSize:12,color:"#a0bfbb",lineHeight:2.0,whiteSpace:"pre-line"}}>{d.text}</div>
                          {d.table&&(
                            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,marginTop:10}}>
                              <thead><tr style={{background:"rgba(125,211,200,0.06)"}}>
                                {d.table[0].map(function(h,j){return <th key={j} style={{padding:"6px 10px",textAlign:"left",color:cl.teal,fontWeight:600,letterSpacing:1}}>{h}</th>;})}
                              </tr></thead>
                              <tbody>
                                {d.table.slice(1).map(function(row,j){return(
                                  <tr key={j} style={{borderTop:"1px solid rgba(255,255,255,0.04)"}}>
                                    {row.map(function(cell,k){return <td key={k} style={{padding:"6px 10px",color:k===0?"#e8f4f3":"#a0bfbb",fontFamily:k>0?"monospace":"inherit"}}>{cell}</td>;})}
                                  </tr>
                                );})}
                              </tbody>
                            </table>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div style={{padding:"10px 24px",borderTop:"1px solid rgba(125,211,200,0.08)",fontSize:11,color:"#3a5a64",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <span>v1.2 - EN 13674 / UIC 714 / Infrabel 2023 / Guangzhou 2021 - Created by <b style={{fontWeight:700}}>Mohamed BOUDIA</b></span>
          <span style={{color:cl.dim,cursor:"pointer"}} onClick={props.onClose}>Close</span>
        </div>
      </div>
    </div>
  );
}

// ---- MAIN APP ----


function getRate(code, liveRates, customRates, customCurrencyMeta) {
  if(code === "EUR") return 1.0;
  if(customRates && customRates[code] !== undefined) return customRates[code];
  if(liveRates && liveRates[code]) return liveRates[code];
  if(customCurrencyMeta && customCurrencyMeta[code] && customCurrencyMeta[code].rate !== undefined) return customCurrencyMeta[code].rate;
  return (CURRENCIES[code]||{rate:1}).rate;
}

export default function App() {
  // --- Auth ---
  const [authed,   setAuthed]  = useState(false);
  const [authPwd,  setAuthPwd] = useState("");
  const [authErr,  setAuthErr] = useState(false);
  const APP_PWD = "mohamed";


  const [context,  setCon]  = useState("metro");
  const [trains,   setTr]   = useState([{id:1,label:"Type A",trainsPerDay:200,axleLoad:14,bogies:4,axlesPerBogie:2,weekActive:false,weekProfile:{weekday:200,saturday:140,sunday:80},mileageActive:false,mileageProfile:{fleetSize:10,mileagePerTrain:120000,sectionKm:10}}]);
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
  const [customLimActive, setCustomLimActive] = useState(false);
  const [customLimV,      setCustomLimV]      = useState(null);
  const [customLimL,      setCustomLimL]      = useState(null);
  // Reserve threshold override
  const [customResActive, setCustomResActive] = useState(false);
  const [customMinRes,    setCustomMinRes]    = useState(3.0);
  const [tPlatform,    setTPlatform]   = useState("P2");
  const [tAppoint,     setTAppoint]    = useState({r1:50,r2:40,r3:30,r4:20,r5:15});
  const [tDegCycles,   setTDegCycles]  = useState(6);
  const [tBallastDens, setTBallastDens]= useState(1.7);
  const [tcMachineKey, setTCMachine]  = useState("standard");
  const [tcMode,       setTCMode]     = useState("sub");
  const [tcRegion,     setTCRegion]   = useState("WEU");
  const [tcNight,      setTCNight]    = useState(6);
  const [tcBallastPxOv,setTCBallPx]   = useState(null);
  const [tcCOpPerMl,   setTCCOp]      = useState(null);
  const [tcCMobilFix,  setTCCMF]      = useState(null);
  const [tcCDegarnMl,  setTCCDeg]     = useState(null);
  const [tcOwnManual,  setTCOwnManual]= useState(false);
  const [tcOwnFuelLph, setTCOwnFuel]  = useState(null);
  const [tcOwnGasoil,  setTCOwnGasoil]= useState(null);
  const [tcOwnMaintH,  setTCOwnMaint] = useState(null);
  const [tcOwnLabourH, setTCOwnLab]   = useState(null);
  const [tcOwnProdMlH, setTCOwnProd]  = useState(null);

  function enforceContextCombination(nextContext, nextRailType, nextTrackMode) {
    var rt = nextRailType;
    var tm = nextTrackMode;
    if(nextContext==="heavy"){
      if(rt==="groove") rt="vignole";
      if(tm==="embedded") tm="ballast";
    }
    return {railType:rt, trackMode:tm};
  }
  function handleContextChange(nextContext){
    var next = enforceContextCombination(nextContext, railType, trackMode);
    setCon(nextContext);
    if(next.railType!==railType) setRT(next.railType);
    if(next.trackMode!==trackMode) setTM(next.trackMode);
  }
  function handleRailTypeChange(nextRailType){
    var next = enforceContextCombination(context, nextRailType, trackMode);
    setRT(next.railType);
    if(next.trackMode!==trackMode) setTM(next.trackMode);
  }
  function handleTrackModeChange(nextTrackMode){
    var next = enforceContextCombination(context, railType, nextTrackMode);
    setTM(next.trackMode);
    if(next.railType!==railType) setRT(next.railType);
  }
  useEffect(function(){
    var next = enforceContextCombination(context, railType, trackMode);
    if(next.railType!==railType) setRT(next.railType);
    if(next.trackMode!==trackMode) setTM(next.trackMode);
  }, [context, railType, trackMode]);
  // Reprofiling model
  const [reprActive,  setReprActive] = useState(false);
  const [reprThresh,  setReprThresh] = useState(60);
  const [reprRemL,    setReprRemL]   = useState(3.0);
  const [reprRemV,    setReprRemV]   = useState(0.8);
  const [reprRcfR,    setReprRcfR]   = useState(50);
  const [reprSkip,      setReprSkip]      = useState(true);
  const [reprRadiusBased, setReprRadiusBased] = useState(true); // ON by default
  const [reprRemLByBand,  setReprRemLByBand]  = useState({r1:3.0,r2:2.0,r3:1.0,r4:0.5,r5:0.0});
  const [initCond, setIC]   = useState({r1:{wearV:0,wearL:0,rcf:0,mgt:0},r2:{wearV:0,wearL:0,rcf:0,mgt:0},r3:{wearV:0,wearL:0,rcf:0,mgt:0},r4:{wearV:0,wearL:0,rcf:0,mgt:0},r5:{wearV:0,wearL:0,rcf:0,mgt:0}});
  const [specialZones, setSpZ] = useState([]);
  const [result,   setRes]  = useState(null);
  const [aidx,     setAi]   = useState(0);
  const [ctab,     setCt]   = useState("wear");
  const [hasRun,   setHR]   = useState(false);
  const [err,      setErr]  = useState(null);
  const [showHelp,      setHelp]       = useState(false);
  const [showReport,    setShowRpt]    = useState(false);
  const [projectName,   setProjName]   = useState("");
  const [grindEurPerMl, setGrindEur]   = useState(22);
  const [replEurPerMl,  setReplEur]    = useState(380);
  // Lifted grind params
  const [grindMachine,    setGMachine]   = useState("line");
  const [grindMode,       setGMode]      = useState("sub");
  const [grindRegion,     setGRegion]    = useState("WEU");
  const [grindNight,      setGNight]     = useState(6);
  const [grindDistKm,     setGDist]      = useState(80);
  const [grindMobilPerInt,setGMobil]     = useState(true);
  // Custom rate overrides lifted from GrindPanel edit rates
  const [grindCOpPerMl,  setGCOp]       = useState(null);
  const [grindCMobilFix, setGCMF]       = useState(null);
  const [grindCMobilKm,  setGCMK]       = useState(null);
  // Lifted repl params (most impactful for comparison alignment)
  const [replRegion,    setReplRegion]  = useState("WEU");
  const [replOvhdPct,   setReplOvhd]   = useState(18);
  const [replWeldType,  setReplWeld]   = useState("thermit");
  const [replJointSp,   setReplJoint]  = useState(25);
  const [replCustomP,   setReplCustomP]= useState(null);
  const [sharedCurrency,setSharedCur] = useState("EUR");
  const [liveRates,    setLiveRates]  = useState(null);
  const [customRates,  setCustomRates]= useState({});
  const [customCurrencyMeta, setCustomCurrencyMeta] = useState({});
  const [customCurrencyForm, setCustomCurrencyForm] = useState({code:"",symbol:"",rate:""});
  const [ratesStatus,  setRatesStatus]= useState("idle");
  const [ratesDate,    setRatesDate]  = useState(null);
  const [showRatesPop, setShowRatesPop]= useState(false);

  var fetchRates = useCallback(function() {
    setRatesStatus("loading");
    fetch("https://api.exchangerate-api.com/v4/latest/EUR")
      .then(function(r){ return r.json(); })
      .then(function(data){
        if(data && data.rates) {
          setLiveRates(data.rates);
          setRatesStatus("live");
          setRatesDate(data.date||new Date().toISOString().slice(0,10));
        } else { setRatesStatus("fallback"); }
      })
      .catch(function(){ setRatesStatus("fallback"); });
  }, []);

  useEffect(function(){
    var timer = setTimeout(function(){ fetchRates(); }, 300);
    return function(){ clearTimeout(timer); };
  }, [fetchRates]);

  var currencyMap = useMemo(function(){
    var merged = {};
    Object.keys(CURRENCIES).forEach(function(code){
      merged[code] = Object.assign({}, CURRENCIES[code], {
        rate: getRate(code, liveRates, customRates, customCurrencyMeta),
      });
    });
    Object.keys(customCurrencyMeta).forEach(function(code){
      var meta = customCurrencyMeta[code];
      merged[code] = {
        label: meta.label || (code + " (custom)"),
        symbol: meta.symbol || code,
        rate: getRate(code, liveRates, customRates, customCurrencyMeta),
      };
    });
    return merged;
  }, [liveRates, customRates, customCurrencyMeta]);

  var currencyOptions = useMemo(function(){
    return Object.keys(currencyMap).map(function(code){
      return {v:code,l:currencyMap[code].label};
    });
  }, [currencyMap]);

  var currencyCodes = useMemo(function(){
    return Object.keys(currencyMap).filter(function(code){return code!=="EUR";});
  }, [currencyMap]);

  function resetCurrencyOverride(code) {
    setCustomRates(function(prev){
      var next = Object.assign({}, prev);
      delete next[code];
      return next;
    });
  }

  function removeCustomCurrency(code) {
    setCustomCurrencyMeta(function(prev){
      var next = Object.assign({}, prev);
      delete next[code];
      return next;
    });
    setCustomRates(function(prev){
      var next = Object.assign({}, prev);
      delete next[code];
      return next;
    });
    if(sharedCurrency===code) setSharedCur("EUR");
  }

  function addCustomCurrency() {
    var code = customCurrencyForm.code.trim().toUpperCase();
    var symbol = customCurrencyForm.symbol.trim() || code;
    var manualRate = parseFloat(customCurrencyForm.rate);
    var liveRate = liveRates && liveRates[code] ? liveRates[code] : null;
    var hasManualRate = !isNaN(manualRate) && manualRate > 0;
    var finalRate = hasManualRate ? manualRate : (liveRate || null);
    if(code.length < 2 || !finalRate) return;

    setCustomCurrencyMeta(function(prev){
      return Object.assign({}, prev, {
        [code]: {
          label: code + " (custom)",
          symbol: symbol || code,
          rate: finalRate,
        }
      });
    });
    if(hasManualRate || !liveRate) {
      setCustomRates(function(prev){return Object.assign({}, prev, {[code]: finalRate});});
    } else {
      resetCurrencyOverride(code);
    }
    setSharedCur(code);
    setCustomCurrencyForm({code:"",symbol:"",rate:""});
  }

  function addTrain(){setTr(function(t){return t.concat([{id:Date.now(),label:"Type "+String.fromCharCode(65+t.length),trainsPerDay:100,axleLoad:14,bogies:4,axlesPerBogie:2,weekActive:false,weekProfile:{weekday:100,saturday:70,sunday:40},mileageActive:false,mileageProfile:{fleetSize:10,mileagePerTrain:120000,sectionKm:10}}]);});}
  function delTrain(id){setTr(function(t){return t.filter(function(x){return x.id!==id;});});}
  function updTrain(id,f,v){setTr(function(t){return t.map(function(x){return x.id===id?Object.assign({},x,{[f]:v}):x;});});}
  function updSeg(id,f,v){setSegs(function(s){return s.map(function(x){return x.id===id?Object.assign({},x,{[f]:v}):x;});});}
  function togSeg(id){setSegs(function(s){return s.map(function(x){return x.id===id?Object.assign({},x,{active:!x.active,lengthKm:x.active?0:(x.lengthKm||1.0)}):x;});});}
  function updIC(id,f,v){setIC(function(c){return Object.assign({},c,{[id]:Object.assign({},c[id],{[f]:v})});});}

  var mgtPrev=useMemo(function(){return calcMGT(trains).toFixed(2);},[trains]);
  var eqPrev =useMemo(function(){return calcEqMGT(trains,context).toFixed(2);},[trains,context]);

  // Compute live grind cost params from lifted state so ComparePanel always has current values
  var liveGrindCost = useMemo(function(){
    var m = GRIND_MACHINES[grindMachine] || GRIND_MACHINES.line;
    // Apply custom overrides to machine object (same logic as getEffectiveMachine in GrindPanel)
    var effM = Object.assign({}, m);
    if(grindMode !== "owned") {
      var sr = m.subRates;
      effM.subRates = {
        opPerMl:    Object.assign({}, sr.opPerMl,    grindCOpPerMl  !== null ? {[grindRegion]: grindCOpPerMl}  : {}),
        mobilFix:   Object.assign({}, sr.mobilFix,   grindCMobilFix !== null ? {[grindRegion]: grindCMobilFix} : {}),
        mobilPerKm: Object.assign({}, sr.mobilPerKm, grindCMobilKm  !== null ? {[grindRegion]: grindCMobilKm}  : {}),
      };
    }
    var c = calcGrindCostPerMl(effM, grindMode, grindRegion, grindNight, 1, "EUR");
    return {
      perMl:          c.perMl,
      mobilFix:       c.mobilFix,
      mobilPerKm:     c.mobilPerKm,
      distKm:         grindDistKm,
      mobilPerInt:    grindMobilPerInt,
      mobilCostPerInt: c.mobilFix + c.mobilPerKm * grindDistKm,
    };
  },[grindMachine, grindMode, grindRegion, grindNight, grindDistKm, grindMobilPerInt, grindCOpPerMl, grindCMobilFix, grindCMobilKm]);

  var liveGrindRate = liveGrindCost.perMl; // kept for backward compat
  // Reprofiling rate - subcontract preset for selected machine+region
  var REPR_OP = {small:{WEU:45,EEU:32,MENA:28,SSA:22,SEA:25,LATAM:30},line:{WEU:65,EEU:48,MENA:42,SSA:32,SEA:38,LATAM:45},speno:{WEU:90,EEU:68,MENA:58,SSA:46,SEA:52,LATAM:62}};
  var liveReprRate = reprActive ? ((REPR_OP[grindMachine]||REPR_OP.line)[grindRegion]||(REPR_OP[grindMachine]||REPR_OP.line).WEU) : 0;
  var REPR_MOB_FIX = {small:{WEU:5000,EEU:3500,MENA:3000,SSA:2500,SEA:2800,LATAM:3200},line:{WEU:9000,EEU:6500,MENA:5500,SSA:4500,SEA:5000,LATAM:6000},speno:{WEU:14000,EEU:10000,MENA:8500,SSA:7000,SEA:8000,LATAM:9500}};
  var REPR_MOB_KM  = {small:{WEU:3.5,EEU:2.5,MENA:2.2,SSA:1.8,SEA:2.0,LATAM:2.5},line:{WEU:5.0,EEU:3.8,MENA:3.2,SSA:2.5,SEA:3.0,LATAM:3.8},speno:{WEU:6.5,EEU:5.0,MENA:4.2,SSA:3.5,SEA:4.0,LATAM:5.0}};
  var liveReprMobilFix = reprActive ? ((REPR_MOB_FIX[grindMachine]||REPR_MOB_FIX.line)[grindRegion]||(REPR_MOB_FIX[grindMachine]||REPR_MOB_FIX.line).WEU) : 0;
  var liveReprMobilKm  = reprActive ? ((REPR_MOB_KM[grindMachine]||REPR_MOB_KM.line)[grindRegion]||(REPR_MOB_KM[grindMachine]||REPR_MOB_KM.line).WEU) : 0;
  var liveReprMobil    = reprActive ? liveReprMobilFix + liveReprMobilKm * 80 : 0; // default 80km depot distance

  // Compute live replacement rate using lifted CostPanel params
  var liveReplRate = useMemo(function(){
    var reg = REGIONS[replRegion] || REGIONS.WEU;
    var p = replCustomP || {lbr:reg.lbr, mat:reg.mat, eqp:reg.eqp, weld:reg.weld, prod:reg.prod, team:reg.team};
    var c = calcCostPerMl(p, "R260", replWeldType, 6, "EUR", replOvhdPct, false, replJointSp);
    return c.total;
  },[replRegion, replOvhdPct, replWeldType, replJointSp, replCustomP]);

  // Grade-specific replacement rate calculator for ComparePanel
  function calcReplRateForGrade(grade) {
    var reg = REGIONS[replRegion] || REGIONS.WEU;
    var p = replCustomP || {lbr:reg.lbr, mat:reg.mat, eqp:reg.eqp, weld:reg.weld, prod:reg.prod, team:reg.team};
    var c = calcCostPerMl(p, grade||"R260", replWeldType, 6, "EUR", replOvhdPct, false, replJointSp);
    return c.total;
  }

  var tampSummaryById = useMemo(function(){
    if(trackMode!=="ballast" || !result || !result.results) return {};
    var fx = (currencyMap[sharedCurrency]||currencyMap.EUR||CURRENCIES.EUR).rate;
    var machine = TAMP_MACHINES_BOUR[tcMachineKey] || TAMP_MACHINES_BOUR.standard;
    var ownOverrides = tcMode==="owned" && tcOwnManual ? {
      fuelLph: tcOwnFuelLph,
      gasoilEurL: tcOwnGasoil,
      maintEurH: tcOwnMaintH,
      labourTeamEurH: tcOwnLabourH,
      prodMlH: tcOwnProdMlH,
    } : null;
    var tcp = calcTampCostPerMl(machine, tcMode, tcRegion, tcNight, currencyMap, sharedCurrency, ownOverrides);
    var opPerMl = tcCOpPerMl !== null ? tcCOpPerMl * fx : tcp.perMl;
    var mobilFix = tcCMobilFix !== null ? tcCMobilFix * fx : tcp.mobilFix;
    var ballastPreset = TAMP_BALLAST_PRICE[tcRegion] || TAMP_BALLAST_PRICE.WEU;
    var ballastEurT = tcBallastPxOv !== null ? tcBallastPxOv * fx : (ballastPreset.carriere + ballastPreset.delivery) * fx;
    var degarnOp = TAMP_DEGARN_OP[tcRegion] || TAMP_DEGARN_OP.WEU;
    var degarnOpMl = tcCDegarnMl !== null ? tcCDegarnMl * fx : degarnOp.opPerMl * fx;
    var degarnMobFx = degarnOp.mobilFix * fx;
    var ctx = context==="tram"?"tram":context==="heavy"?"heavy":"metro";
    var fp = TAMP_PLATFORM[tPlatform] || 1.0;
    var out = {};
    result.results.forEach(function(r){
      var seg = r.seg;
      var band = TAMP_BAND(seg.repr || seg.radius || 300);
      var baseInt = (TAMP_BASE_MGT[ctx]||TAMP_BASE_MGT.metro)[band] || 25;
      var segSpeed = seg.speed || speed;
      var fSpeed = Math.sqrt(Math.max(20, TAMP_V_REF) / Math.max(20, segSpeed));
      var tampMGT = baseInt * fp * fSpeed;
      var mgtPY = r && r.mgtPY ? r.mgtPY : 5;
      var yrsPerInt = mgtPY > 0 ? tampMGT / mgtPY : tampMGT / 5;
      var nInterv = Math.max(0, Math.floor(horizon / yrsPerInt));
      var nDegarn = Math.floor(nInterv / tDegCycles);
      var nTamp = Math.max(0, nInterv - nDegarn);
      var lenMl = (seg.lengthKm||0) * 1000;
      var appKgMl = tAppoint[band] || TAMP_APPOINT_DEFAULT[band] || 20;
      var appointT = appKgMl * lenMl / 1000;
      var degarnAppT = appKgMl * TAMP_DEGARN_FACTOR * lenMl / 1000;
      var cOpCyc = opPerMl * lenMl;
      var cMobCyc = mobilFix;
      var cBallCyc = appointT * ballastEurT;
      var cDegOpCyc = degarnOpMl * lenMl + degarnMobFx;
      var cDegBalCyc = degarnAppT * ballastEurT;
      var totalOpC = cOpCyc * nInterv;
      var totalMobC = cMobCyc * nInterv;
      var totalBallC = cBallCyc * nInterv;
      var totalDegC = (cDegOpCyc + cDegBalCyc) * nDegarn;
      out[seg.id] = {
        nTamp:nTamp,
        nDegarn:nDegarn,
        totalCost: totalOpC + totalMobC + totalBallC + totalDegC,
      };
    });
    return out;
  }, [trackMode,result,currencyMap,sharedCurrency,tcMachineKey,tcMode,tcRegion,tcNight,tcBallastPxOv,tcCOpPerMl,tcCMobilFix,tcCDegarnMl,tcOwnManual,tcOwnFuelLph,tcOwnGasoil,tcOwnMaintH,tcOwnLabourH,tcOwnProdMlH,context,tPlatform,speed,horizon,tDegCycles,tAppoint]);

  var run=useCallback(function(){
    var active=segs.filter(function(s){return s.active&&s.lengthKm>0;}).map(function(s){
      var base=Object.assign({},s,{radius:s.repr,railGrade:s.grade});
      if(isBF&&initCond[s.id]){var ic=initCond[s.id];base.initWearV=ic.wearV||0;base.initWearL=ic.wearL||0;base.initRCF=ic.rcf||0;base.initMGT=ic.mgt||0;}
      return base;
    });
    // Append special zones as additional segments
    var activeZones = specialZones.filter(function(z){return z.lengthM>0;}).map(function(z){
      return {
        id:z.id, label:z.name, radius:z.radius||9000, railGrade:z.grade||"R260",
        lengthKm: z.lengthM/1000,
        speed: z.speed || speed,
        fVExtra: z.fVExtra,
        corrugationMGT: z.corrugation ? z.corrMGT : null,
        isSpecialZone: true, zoneType: z.type,
      };
    });
    var allSegs = active.concat(activeZones);
    if(allSegs.length===0){setErr("Enable at least one radius band or special zone.");return;}
    try{setErr(null);var r=runSim({context:context,trains:trains,segments:allSegs,strategy:strategy,railType:railType,trackMode:trackMode,speed:speed,lubrication:lubr,horizonYears:horizon,customLimV:customLimActive?customLimV:null,customLimL:customLimActive?customLimL:null,customResActive:customResActive,customMinRes:customMinRes,reprActive:reprActive,reprThresh:reprThresh,reprRemL:reprRemL,reprRemV:reprRemV,reprRcfR:reprRcfR,reprSkip:reprSkip,reprRadiusBased:reprRadiusBased,reprRemLByBand:reprRemLByBand});setRes(r);setAi(0);setHR(true);}
    catch(e){setErr("Simulation error: "+e.message);}
  },[context,trains,segs,strategy,railType,trackMode,speed,lubr,horizon,isBF,initCond,specialZones,customLimActive,customLimV,customLimL,reprActive,reprThresh,reprRemL,reprRemV,reprRcfR,reprSkip,reprRadiusBased,reprRemLByBand,customResActive,customMinRes]);

  var asr=result&&result.results[aidx];
  var gp={railType:railType,trackMode:trackMode,speed:speed,lubrication:lubr,strategy:strategy};

  function generatePDF() {
    try{
    setErr(null);
    var doc = new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
    var W=210, H=297;
    var ml=15, mr=15, mt=15; // margins
    var cw = W - ml - mr;    // content width
    var y = mt;
    var today = new Date().toLocaleDateString("en-GB");
    var pName = projectName || "Unnamed Project";
    
    // ---- COLORS ----
    var TEAL   = [125,211,200];
    var AMBER  = [251,191,36];
    var WARN   = [248,113,113];
    var GREEN  = [74,222,128];
    var DARK   = [13,26,34];
    var LIGHT  = [200,221,217];
    var MUTED  = [136,153,170];
    var WHITE  = [255,255,255];
    
    // ---- HELPERS ----
    function newPage() {
      doc.addPage();
      y = mt;
      // subtle header bar
      doc.setFillColor.apply(doc, DARK);
      doc.rect(0,0,W,8,"F");
      doc.setFontSize(7); doc.setTextColor.apply(doc, MUTED);
      doc.text(pName, ml, 5.5);
      doc.text("Rail Wear Simulator v1.2 - Mohamed BOUDIA", W-mr, 5.5, {align:"right"});
      y = 14;
    }
    
    function checkY(needed) { if (y + needed > H - 15) { newPage(); } }
    
    function sectionTitle(txt) {
      checkY(12);
      doc.setFillColor.apply(doc, TEAL);
      doc.rect(ml, y, cw, 7, "F");
      doc.setFontSize(10); doc.setFont("helvetica","bold");
      doc.setTextColor.apply(doc, DARK);
      doc.text(txt, ml+3, y+5);
      y += 10;
      doc.setFont("helvetica","normal");
    }
    
    function subTitle(txt) {
      checkY(8);
      doc.setFontSize(9); doc.setFont("helvetica","bold");
      doc.setTextColor.apply(doc, TEAL);
      doc.text(txt, ml, y+4);
      doc.setFont("helvetica","normal");
      y += 7;
    }
    
    function bodyText(txt, indent) {
      var x = ml + (indent||0);
      doc.setFontSize(8); doc.setTextColor.apply(doc, LIGHT);
      var lines2 = doc.splitTextToSize(txt, cw - (indent||0));
      checkY(lines2.length * 4 + 2);
      doc.text(lines2, x, y);
      y += lines2.length * 4 + 2;
    }
    
    function kpiRow(items) {
      // items = [{label, value, unit, color}]
      checkY(16);
      var colW = cw / items.length;
      items.forEach(function(item, i) {
        var x = ml + i*colW;
        var col = item.color || TEAL;
        doc.setFillColor(col[0]*0.15+20, col[1]*0.15+20, col[2]*0.15+20);
        doc.setDrawColor.apply(doc, col);
        doc.roundedRect(x+1, y, colW-2, 14, 1.5, 1.5, "FD");
        doc.setFontSize(7); doc.setTextColor.apply(doc, MUTED);
        doc.text(item.label.toUpperCase(), x + colW/2, y+4, {align:"center"});
        doc.setFontSize(10); doc.setFont("helvetica","bold");
        doc.setTextColor.apply(doc, col);
        doc.text(String(item.value), x + colW/2, y+10, {align:"center"});
        doc.setFontSize(7); doc.setFont("helvetica","normal");
        doc.setTextColor.apply(doc, MUTED);
        if(item.unit) doc.text(item.unit, x + colW/2, y+13, {align:"center"});
      });
      y += 17;
    }
    
    function tableHeader(cols) {
      // cols = [{label, w, align}]
      checkY(8);
      doc.setFillColor(25,45,55);
      doc.rect(ml, y, cw, 6, "F");
      doc.setFontSize(7); doc.setFont("helvetica","bold");
      doc.setTextColor.apply(doc, TEAL);
      var x = ml;
      cols.forEach(function(col) {
        var align = col.align || "left";
        var tx = align==="right" ? x+col.w-1 : x+1;
        doc.text(col.label, tx, y+4, {align:align==="right"?"right":"left"});
        x += col.w;
      });
      doc.setFont("helvetica","normal");
      y += 6;
      return cols;
    }
    
    function tableRow(cols, vals, shade) {
      checkY(6);
      if(shade) { doc.setFillColor(18,35,44); doc.rect(ml,y,cw,5.5,"F"); }
      doc.setFontSize(7); doc.setTextColor.apply(doc, LIGHT);
      var x = ml;
      cols.forEach(function(col, i) {
        var val = String(vals[i]||"-");
        var align = col.align || "left";
        var col_color = col.color_fn ? col.color_fn(vals[i]) : null;
        if(col_color) doc.setTextColor.apply(doc, col_color);
        else doc.setTextColor.apply(doc, LIGHT);
        var tx = align==="right" ? x+col.w-1 : x+1;
        doc.text(val, tx, y+4, {align:align==="right"?"right":"left"});
        x += col.w;
      });
      y += 5.5;
    }
    
    function tableDivider() {
      doc.setDrawColor(30,55,65);
      doc.line(ml, y, ml+cw, y);
      y += 0.5;
    }
    
    function miniBarChart(data, dataKey, color, limitY, labelY) {
      // Simple bar chart using jsPDF rectangles
      checkY(36);
      var chartH = 28, chartW = cw;
      var n = data.length;
      if(n===0) return;
      var maxVal = limitY || Math.max.apply(null, data.map(function(d){return d[dataKey]||0;}));
      if(maxVal===0) maxVal=1;
    
      // Background
      doc.setFillColor(13,26,34);
      doc.rect(ml, y, chartW, chartH, "F");
      // Limit line
      doc.setDrawColor.apply(doc, WARN);
      doc.setLineWidth(0.3);
      var limitPx = chartH - (limitY/maxVal)*chartH*0.9;
      if(limitY && limitY <= maxVal) {
        doc.line(ml, y+limitPx, ml+chartW, y+limitPx);
        doc.setFontSize(6); doc.setTextColor.apply(doc, WARN);
        doc.text(labelY||"Limit", ml+chartW-1, y+limitPx-1, {align:"right"});
      }
      // Bars
      var barW = Math.max(0.5, chartW/n - 0.3);
      doc.setFillColor.apply(doc, color);
      data.forEach(function(d,i) {
        var val = d[dataKey]||0;
        var bH = (val/maxVal)*chartH*0.88;
        var bX = ml + i*(chartW/n);
        doc.rect(bX, y+chartH-bH, barW, bH, "F");
      });
      // Year labels (every 5)
      doc.setFontSize(5.5); doc.setTextColor.apply(doc, MUTED);
      data.forEach(function(d,i) {
        if(d.year%5===0) {
          doc.text(String(d.year), ml+i*(chartW/n)+barW/2, y+chartH+3, {align:"center"});
        }
      });
      doc.setFontSize(6); doc.setTextColor.apply(doc, MUTED);
      doc.text("Year", ml+chartW/2, y+chartH+5, {align:"center"});
      y += chartH + 7;
    }
    
    function fmt(v) {
      if(v>=1e6) return (v/1e6).toFixed(2)+"M EUR";
      if(v>=1e3) return (v/1e3).toFixed(1)+"k EUR";
      return v.toFixed(0)+" EUR";
    }
    
    // ==============================
    // PAGE 1 - COVER
    // ==============================
    doc.setFillColor.apply(doc, DARK);
    doc.rect(0, 0, W, H, "F");
    // Accent bar
    doc.setFillColor.apply(doc, TEAL);
    doc.rect(0, 0, 6, H, "F");
    // Title block
    doc.setFontSize(26); doc.setFont("helvetica","bold");
    doc.setTextColor.apply(doc, WHITE);
    doc.text("Rail Wear &", ml+10, 60);
    doc.text("Maintenance Report", ml+10, 74);
    doc.setFontSize(13); doc.setFont("helvetica","normal");
    doc.setTextColor.apply(doc, TEAL);
    doc.text("Simulation Results and Lifecycle Cost Analysis", ml+10, 85);
    
    // Project info box
    doc.setFillColor(18,35,44);
    doc.roundedRect(ml+8, 100, cw-8, 50, 2, 2, "F");
    doc.setFontSize(9); doc.setFont("helvetica","bold");
    doc.setTextColor.apply(doc, TEAL);
    doc.text("PROJECT", ml+14, 112);
    doc.setFontSize(12); doc.setTextColor.apply(doc, WHITE);
    doc.text(pName, ml+14, 121);
    doc.setFontSize(8); doc.setFont("helvetica","normal");
    doc.setTextColor.apply(doc, MUTED);
    doc.text("Context: "+CONTEXTS[context].label, ml+14, 131);
    doc.text("Simulation horizon: "+horizon+" years", ml+14, 137);
    doc.text("Strategy: "+strategy.charAt(0).toUpperCase()+strategy.slice(1), ml+14, 143);
    doc.text("Date: "+today, ml+14, 149);
    
    // Quick stats
    if(result) {
      var repSegs = result.results.filter(function(r){return r.repY;}).length;
      var totGrind = result.results.reduce(function(a,r){return a+r.gCount;},0);
      doc.setFontSize(9); doc.setFont("helvetica","bold");
      doc.setTextColor.apply(doc, AMBER);
      doc.text("SUMMARY", ml+14, 165);
      doc.setFont("helvetica","normal"); doc.setFontSize(8);
      doc.setTextColor.apply(doc, LIGHT);
      doc.text("Active segments: "+result.results.length, ml+14, 173);
      doc.text("Replacements in horizon: "+repSegs+"/"+result.results.length, ml+14, 179);
      doc.text("Total grinding passes: "+totGrind, ml+14, 185);
      doc.text("Gross MGT/yr: "+result.mgtPY.toFixed(2)+" MGT", ml+14, 191);
    }
    
    // Footer
    doc.setFontSize(7); doc.setTextColor.apply(doc, MUTED);
    doc.text("Created by Mohamed BOUDIA | Rail Wear Simulator v1.2", ml+10, H-18);
    doc.text("EN 13674-1 / UIC 714 / Infrabel/TU Delft 2023 / Guangzhou Metro 2021", ml+10, H-13);
    doc.text("Page 1", W-mr, H-8, {align:"right"});
    
    // ==============================
    // PAGE 2 - PROJECT PARAMETERS
    // ==============================
    newPage();
    sectionTitle("1. Project Parameters");
    
    subTitle("1.1 Context and Global Settings");
    var globalRows = [
      ["Context", CONTEXTS[context].label],
      ["Rail Type", RAIL_TYPES[railType].label],
      ["Track Form", TRACK_MODES[trackMode].label],
      ["Line Speed", speed+" km/h"],
      ["Flange Lubrication", LUBRICATION[lubr].label],
      ["Maintenance Strategy", strategy.charAt(0).toUpperCase()+strategy.slice(1)],
      ["Simulation Horizon", horizon+" years"],
      ["Brownfield Mode", isBF?"Enabled (existing rail)":"Disabled (new rail)"],
    ];
    var gCols = [{label:"Parameter",w:60},{label:"Value",w:cw-60}];
    tableHeader(gCols);
    globalRows.forEach(function(row,i){ tableRow(gCols,[row[0],row[1]],i%2===0); });
    tableDivider(); y+=4;
    
    subTitle("1.2 Train Fleet");
    var tCols = [{label:"Type",w:28},{label:"Mode",w:22},{label:"Passes/day",w:22,align:"right"},{label:"Axle load (t)",w:24,align:"right"},{label:"Bogies",w:16,align:"right"},{label:"Axles/bogie",w:22,align:"right"},{label:"MGT/yr",w:cw-134,align:"right"}];
    tableHeader(tCols);
    trains.forEach(function(tr,i){
      var ppd = calcPassesPerDay(tr);
      var mgt = (ppd*tr.axleLoad*tr.bogies*tr.axlesPerBogie*365/1e6).toFixed(2);
      var mode = tr.mileageActive?"Mileage":tr.weekActive?"Weekly profile":"Manual";
      tableRow(tCols,[tr.label,mode,ppd.toFixed(1),tr.axleLoad,tr.bogies,tr.axlesPerBogie,mgt],i%2===0);
    });
    // Weekly/mileage profile detail
    trains.forEach(function(tr){
      if(tr.weekActive && tr.weekProfile){
        var wp=tr.weekProfile;
        checkY(6);
        doc.setFontSize(7); doc.setTextColor.apply(doc,MUTED);
        doc.text("  "+tr.label+" weekly profile: Mon-Fri="+wp.weekday+" | Sat="+wp.saturday+" | Sun="+wp.sunday+" -> equiv "+calcPassesPerDay(tr).toFixed(1)+" passes/day", ml+2, y+4);
        y+=6;
      }
      if(tr.mileageActive && tr.mileageProfile){
        var mp=tr.mileageProfile;
        checkY(6);
        doc.setFontSize(7); doc.setTextColor.apply(doc,MUTED);
        doc.text("  "+tr.label+" mileage: "+mp.fleetSize+" trains x "+mp.mileagePerTrain+"km/yr / "+mp.sectionKm+"km section -> "+calcPassesPerDay(tr).toFixed(1)+" passes/day", ml+2, y+4);
        y+=6;
      }
    });
    tableDivider();
    var totalMGT = calcMGT(trains).toFixed(2);
    var totalEqMGT = calcEqMGT(trains,context).toFixed(2);
    checkY(8);
    doc.setFontSize(7); doc.setFont("helvetica","bold");
    doc.setTextColor.apply(doc,TEAL);
    doc.text("Total: "+totalMGT+" MGT/yr gross | "+totalEqMGT+" MGT/yr equivalent", ml+1, y+4);
    doc.setFont("helvetica","normal"); y+=8;
    
    subTitle("1.3 Track Segments");
    var sCols = [{label:"Segment",w:35},{label:"Radius (m)",w:22,align:"right"},{label:"Length (km)",w:24,align:"right"},{label:"Grade",w:20},{label:"fV",w:12,align:"right"},{label:"fL",w:12,align:"right"},{label:"Init.wearV",w:22,align:"right"},{label:"Init.RCF",w:18,align:"right"},{label:"Active",w:cw-165}];
    tableHeader(sCols);
    segs.forEach(function(seg,i){
      var rb = BANDS.find(function(b){return b.id===seg.id;});
      var ic = initCond[seg.id]||{wearV:0,rcf:0};
      tableRow(sCols,[
        seg.label,
        seg.repr>=9000?"tangent":seg.repr,
        seg.lengthKm.toFixed(1),
        seg.grade,
        rb?rb.f_v:"-",
        rb?rb.f_l:"-",
        isBF?ic.wearV.toFixed(1)+"mm":"-",
        isBF?ic.rcf.toFixed(2):"-",
        seg.active&&seg.lengthKm>0?"Yes":"No",
      ],i%2===0);
    });
    tableDivider(); y+=4;
    
    // ==============================
    // PAGE 3+ - RESULTS PER SEGMENT
    // ==============================
    if(result) {
      result.results.forEach(function(r, si) {
        newPage();
        sectionTitle("2."+(si+1)+" Segment: "+r.seg.label);
        var lim = r.limits;
    
        // KPIs
        kpiRow([
          {label:"Wear rate V",  value:r.wrV.toFixed(3), unit:"mm/100MGT", color:TEAL},
          {label:"Wear rate L",  value:r.wrL.toFixed(3), unit:"mm/100MGT", color:AMBER},
          {label:"Replacement",  value:r.repY?"Yr "+r.repY:"> "+horizon+" yrs", unit:"", color:r.repY?WARN:GREEN},
          {label:"Grindings",    value:r.gCount,          unit:"passes",   color:TEAL},
          {label:"Final RCF",    value:r.data.length?r.data[r.data.length-1].rcf.toFixed(2):"-", unit:"", color:MUTED},
        ]);
    
        // Wear chart
        subTitle("Vertical Wear Progression (mm)");
        miniBarChart(r.data, "wearV", TEAL, lim.v, "V="+lim.v+"mm");
    
        subTitle("Lateral Wear Progression (mm)");
        miniBarChart(r.data, "wearL", AMBER, lim.l, "L="+lim.l+"mm");
    
        // RCF chart
        subTitle("RCF Index Progression");
        miniBarChart(r.data, "rcf", WARN, 0.70, "Limit=0.70");
    
        // Annual data table (every 2 years to save space)
        subTitle("Annual Data (every 2 years)");
        var dCols = [
          {label:"Year",w:16,align:"right"},
          {label:"MGT acc.",w:22,align:"right"},
          {label:"Wear V (mm)",w:26,align:"right"},
          {label:"Wear L (mm)",w:26,align:"right"},
          {label:"RCF",w:18,align:"right"},
          {label:"Reserve (mm)",w:28,align:"right"},
          {label:"Ground",w:18,align:"right"},
          {label:"Replaced",w:cw-154,align:"right"},
        ];
        tableHeader(dCols);
        r.data.forEach(function(d,i){
          if(i%2===0||d.ground||d.repl) {
            tableRow(dCols,[
              d.year, d.mgt,
              d.wearV.toFixed(2), d.wearL.toFixed(2),
              d.rcf.toFixed(2), d.res.toFixed(1),
              d.ground?"Yes":"-", d.repl?"REPLACED":"-",
            ],i%2===0);
          }
        });
        tableDivider();
      });
    }
    
    // ==============================
    // COST SUMMARY PAGE
    // ==============================
    newPage();
    sectionTitle("3. Lifecycle Cost Summary");
    bodyText("Rates: grinding "+liveGrindRate.toFixed(0)+" EUR/ml/pass | replacement "+liveReplRate.toFixed(0)+" EUR/ml (from Grinding Cost and Replacement Cost tabs configuration).");
    y+=4;
    
    if(result) {
      subTitle("3.1 First Cycle (to first replacement)");
      var costCols = [
        {label:"Segment",w:35},
        {label:"Grade",w:18},
        {label:"Length (km)",w:22,align:"right"},
        {label:"Repl. Yr",w:16,align:"right"},
        {label:"Grindings",w:18,align:"right"},
        {label:"Grind cost",w:26,align:"right"},
        {label:"Repl. cost",w:26,align:"right"},
        {label:"Total",w:cw-161,align:"right"},
      ];
      tableHeader(costCols);
      var grandGrind=0, grandRepl=0;
      result.results.forEach(function(r,i){
        var grade = r.seg.grade||r.seg.railGrade||"R260";
        var lenMl = (r.seg.lengthKm||0)*1000;
        var passes = r.data?r.data.reduce(function(a,d){return a+d.ground;},0):0;
        var gCost = lenMl*passes*liveGrindRate;
        var rCost = r.repY?lenMl*liveReplRate:0;
        var tot   = gCost+rCost;
        grandGrind+=gCost; grandRepl+=rCost;
        tableRow(costCols,[
          r.seg.label, grade,
          (r.seg.lengthKm||0).toFixed(1),
          r.repY?"Yr "+r.repY:"> "+horizon+"yr",
          passes,
          fmt(gCost), rCost>0?fmt(rCost):"-", fmt(tot),
        ],i%2===0);
      });
      tableDivider();
      checkY(7);
      doc.setFontSize(8); doc.setFont("helvetica","bold");
      doc.setTextColor.apply(doc,TEAL);
      doc.text("TOTAL FIRST CYCLE: "+fmt(grandGrind+grandRepl)+"  (Grinding: "+fmt(grandGrind)+" | Replacement: "+fmt(grandRepl)+")", ml+1, y+5);
      doc.setFont("helvetica","normal"); y+=12;
    
      subTitle("3.2 Full "+horizon+"-Year Horizon (greenfield at each replacement)");
      var fhCols = [
        {label:"Segment",w:35},
        {label:"Repls",w:14,align:"right"},
        {label:"Passes",w:16,align:"right"},
        {label:"Grind cost",w:26,align:"right"},
        {label:"Repl. cost",w:26,align:"right"},
        {label:"Total "+horizon+"yr",w:cw-117,align:"right"},
      ];
      tableHeader(fhCols);
      var fhGrandGrind=0, fhGrandRepl=0, fhGrandRepls=0;
      result.results.forEach(function(r,i){
        var lenMl = (r.seg.lengthKm||0)*1000;
        var passes = r.data?r.data.reduce(function(a,d){return a+d.ground;},0):0;
        var gCostCycle = lenMl*passes*liveGrindRate;
        var rCostCycle = r.repY?lenMl*liveReplRate:0;
        var repls=0, totGrind=0, totRepl=0, totPass=0, yr=0;
        if(r.repY){
          var cl2=r.repY;
          while(yr+cl2<=horizon){yr+=cl2;repls+=1;totGrind+=gCostCycle;totRepl+=rCostCycle;totPass+=passes;}
          var frac=(horizon-yr)/cl2;
          if(frac>0){totGrind+=gCostCycle*frac;totPass+=Math.round(passes*frac);}
        } else {
          totGrind=gCostCycle; totPass=passes;
        }
        fhGrandGrind+=totGrind; fhGrandRepl+=totRepl; fhGrandRepls+=repls;
        tableRow(fhCols,[
          r.seg.label, repls, totPass,
          fmt(totGrind), totRepl>0?fmt(totRepl):"-", fmt(totGrind+totRepl),
        ],i%2===0);
      });
      tableDivider();
      checkY(7);
      doc.setFontSize(8); doc.setFont("helvetica","bold");
      doc.setTextColor.apply(doc,TEAL);
      doc.text("TOTAL "+horizon+"YR: "+fmt(fhGrandGrind+fhGrandRepl)+"  ("+fhGrandRepls+" replacements | Grinding: "+fmt(fhGrandGrind)+" | Replacement: "+fmt(fhGrandRepl)+")", ml+1, y+5);
      doc.setFont("helvetica","normal"); y+=10;
    }
    
    // ==============================
    // COMPARISON PAGE
    // ==============================
    newPage();
    sectionTitle("4. Strategy Comparison: Preventive vs Corrective");
    
    if(result) {
      // Run both strategies using current params
      var activeSegsForCmp = segs.filter(function(s){return s.active&&s.lengthKm>0;}).map(function(s){
        var b=Object.assign({},s,{radius:s.repr,railGrade:s.grade});
        if(isBF&&initCond[s.id]){var ic=initCond[s.id];b.initWearV=ic.wearV||0;b.initWearL=ic.wearL||0;b.initRCF=ic.rcf||0;}
        return b;
      });
      var baseParams={context:context,trains:trains,segments:activeSegsForCmp,railType:railType,trackMode:trackMode,speed:speed,lubrication:lubr,horizonYears:horizon};
      var rPrev=runSim(Object.assign({},baseParams,{strategy:"preventive"}));
      var rCorr=runSim(Object.assign({},baseParams,{strategy:"corrective"}));
    
      // Summary KPIs
      var pRepls=rPrev.results.filter(function(r){return r.repY;}).length;
      var cRepls=rCorr.results.filter(function(r){return r.repY;}).length;
      var pGrinds=rPrev.results.reduce(function(a,r){return a+r.gCount;},0);
      var cGrinds=rCorr.results.reduce(function(a,r){return a+r.gCount;},0);
    
      kpiRow([
        {label:"Replacements PREV", value:pRepls+" seg",     unit:"", color:TEAL},
        {label:"Replacements CORR", value:cRepls+" seg",     unit:"", color:AMBER},
        {label:"Grindings PREV",    value:pGrinds+" passes", unit:"", color:TEAL},
        {label:"Grindings CORR",    value:cGrinds+" passes", unit:"", color:AMBER},
      ]);
    
      // First cycle comparison table
      subTitle("4.1 First Cycle Comparison");
      var cmpCols=[
        {label:"Segment",w:32},
        {label:"Repl.yr PREV",w:20,align:"right"},
        {label:"Repl.yr CORR",w:20,align:"right"},
        {label:"Delta yr",w:16,align:"right"},
        {label:"Grind PREV",w:24,align:"right"},
        {label:"Grind CORR",w:24,align:"right"},
        {label:"Repl PREV",w:22,align:"right"},
        {label:"Repl CORR",w:22,align:"right"},
        {label:"Saving",w:cw-180,align:"right"},
      ];
      tableHeader(cmpCols);
      var totPrev1=0, totCorr1=0;
      rPrev.results.forEach(function(pr,i){
        var cr=rCorr.results[i];
        if(!cr)return;
        var lenMl=(pr.seg.lengthKm||0)*1000;
        var pPass=pr.data?pr.data.reduce(function(a,d){return a+d.ground;},0):0;
        var cPass=cr.data?cr.data.reduce(function(a,d){return a+d.ground;},0):0;
        var pG=lenMl*pPass*liveGrindRate, cG=lenMl*cPass*liveGrindRate;
        var pR=pr.repY?lenMl*liveReplRate:0, cR=cr.repY?lenMl*liveReplRate:0;
        var pT=pG+pR, cT=cG+cR, sav=cT-pT;
        totPrev1+=pT; totCorr1+=cT;
        var dYr=(cr.repY||(horizon+1))-(pr.repY||(horizon+1));
        tableRow(cmpCols,[
          pr.seg.label,
          pr.repY?"Yr "+pr.repY:">"+horizon+"yr",
          cr.repY?"Yr "+cr.repY:">"+horizon+"yr",
          dYr>0?"+"+dYr+"yr":dYr+"yr",
          fmt(pG), fmt(cG),
          pR>0?fmt(pR):"-", cR>0?fmt(cR):"-",
          (sav>0?"+":"")+fmt(sav),
        ],i%2===0);
      });
      tableDivider();
      checkY(8);
      doc.setFontSize(8); doc.setFont("helvetica","bold");
      doc.setTextColor.apply(doc,(totCorr1-totPrev1)>0?TEAL:WARN);
      doc.text("FIRST CYCLE - PREV: "+fmt(totPrev1)+" | CORR: "+fmt(totCorr1)+" | Saving: "+((totCorr1-totPrev1)>0?"+":"")+fmt(totCorr1-totPrev1), ml+1, y+5);
      doc.setFont("helvetica","normal"); y+=12;
    
      // Full horizon comparison table
      subTitle("4.2 Full "+horizon+"-Year Horizon Comparison");
      tableHeader(cmpCols);
      var totPrevFH=0, totCorrFH=0;
      rPrev.results.forEach(function(pr,i){
        var cr=rCorr.results[i];
        if(!cr)return;
        var lenMl=(pr.seg.lengthKm||0)*1000;
        var pPass=pr.data?pr.data.reduce(function(a,d){return a+d.ground;},0):0;
        var cPass=cr.data?cr.data.reduce(function(a,d){return a+d.ground;},0):0;
        var pGCyc=lenMl*pPass*liveGrindRate, cGCyc=lenMl*cPass*liveGrindRate;
        var pRCyc=pr.repY?lenMl*liveReplRate:0, cRCyc=cr.repY?lenMl*liveReplRate:0;
        function fhCalc(repY,gCyc,rCyc){
          if(!repY)return{g:gCyc,r:0,repls:0};
          var yr=0,g=0,r=0,repls=0;
          while(yr+repY<=horizon){yr+=repY;repls++;g+=gCyc;r+=rCyc;}
          var frac=(horizon-yr)/repY;
          if(frac>0)g+=gCyc*frac;
          return{g:g,r:r,repls:repls};
        }
        var pfh=fhCalc(pr.repY,pGCyc,pRCyc);
        var cfh=fhCalc(cr.repY,cGCyc,cRCyc);
        var pT=pfh.g+pfh.r, cT=cfh.g+cfh.r, sav=cT-pT;
        totPrevFH+=pT; totCorrFH+=cT;
        var dYr=(cr.repY||(horizon+1))-(pr.repY||(horizon+1));
        tableRow(cmpCols,[
          pr.seg.label+" ("+pfh.repls+"r vs "+cfh.repls+"r)",
          pr.repY?"Yr "+pr.repY:">"+horizon+"yr",
          cr.repY?"Yr "+cr.repY:">"+horizon+"yr",
          dYr>0?"+"+dYr+"yr":dYr+"yr",
          fmt(pfh.g), fmt(cfh.g),
          pfh.r>0?fmt(pfh.r):"-", cfh.r>0?fmt(cfh.r):"-",
          (sav>0?"+":"")+fmt(sav),
        ],i%2===0);
      });
      tableDivider();
      checkY(8);
      doc.setFontSize(8); doc.setFont("helvetica","bold");
      doc.setTextColor.apply(doc,(totCorrFH-totPrevFH)>0?TEAL:WARN);
      doc.text(horizon+"YR - PREV: "+fmt(totPrevFH)+" | CORR: "+fmt(totCorrFH)+" | Saving: "+((totCorrFH-totPrevFH)>0?"+":"")+fmt(totCorrFH-totPrevFH), ml+1, y+5);
      doc.setFont("helvetica","normal"); y+=10;
      bodyText("Assumption: each replacement starts from new rail (greenfield). Partial final cycle: grinding prorated, no replacement if horizon ends before next rail change.");
    } else {
      bodyText("Run the simulation first, then export the report to include comparison data.");
    }
    
    // ==============================
    // DISCLAIMER + SOURCES PAGE
    // ==============================
    newPage();
    sectionTitle("5. Disclaimer and Sources");
    
    subTitle("Disclaimer");
    bodyText("This report is generated by Rail Wear Simulator v1.2. Results are based on mathematical models calibrated on published field data. They are intended for planning and budgeting purposes only and should be validated against local field measurements and contractor quotes before final budget submission.");
    bodyText("Cost estimates use indicative reference rates for the selected region and may not reflect actual contract prices, site conditions, or local regulations. The simulator does not model: inner/outer rail asymmetry, wheel profile evolution, seasonal effects, station braking zones, or switch/crossing wear.");
    y+=4;
    
    subTitle("Standards and Normative References");
    var srcs = [
      "EN 13674-1:2011 - Railway applications. Track. Rail. Vignole railway rails 46 kg/m and above",
      "UIC 714R - Classification of lines for the purpose of track maintenance (2004)",
      "EN 13231-3:2012 - Railway applications. Track. Acceptance of works. Rail grinding",
      "prEN 17343 - Railway applications. Track. Rail grinding specification (CEN)",
      "AREMA Manual for Railway Engineering, Chapter 4 - Rail (2022)",
      "ASTM E2660 - Standard guide for wear measurement in railway track",
    ];
    srcs.forEach(function(s){ bodyText("- "+s, 3); });
    y+=4;
    
    subTitle("Scientific References");
    var papers = [
      "Infrabel/TU Delft (2023): Statistical analysis of rail wear on Belgian network, Wear 522. DOI: 10.1016/j.wear.2022.204764",
      "Liu B. et al. (2021): Field investigation of rail wear on Guangzhou Metro, Wear 477. DOI: 10.1016/j.wear.2021.203830",
      "Archard J.F. (1953): Contact and Rubbing of Flat Surfaces, J.Applied Physics 24(8). DOI: 10.1063/1.1721448",
      "Ringsberg J.W. (2001): Life prediction of rolling contact fatigue crack initiation, Int.J.Fatigue 23(7). DOI: 10.1016/S0142-1123(01)00011-5",
      "Grassie S.L. (2005): Rail corrugation: advances in measurement, understanding and treatment, Wear 258. DOI: 10.1016/j.wear.2004.03.066",
      "Rame I. et al. (2018): Abrasive wear of grinding wheels in rail grinding, Wear 406-407. DOI: 10.1016/j.wear.2018.01.012",
    ];
    papers.forEach(function(p){ bodyText("- "+p, 3); });
    y+=6;
    
    // Page numbers
    var totalPages = doc.getNumberOfPages();
    for(var pg=2; pg<=totalPages; pg++) {
      doc.setPage(pg);
      doc.setFontSize(7); doc.setTextColor.apply(doc, MUTED);
      doc.text("Page "+pg+"/"+totalPages, W-mr, H-8, {align:"right"});
      doc.text(today, ml, H-8);
    }
    
    // Save
    var fname = (pName.replace(/[^a-zA-Z0-9_-]/g,"_")||"rail_report")+"_"+today.replace(/\//g,"-")+".pdf";
    doc.save(fname);
    setShowRpt(false);
    }catch(e){
      console.error("PDF generation failed", e);
      setErr("Could not generate the PDF report. Check the browser console for details.");
    }
  }

  if(!authed) {
    return (
      <div style={{background:"#0d1f26",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"-apple-system,BlinkMacSystemFont,sans-serif"}}>
        <div style={{background:"#1a2f38",border:"1px solid rgba(125,211,200,0.2)",borderRadius:14,padding:"48px 40px",width:360,maxWidth:"94vw",textAlign:"center",boxShadow:"0 24px 64px rgba(0,0,0,0.4)"}}>
          <div style={{width:52,height:52,margin:"0 auto 20px",background:"rgba(125,211,200,0.12)",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,color:"#7dd3c8",fontWeight:800}}>R</div>
          <div style={{fontSize:20,fontWeight:700,color:"#e8f4f3",marginBottom:6}}>Rail Wear Simulator</div>
          <div style={{fontSize:13,color:"#6b9ea8",marginBottom:28,lineHeight:1.5}}>Enter your password to access the simulator</div>
          {authErr&&<div style={{color:"#f87171",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(248,113,113,0.08)",borderRadius:6,border:"1px solid rgba(248,113,113,0.2)"}}>Incorrect password. Please try again.</div>}
          <input
            type="password"
            value={authPwd}
            placeholder="Password"
            onChange={function(e){setAuthPwd(e.target.value);setAuthErr(false);}}
            onKeyDown={function(e){
              if(e.key==="Enter"){
                if(authPwd===APP_PWD){setAuthed(true);}
                else{setAuthErr(true);setAuthPwd("");}
              }
            }}
            style={{width:"100%",padding:"11px 14px",background:"rgba(0,0,0,0.3)",border:"1px solid "+(authErr?"rgba(248,113,113,0.5)":"rgba(125,211,200,0.25)"),borderRadius:8,color:"#e8f4f3",fontSize:14,outline:"none",marginBottom:12,boxSizing:"border-box"}}
          />
          <div onClick={function(){
            if(authPwd===APP_PWD){setAuthed(true);}
            else{setAuthErr(true);setAuthPwd("");}
          }} style={{width:"100%",padding:12,background:"rgba(125,211,200,0.15)",border:"1px solid rgba(125,211,200,0.4)",borderRadius:8,color:"#7dd3c8",fontSize:14,fontWeight:700,cursor:"pointer",textAlign:"center"}}>
            Access Simulator
          </div>
          <div style={{color:"#4a6a74",fontSize:11,marginTop:16}}>Contact the administrator if you need access.</div>
        </div>
      </div>
    );
  }
  // --- End Auth ---

  return (
    <div style={{fontFamily:"Segoe UI,sans-serif",background:"linear-gradient(135deg,#0a1a22,#0d2030,#091820)",minHeight:"100vh",color:cl.text}}>
      <div style={{borderBottom:"1px solid rgba(125,211,200,0.12)",padding:"16px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(0,0,0,0.2)",position:"sticky",top:0,zIndex:100}}>
        <div>
          <div style={{fontSize:10,letterSpacing:4,color:cl.teal,fontWeight:700,textTransform:"uppercase"}}>Rail Maintenance</div>
          <div style={{fontSize:20,fontWeight:800,color:"#e8f4f3"}}>Wear and Maintenance Simulator</div>
          <div style={{fontSize:11,color:"#00BFFF",marginTop:3}}>Created by <b style={{fontWeight:700}}>Mohamed BOUDIA</b></div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <span style={{fontSize:12,color:cl.dim}}>Gross MGT: <b style={{color:cl.teal}}>{mgtPrev}</b>/yr | Equiv. MGT: <b style={{color:cl.teal}}>{eqPrev}</b>/yr</span>
          <Btn onClick={function(){setHelp(true);}} sm={true}>Help and Methods</Btn>
          <Btn onClick={function(){setShowRpt(true);}} sm={true}>Export Report (PDF)</Btn>
          <Btn onClick={run} active={true}>Run Simulation</Btn>
        </div>
      </div>
      {showHelp&&<HelpModal onClose={function(){setHelp(false);}}/>}

      {/* Exchange Rates Popover */}
      {showRatesPop&&(
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){setShowRatesPop(false);}}>
          <div onClick={function(e){e.stopPropagation();}} style={{background:"#1a2f38",borderRadius:12,padding:24,width:460,maxWidth:"95vw",maxHeight:"80vh",overflowY:"auto",border:"1px solid rgba(125,211,200,0.2)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:"#e8f4f3"}}>Exchange Rates (base: EUR)</div>
                <div style={{fontSize:11,color:cl.dim,marginTop:2}}>
                  {ratesStatus==="live"&&<span style={{color:cl.teal}}>Live rates  updated {ratesDate}</span>}
                  {ratesStatus==="fallback"&&<span style={{color:cl.amber}}>Fallback rates (offline)</span>}
                  {ratesStatus==="loading"&&<span style={{color:cl.dim}}>Loading...</span>}
                </div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <div onClick={fetchRates} style={{fontSize:11,cursor:"pointer",padding:"4px 12px",borderRadius:6,border:"1px solid rgba(125,211,200,0.3)",color:cl.teal}}>Refresh</div>
                <div onClick={function(){setShowRatesPop(false);}} style={{fontSize:16,cursor:"pointer",color:cl.dim,padding:"0 4px"}}>x</div>
              </div>
            </div>
            <div style={{display:"grid",gap:6}}>
              {currencyCodes.map(function(code){
                var cur = currencyMap[code];
                var liveRate = liveRates&&liveRates[code] ? liveRates[code] : null;
                var customRate = customRates[code] !== undefined ? customRates[code] : null;
                var effectiveRate = customRate !== null ? customRate : (liveRate||cur.rate);
                var isCustom = customRate !== null;
                var isUserAdded = !!customCurrencyMeta[code];
                return (
                  <div key={code} style={{display:"grid",gridTemplateColumns:"120px 1fr 70px 90px",gap:8,alignItems:"center",padding:"6px 8px",borderRadius:6,background:isUserAdded?"rgba(125,211,200,0.04)":"rgba(255,255,255,0.02)"}}>
                    <div style={{fontSize:12,color:"#e8f4f3",fontWeight:500}}>{cur.label.indexOf(" (")>0?cur.label.slice(0,cur.label.indexOf(" (")):cur.label}</div>
                    <input type="number" value={effectiveRate} min={0.001} step={0.001}
                      onChange={function(e){
                        var v=+e.target.value;
                        if(v>0) setCustomRates(function(prev){return Object.assign({},prev,{[code]:v});});
                      }}
                      style={{background:"rgba(0,0,0,0.3)",border:"1px solid "+(isCustom?"rgba(251,191,36,0.4)":"rgba(255,255,255,0.1)"),borderRadius:4,color:"#e8f4f3",padding:"4px 8px",fontSize:12,textAlign:"right"}}/>
                    <div style={{fontSize:10,color:cl.dim,textAlign:"right"}}>
                      {!isCustom&&liveRate&&<span style={{color:cl.teal}}>live</span>}
                      {isCustom&&!isUserAdded&&<span style={{color:cl.amber}}>custom</span>}
                      {isUserAdded&&liveRate&&!isCustom&&<span style={{color:cl.teal}}>added + live</span>}
                      {isUserAdded&&(!liveRate||isCustom)&&<span style={{color:cl.amber}}>added</span>}
                      {!liveRate&&!isCustom&&!isUserAdded&&<span style={{color:cl.dim}}>preset</span>}
                    </div>
                    <div style={{display:"flex",gap:4,justifyContent:"flex-end"}}>
                      {isCustom&&!isUserAdded&&(
                        <div onClick={function(){resetCurrencyOverride(code);}} style={{fontSize:9,cursor:"pointer",padding:"2px 6px",borderRadius:3,background:"rgba(248,113,113,0.15)",color:"#f87171"}}>reset</div>
                      )}
                      {isUserAdded&&(
                        <div style={{display:"flex",gap:4}}>
                          {isCustom&&<div onClick={function(){resetCurrencyOverride(code);}} style={{fontSize:9,cursor:"pointer",padding:"2px 6px",borderRadius:3,background:"rgba(248,113,113,0.1)",color:"#f87171"}}>reset</div>}
                          <div onClick={function(){removeCustomCurrency(code);}} style={{fontSize:9,cursor:"pointer",padding:"2px 6px",borderRadius:3,background:"rgba(248,113,113,0.2)",color:"#f87171",fontWeight:700}}>delete</div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{marginTop:14,paddingTop:12,borderTop:"1px solid rgba(255,255,255,0.08)"}}>
              <div style={{fontSize:11,color:cl.teal,fontWeight:700,marginBottom:8,letterSpacing:1,textTransform:"uppercase"}}>Add custom currency</div>
              <div style={{display:"grid",gridTemplateColumns:"80px 80px 1fr 80px",gap:8,alignItems:"center",marginBottom:6}}>
                <input
                  type="text" maxLength={6} placeholder="Code e.g. XOF"
                  value={customCurrencyForm.code}
                  onChange={function(e){setCustomCurrencyForm(function(prev){return Object.assign({}, prev, {code:e.target.value.toUpperCase()});});}}
                  style={{background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:4,color:"#e8f4f3",padding:"4px 8px",fontSize:12,textTransform:"uppercase"}}
                />
                <input
                  type="text" maxLength={8} placeholder="Symbol"
                  value={customCurrencyForm.symbol}
                  onChange={function(e){setCustomCurrencyForm(function(prev){return Object.assign({}, prev, {symbol:e.target.value});});}}
                  style={{background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:4,color:"#e8f4f3",padding:"4px 8px",fontSize:12}}
                />
                <input
                  type="number" min={0.0001} step={0.001} placeholder="Rate/EUR (optional if API knows it)"
                  value={customCurrencyForm.rate}
                  onChange={function(e){setCustomCurrencyForm(function(prev){return Object.assign({}, prev, {rate:e.target.value});});}}
                  style={{background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:4,color:"#e8f4f3",padding:"4px 8px",fontSize:12,width:"100%"}}
                />
                <div onClick={addCustomCurrency} style={{cursor:"pointer",padding:"5px 10px",borderRadius:5,background:"rgba(125,211,200,0.15)",border:"1px solid rgba(125,211,200,0.3)",color:cl.teal,fontSize:11,fontWeight:700,textAlign:"center"}}>Add</div>
              </div>
              <div style={{fontSize:10,color:"#4a6a74"}}>Code ISO (2-6 chars) + symbol. Rate is optional if the API knows the currency (e.g. BRL, TRY, NGN) -- live rate will be used automatically.</div>
            </div>
            <div style={{marginTop:12,fontSize:10,color:"#4a6a74",lineHeight:1.6}}>
              Edit any rate to override. Click Reset to restore live or preset value. Source: exchangerate-api.com
            </div>
          </div>
        </div>
      )}

      {showReport&&(
        <div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>
          <div style={{background:"linear-gradient(160deg,#0d1f2a,#0a1820)",border:"1px solid rgba(125,211,200,0.2)",borderRadius:14,width:"100%",maxWidth:480,padding:28,boxShadow:"0 32px 80px rgba(0,0,0,0.6)"}}>
            <div style={{fontSize:10,letterSpacing:3,color:cl.teal,fontWeight:700,textTransform:"uppercase",marginBottom:6}}>Export</div>
            <div style={{fontSize:18,fontWeight:800,color:"#e8f4f3",marginBottom:20}}>Generate PDF Report</div>
            <div style={{marginBottom:16}}>
              <Lbl>Project name</Lbl>
              <input value={projectName} onChange={function(e){setProjName(e.target.value);}} placeholder="e.g. Casablanca Tram Line 3 - Phase 2" style={Object.assign({},iS,{fontSize:14})}/>
            </div>
            <div style={{background:"rgba(125,211,200,0.05)",border:"1px solid rgba(125,211,200,0.12)",borderRadius:8,padding:"10px 14px",marginBottom:20,fontSize:12,color:cl.dim,lineHeight:1.7}}>
              The report will include:
              <div style={{marginTop:6,display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                {["Cover page + summary","Project parameters","Results per segment","Wear and RCF charts","Lifecycle cost summary","Strategy comparison notes","Disclaimer and sources"].map(function(item){
                  return <div key={item} style={{fontSize:11,color:cl.teal}}>[ok] {item}</div>;
                })}
              </div>
            </div>
            {!result&&<div style={{fontSize:12,color:cl.warn,marginBottom:12,padding:"6px 10px",background:"rgba(248,113,113,0.08)",borderRadius:6}}>Run the simulation first to include results in the report.</div>}
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn onClick={function(){setShowRpt(false);}} sm={true}>Cancel</Btn>
              <Btn onClick={generatePDF} active={true}>Generate PDF</Btn>
            </div>
          </div>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"360px 1fr",maxWidth:1400,margin:"0 auto",padding:"18px 18px 0"}}>
        <div style={{paddingRight:16}}>

          <Card title="Context">
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {Object.keys(CONTEXTS).map(function(k){return <Btn key={k} onClick={function(){handleContextChange(k);}} active={context===k}>{CONTEXTS[k].label}</Btn>;})}
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
                  <div>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                      <Lbl>Passes/day (one track, one dir.)</Lbl>
                      {tr.weekActive&&<span style={{fontSize:9,color:cl.teal,background:"rgba(125,211,200,0.12)",borderRadius:3,padding:"1px 6px",fontWeight:700}}>FROM PROFILE</span>}
                      {tr.mileageActive&&<span style={{fontSize:9,color:cl.purple,background:"rgba(167,139,250,0.12)",borderRadius:3,padding:"1px 6px",fontWeight:700}}>FROM MILEAGE</span>}
                    </div>
                    <Inp value={(tr.weekActive||tr.mileageActive)?+calcPassesPerDay(tr).toFixed(1):tr.trainsPerDay} onChange={function(v){if(!tr.weekActive&&!tr.mileageActive)updTrain(tr.id,"trainsPerDay",v);}} min={1}/>
                  </div>
                  <div><Lbl>Axle load (t)</Lbl><Inp value={tr.axleLoad} onChange={function(v){updTrain(tr.id,"axleLoad",v);}} min={5} max={35} step={0.5}/></div>
                  <div><Lbl>No. of bogies</Lbl><Inp value={tr.bogies} onChange={function(v){updTrain(tr.id,"bogies",v);}} min={2} max={16}/></div>
                  <div><Lbl>Axles/bogie</Lbl><Inp value={tr.axlesPerBogie} onChange={function(v){updTrain(tr.id,"axlesPerBogie",v);}} min={2} max={4}/></div>
                </div>

                {/* Weekly profile toggle */}
                <div style={{marginTop:8,padding:"8px 10px",background:"rgba(255,255,255,0.02)",borderRadius:6,border:"1px solid "+(tr.weekActive?"rgba(125,211,200,0.2)":"rgba(255,255,255,0.06)")}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:tr.weekActive?10:0}}>
                    <div onClick={function(){
                      var next=!tr.weekActive;
                      updTrain(tr.id,"weekActive",next);
                      if(next) updTrain(tr.id,"mileageActive",false);
                    }} style={{width:28,height:16,borderRadius:8,background:tr.weekActive?cl.teal:"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",flexShrink:0,border:"1px solid "+(tr.weekActive?cl.teal:"rgba(255,255,255,0.2)")}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:tr.weekActive?14:2}}/>
                    </div>
                    <span style={{fontSize:11,color:tr.weekActive?cl.teal:cl.dim,fontWeight:tr.weekActive?600:400}}>Weekly traffic profile</span>
                    {tr.weekActive&&(
                      <span style={{fontSize:11,color:cl.dim,marginLeft:"auto"}}>
                        Equiv: <b style={{color:cl.teal,fontFamily:"monospace"}}>{calcPassesPerDay(tr).toFixed(1)}</b> passes/day
                      </span>
                    )}
                  </div>
                  {tr.weekActive&&(
                    <div>
                      <div style={{display:"grid",gridTemplateColumns:trackMode==="ballast"?"1fr 1fr 1fr 1fr":"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                        <div>
                          <Lbl>Mon - Fri (x5 days)</Lbl>
                          <Inp value={(tr.weekProfile||{weekday:tr.trainsPerDay}).weekday} onChange={function(v){updTrain(tr.id,"weekProfile",Object.assign({},tr.weekProfile,{weekday:v}));}} min={0}/>
                        </div>
                        <div>
                          <Lbl>Saturday (x1 day)</Lbl>
                          <Inp value={(tr.weekProfile||{saturday:tr.trainsPerDay}).saturday} onChange={function(v){updTrain(tr.id,"weekProfile",Object.assign({},tr.weekProfile,{saturday:v}));}} min={0}/>
                        </div>
                        <div>
                          <Lbl>Sunday (x1 day)</Lbl>
                          <Inp value={(tr.weekProfile||{sunday:tr.trainsPerDay}).sunday} onChange={function(v){updTrain(tr.id,"weekProfile",Object.assign({},tr.weekProfile,{sunday:v}));}} min={0}/>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:12,fontSize:11,padding:"6px 10px",background:"rgba(125,211,200,0.05)",borderRadius:6,border:"1px solid rgba(125,211,200,0.1)"}}>
                        <span style={{color:cl.dim}}>Formula: (5 x Mon-Fri + Sat + Sun) / 7</span>
                        <span style={{color:cl.dim}}>= ({5*(tr.weekProfile||{weekday:0}).weekday} + {(tr.weekProfile||{saturday:0}).saturday} + {(tr.weekProfile||{sunday:0}).sunday}) / 7</span>
                        <span style={{color:cl.teal,fontWeight:700}}>= {calcPassesPerDay(tr).toFixed(1)} passes/day</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Mileage profile toggle */}
                <div style={{marginTop:6,padding:"8px 10px",background:"rgba(255,255,255,0.02)",borderRadius:6,border:"1px solid "+(tr.mileageActive?"rgba(167,139,250,0.25)":"rgba(255,255,255,0.06)")}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:tr.mileageActive?10:0}}>
                    <div onClick={function(){
                      var next=!tr.mileageActive;
                      updTrain(tr.id,"mileageActive",next);
                      if(next) updTrain(tr.id,"weekActive",false);
                    }} style={{width:28,height:16,borderRadius:8,background:tr.mileageActive?cl.purple:"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",flexShrink:0,border:"1px solid "+(tr.mileageActive?cl.purple:"rgba(255,255,255,0.2)")}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:tr.mileageActive?14:2}}/>
                    </div>
                    <span style={{fontSize:11,color:tr.mileageActive?cl.purple:cl.dim,fontWeight:tr.mileageActive?600:400}}>From mileage (fleet + km/train/yr)</span>
                    {tr.mileageActive&&(
                      <span style={{fontSize:11,color:cl.dim,marginLeft:"auto"}}>
                        Equiv: <b style={{color:cl.purple,fontFamily:"monospace"}}>{calcPassesPerDay(tr).toFixed(1)}</b> passes/day
                      </span>
                    )}
                  </div>
                  {tr.mileageActive&&(
                    <div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                        <div>
                          <Lbl>Fleet size (trains)</Lbl>
                          <Inp value={(tr.mileageProfile||{fleetSize:10}).fleetSize} onChange={function(v){updTrain(tr.id,"mileageProfile",Object.assign({},tr.mileageProfile,{fleetSize:v}));}} min={1}/>
                        </div>
                        <div>
                          <Lbl>Mileage per train (km/yr)</Lbl>
                          <Inp value={(tr.mileageProfile||{mileagePerTrain:120000}).mileagePerTrain} onChange={function(v){updTrain(tr.id,"mileageProfile",Object.assign({},tr.mileageProfile,{mileagePerTrain:v}));}} min={1000} step={1000}/>
                        </div>
                        <div>
                          <Lbl>Section length (km)</Lbl>
                          <Inp value={(tr.mileageProfile||{sectionKm:10}).sectionKm} onChange={function(v){updTrain(tr.id,"mileageProfile",Object.assign({},tr.mileageProfile,{sectionKm:Math.max(0.1,v)}));}} min={0.1} step={0.1}/>
                        </div>
                      </div>
                      <div style={{fontSize:11,padding:"6px 10px",background:"rgba(167,139,250,0.05)",borderRadius:6,border:"1px solid rgba(167,139,250,0.12)"}}>
                        {(function(){
                          var mp=tr.mileageProfile||{fleetSize:10,mileagePerTrain:120000,sectionKm:10};
                          var totalKmYr=mp.fleetSize*mp.mileagePerTrain;
                          var passesYr=mp.sectionKm>0?totalKmYr/mp.sectionKm:0;
                          var passesDay=passesYr/365;
                          return(
                            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                              <span style={{color:cl.dim}}>Total fleet km/yr: <b style={{color:cl.purple}}>{(totalKmYr/1000).toFixed(0)}k km</b></span>
                              <span style={{color:cl.dim}}>Formula: {mp.fleetSize} x {(mp.mileagePerTrain/1000).toFixed(0)}k / ({mp.sectionKm} x 365)</span>
                              <span style={{color:cl.purple,fontWeight:700}}>= {passesDay.toFixed(1)} passes/day</span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{marginTop:8,fontSize:11,color:cl.dim}}>Gross tonnage: <b style={{color:cl.teal}}>{(tr.axleLoad*tr.bogies*tr.axlesPerBogie).toFixed(0)} t</b> - <b style={{color:cl.teal}}>{((tr.trainsPerDay*tr.axleLoad*tr.bogies*tr.axlesPerBogie*365)/1e6).toFixed(2)} MGT/yr</b></div>
              </div>
            );})}
            <Btn onClick={addTrain} sm={true}>+ Add train type</Btn>
          </Card>


          <Card title="Wear Limits">
            <div style={{marginBottom:8,fontSize:11,color:cl.dim,lineHeight:1.6}}>
              Default limits from context: V={LIMITS[context]&&LIMITS[context].v}mm | L={LIMITS[context]&&LIMITS[context].l}mm (EN 13674 / UIC 714)
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:customLimActive?12:0}}>
              <div onClick={function(){
                setCustomLimActive(function(v){
                  var next=!v;
                  if(next && !customLimV) setCustomLimV(LIMITS[context]&&LIMITS[context].v);
                  if(next && !customLimL) setCustomLimL(LIMITS[context]&&LIMITS[context].l);
                  return next;
                });
              }} style={{width:30,height:17,borderRadius:8,background:customLimActive?cl.teal:"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",flexShrink:0,border:"1px solid "+(customLimActive?cl.teal:"rgba(255,255,255,0.2)")}}>
                <div style={{width:11,height:11,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:customLimActive?15:2}}/>
              </div>
              <span style={{fontSize:12,color:customLimActive?cl.teal:cl.dim,fontWeight:customLimActive?600:400}}>
                Manual wear limits override
              </span>
              {customLimActive&&<span style={{marginLeft:"auto",fontSize:10,color:cl.amber,background:"rgba(251,191,36,0.1)",borderRadius:4,padding:"2px 8px",fontWeight:700}}>CUSTOM</span>}
            </div>
            {customLimActive&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <Lbl>Vertical wear limit (mm)</Lbl>
                  <Inp value={customLimV||""} onChange={function(v){setCustomLimV(+v);}} min={1} max={30} step={0.5}/>
                  <div style={{fontSize:10,color:cl.dim,marginTop:3}}>Default: {LIMITS[context]&&LIMITS[context].v} mm ({context})</div>
                </div>
                <div>
                  <Lbl>Lateral wear limit (mm)</Lbl>
                  <Inp value={customLimL||""} onChange={function(v){setCustomLimL(+v);}} min={1} max={30} step={0.5}/>
                  <div style={{fontSize:10,color:cl.dim,marginTop:3}}>Default: {LIMITS[context]&&LIMITS[context].l} mm ({context})</div>
                </div>
              </div>
            )}
          </Card>


          <Card title="Reserve Thresholds">
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:customResActive?12:0}}>
              <div onClick={function(){setCustomResActive(function(v){return !v;});}}
                style={{width:30,height:17,borderRadius:8,background:customResActive?cl.amber:"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",flexShrink:0,border:"1px solid rgba(255,255,255,0.2)"}}>
                <div style={{width:11,height:11,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:customResActive?15:2}}/>
              </div>
              <span style={{fontSize:12,color:customResActive?cl.amber:cl.dim,fontWeight:customResActive?600:400}}>Override minimum reserve thresholds</span>
              {customResActive&&<span style={{marginLeft:"auto",fontSize:10,color:cl.amber,background:"rgba(251,191,36,0.1)",borderRadius:4,padding:"2px 8px",fontWeight:700}}>CUSTOM</span>}
            </div>
            {customResActive&&(
              <div>
                <Lbl>Minimum reserve threshold (V and L) (mm)</Lbl>
                <Inp value={customMinRes} onChange={function(v){setCustomMinRes(+v);}} min={0.5} max={6} step={0.5}/>
                <div style={{fontSize:10,color:cl.dim,marginTop:4,lineHeight:1.5}}>
                  Applied to both vertical and lateral reserves. Literature default by grade: R200-R320Cr=3.0mm, R350HT-R400HT=3.5-4.0mm (EN 13674-1 / Magel 2017).
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:8,padding:"6px 10px",background:"rgba(251,191,36,0.04)",borderRadius:6,border:"1px solid rgba(251,191,36,0.12)"}}>
                  <div style={{fontSize:10,color:cl.dim}}>Default V reserve (literature):</div>
                  <div style={{fontSize:10,color:cl.text,fontFamily:"monospace"}}>{(MIN_RES_V["R260"]||3.0).toFixed(1)} mm (R260 default)</div>
                  <div style={{fontSize:10,color:cl.dim}}>Default L reserve (literature):</div>
                  <div style={{fontSize:10,color:cl.text,fontFamily:"monospace"}}>{(MIN_RES_L["R260"]||3.0).toFixed(1)} mm (R260 default)</div>
                  <div style={{fontSize:10,color:cl.dim}}>Your override:</div>
                  <div style={{fontSize:10,color:cl.amber,fontFamily:"monospace",fontWeight:700}}>{customMinRes.toFixed(1)} mm (V and L)</div>
                </div>
              </div>
            )}
            {!customResActive&&(
              <div style={{fontSize:10,color:"#4a6a74",lineHeight:1.5}}>
                Using literature values by grade: R200-R260=3.0mm, R320Cr=3.0-3.5mm, R350HT-R400HT=3.5-4.0mm.
              </div>
            )}
          </Card>

          <Card title="Reprofiling Model">
            <div style={{marginBottom:8,fontSize:11,color:cl.dim,lineHeight:1.6}}>Reprofiling restores the full transversal profile -- lateral AND vertical. Triggered when lateral wear reaches the threshold.</div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:reprActive?12:0}}>
              <div onClick={function(){setReprActive(function(v){return !v;});}} style={{width:30,height:17,borderRadius:8,background:reprActive?cl.teal:"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",flexShrink:0,border:reprActive?"1px solid "+cl.teal:"1px solid rgba(255,255,255,0.2)"}}>
                <div style={{width:11,height:11,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:reprActive?15:2}}/>
              </div>
              <span style={{fontSize:12,color:reprActive?cl.teal:cl.dim,fontWeight:reprActive?600:400}}>Enable reprofiling model</span>
              {reprActive&&<span style={{marginLeft:"auto",fontSize:10,color:cl.amber,background:"rgba(251,191,36,0.1)",borderRadius:4,padding:"2px 8px",fontWeight:700}}>ACTIVE</span>}
            </div>
            {reprActive&&(
              <div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  <div>
                    <Lbl>Trigger threshold (% of lateral limit)</Lbl>
                    <Inp value={reprThresh} onChange={function(v){setReprThresh(+v);}} min={30} max={95} step={5}/>
                    <div style={{fontSize:10,color:cl.dim,marginTop:3}}>Currently: {((reprThresh/100)*((customLimActive&&customLimL)||LIMITS[context].l)).toFixed(1)} mm lateral wear</div>
                  </div>
                  <div style={{gridColumn:"1/-1"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                      <div onClick={function(){setReprRadiusBased(function(v){return !v;});}} style={{width:26,height:15,borderRadius:8,background:reprRadiusBased?cl.teal:"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",flexShrink:0,border:"1px solid rgba(255,255,255,0.2)"}}>
                        <div style={{width:9,height:9,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:reprRadiusBased?13:2}}/>
                      </div>
                      <div style={{fontSize:11,color:reprRadiusBased?cl.teal:cl.dim,fontWeight:600}}>Radius-based lateral removal (recommended)</div>
                      {!reprRadiusBased&&<div style={{marginLeft:"auto",fontSize:10,color:cl.amber}}>Global mode</div>}
                    </div>
                    {reprRadiusBased?(
                      <div style={{background:"rgba(0,0,0,0.15)",borderRadius:6,padding:"8px 10px"}}>
                        <div style={{fontSize:10,color:cl.dim,marginBottom:6}}>Lateral removal per reprofiling intervention by radius band:</div>
                        {[["r1","R < 100 m",false],["r2","100 to 200 m",false],["r3","200 to 400 m",false],["r4","400 to 800 m",false],["r5","R >= 800 m",true]].map(function(row){
                          var bid=row[0], blbl=row[1], locked=row[2];
                          return(
                            <div key={bid} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                              <div style={{flex:"0 0 120px",fontSize:11,color:locked?"#3a5a64":cl.text}}>{blbl}</div>
                              {locked?(
                                <div style={{flex:"0 0 60px",padding:"4px 8px",background:"rgba(0,0,0,0.2)",borderRadius:4,fontSize:11,color:"#3a5a64",textAlign:"right"}}>0.0 mm</div>
                              ):(
                                <input type="number" value={reprRemLByBand[bid]||0} min={0} max={8} step={0.5}
                                  onChange={function(e){var v=+e.target.value;setReprRemLByBand(function(prev){var n=Object.assign({},prev);n[bid]=v;return n;});}}
                                  style={Object.assign({},iS,{flex:"0 0 60px",textAlign:"right",padding:"3px 6px"})}/>
                              )}
                              <div style={{fontSize:10,color:"#3a5a64"}}>mm</div>
                              {!locked&&<div style={{fontSize:10,color:"#3a5a64",marginLeft:4}}>{reprRemLByBand[bid]===0?"reprofiling disabled on this band":""}</div>}
                            </div>
                          );
                        })}
                      </div>
                    ):(
                      <div>
                        <Lbl>Lateral removal per intervention (mm) -- global</Lbl>
                        <Inp value={reprRemL} onChange={function(v){setReprRemL(+v);}} min={0} max={8} step={0.5}/>
                        <div style={{fontSize:10,color:cl.dim,marginTop:3}}>Applied to all segments regardless of radius</div>
                      </div>
                    )}
                  </div>
                  <div>
                    <Lbl>Vertical removal per intervention (mm)</Lbl>
                    <div style={{padding:"6px 10px",background:"rgba(0,0,0,0.2)",borderRadius:6,fontSize:11,fontFamily:"monospace",color:cl.teal}}>
                      {reprRadiusBased?(
                        <span>By band: r1={((reprRemLByBand.r1||0)*0.30).toFixed(2)} / r2={((reprRemLByBand.r2||0)*0.30).toFixed(2)} / r3={((reprRemLByBand.r3||0)*0.30).toFixed(2)} / r4={((reprRemLByBand.r4||0)*0.30).toFixed(2)} mm</span>
                      ):(
                        <span>{(reprRemL*0.30).toFixed(2)} mm (= lateral x 0.30)</span>
                      )}
                    </div>
                    <div style={{fontSize:10,color:"#4a6a74",marginTop:3}}>Auto-computed: reprRemV = reprRemL x 0.30 (Speno TB-2019-04)</div>
                  </div>
                  <div>
                    <Lbl>RCF reduction per intervention (%)</Lbl>
                    <Inp value={reprRcfR} onChange={function(v){setReprRcfR(+v);}} min={10} max={80} step={5}/>
                    <div style={{fontSize:10,color:cl.dim,marginTop:3}}>Crown reprofile removes ratchetted layer</div>
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"rgba(125,211,200,0.04)",borderRadius:6,border:"1px solid rgba(125,211,200,0.12)"}}>
                  <div onClick={function(){setReprSkip(function(v){return !v;});}} style={{width:26,height:15,borderRadius:8,background:reprSkip?cl.teal:"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",flexShrink:0,border:reprSkip?"1px solid "+cl.teal:"1px solid rgba(255,255,255,0.2)"}}>
                    <div style={{width:9,height:9,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:reprSkip?13:2}}/>
                  </div>
                  <div>
                    <div style={{fontSize:11,color:reprSkip?cl.teal:cl.dim,fontWeight:reprSkip?600:400}}>Skip next grinding pass after reprofiling</div>
                    <div style={{fontSize:10,color:"#4a6a74"}}>Crown already restored -- avoids double reserve consumption (recommended)</div>
                  </div>
                </div>
              </div>
            )}
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
                      <div><Lbl>Speed (km/h)</Lbl><Inp value={seg.speed||getRecommendedSegmentSpeed(seg, context, speed)} onChange={function(v){updSeg(seg.id,"speed",+v);}} min={20} max={320}/></div>
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{fontSize:10,color:"#4a6a74",marginTop:6}}>Default: R400HT (R&lt;100m) / R350HT (100-200m) / R320Cr (200-800m) / R260 (tangent)</div>
          </Card>

          <Card title="Rail Parameters">
            <div style={{display:"grid",gap:10}}>
              <div><Lbl>Rail Type</Lbl><Sel value={railType} onChange={handleRailTypeChange} opts={Object.keys(RAIL_TYPES).filter(function(k){return !(context==="heavy"&&k==="groove");}).map(function(k){return {v:k,l:RAIL_TYPES[k].label};})}/></div>
              <div><Lbl>Track Form</Lbl><Sel value={trackMode} onChange={handleTrackModeChange} opts={Object.keys(TRACK_MODES).filter(function(k){return !(context==="heavy"&&k==="embedded");}).map(function(k){return {v:k,l:TRACK_MODES[k].label};})}/></div>
              <div><Lbl>Line speed (km/h)</Lbl><Inp value={speed} onChange={setSp} min={20} max={320}/></div>
              <div>
                <Lbl>Flange Lubrication</Lbl>
                <Sel value={lubr} onChange={setLb} opts={Object.keys(LUBRICATION).map(function(k){return {v:k,l:LUBRICATION[k].label};})}/>
                <div style={{fontSize:11,color:cl.dim,marginTop:5}}>{lubr==="none"&&"No lateral wear reduction - dry conditions"}{lubr==="poor"&&"Badly maintained - low reduction"}{lubr==="standard"&&"Correctly adjusted wayside - significant reduction on tight curves"}{lubr==="good"&&"Wayside and onboard combined - good coverage"}{lubr==="optimal"&&"Lab conditions only - unrealistic in revenue service"}</div>
              </div>
              {context==="heavy"&&<div style={{fontSize:11,color:cl.dim,background:"rgba(125,211,200,0.05)",borderRadius:6,padding:"8px 10px",border:"1px solid rgba(125,211,200,0.1)"}}>Heavy rail is currently restricted to Vignole rail with Ballasted or Slab track.</div>}
              {context==="metro"&&(railType==="groove"||trackMode==="embedded")&&<div style={{fontSize:11,color:cl.amber,background:"rgba(251,191,36,0.08)",borderRadius:6,padding:"8px 10px",border:"1px solid rgba(251,191,36,0.18)"}}>Atypical metro configuration. Use groove rail or embedded track only for special urban or depot cases.</div>}
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
                  var lim=Object.assign({},LIMITS[context],customLimActive&&customLimV?{v:customLimV}:{},customLimActive&&customLimL?{l:customLimL}:{});
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

          <Card title="Special Zones (Stations, Corrugation)">
            <div style={{fontSize:11,color:cl.dim,marginBottom:10,lineHeight:1.6}}>Add station braking/acceleration zones, terminus areas, or transition zones. Each is simulated as an independent segment with an enhanced vertical wear factor.</div>
            {specialZones.map(function(z){
              var zt = SPECIAL_ZONE_TYPES[z.type] || SPECIAL_ZONE_TYPES.braking;
              return (
                <div key={z.id} style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"12px",marginBottom:10,border:"1px solid rgba(255,255,255,0.08)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:11,fontWeight:700,color:cl.amber,background:"rgba(251,191,36,0.15)",borderRadius:4,padding:"2px 7px"}}>{zt.icon}</span>
                      <input value={z.name} onChange={function(e){setSpZ(function(a){return a.map(function(x){return x.id===z.id?Object.assign({},x,{name:e.target.value}):x;});});}} style={Object.assign({},iS,{width:160,fontSize:12})}/>
                    </div>
                    <button onClick={function(){setSpZ(function(a){return a.filter(function(x){return x.id!==z.id;});});}} style={{background:"none",border:"none",color:cl.warn,cursor:"pointer",fontSize:16}}>x</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                    <div>
                      <Lbl>Zone type</Lbl>
                      <Sel value={z.type} onChange={function(v){setSpZ(function(a){return a.map(function(x){return x.id===z.id?Object.assign({},x,{type:v,fVExtra:SPECIAL_ZONE_TYPES[v].fVExtra,corrMGT:SPECIAL_ZONE_TYPES[v].corrMGT,speed:getSpecialZoneDefaultSpeed(v, speed)}):x;});});}} opts={Object.keys(SPECIAL_ZONE_TYPES).map(function(k){return {v:k,l:SPECIAL_ZONE_TYPES[k].label};})}/>
                    </div>
                    <div>
                      <Lbl>Rail grade</Lbl>
                      <Sel value={z.grade} onChange={function(v){setSpZ(function(a){return a.map(function(x){return x.id===z.id?Object.assign({},x,{grade:v}):x;});});}} opts={Object.keys(RAIL_GRADES).map(function(k){return {v:k,l:k};})}/>
                    </div>
                    <div>
                      <Lbl>Speed (km/h)</Lbl>
                      <Inp value={z.speed||getSpecialZoneDefaultSpeed(z.type, speed)} onChange={function(v){setSpZ(function(a){return a.map(function(x){return x.id===z.id?Object.assign({},x,{speed:+v}):x;});});}} min={20} max={320}/>
                    </div>
                    <div>
                      <Lbl>Zone length (m)</Lbl>
                      <Inp value={z.lengthM} onChange={function(v){setSpZ(function(a){return a.map(function(x){return x.id===z.id?Object.assign({},x,{lengthM:v}):x;});});}} min={10} max={500} step={10}/>
                    </div>
                    <div>
                      <Lbl>Radius (m, or 9000=tangent)</Lbl>
                      <Inp value={z.radius} onChange={function(v){setSpZ(function(a){return a.map(function(x){return x.id===z.id?Object.assign({},x,{radius:v}):x;});});}} min={50} max={9000}/>
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div>
                      <Lbl>{"Wear factor f_V (preset: x"+zt.fVExtra.toFixed(1)+" for "+z.type+")"}</Lbl>
                      <Inp value={z.fVExtra} onChange={function(v){setSpZ(function(a){return a.map(function(x){return x.id===z.id?Object.assign({},x,{fVExtra:Math.max(zt.fVRange[0],Math.min(zt.fVRange[1],v))}):x;});});}} min={zt.fVRange[0]} max={zt.fVRange[1]} step={0.1}/>
                      <div style={{fontSize:10,color:cl.dim,marginTop:3}}>Range for this zone type: x{zt.fVRange[0]} to x{zt.fVRange[1]}</div>
                    </div>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                        <div onClick={function(){setSpZ(function(a){return a.map(function(x){return x.id===z.id?Object.assign({},x,{corrugation:!x.corrugation}):x;});});}} style={{width:26,height:15,borderRadius:8,background:z.corrugation?cl.amber:"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",border:"1px solid "+(z.corrugation?cl.amber:"rgba(255,255,255,0.2)")}}>
                          <div style={{width:9,height:9,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:z.corrugation?13:2}}/>
                        </div>
                        <span style={{fontSize:11,color:z.corrugation?cl.amber:cl.dim}}>Corrugation risk</span>
                      </div>
                      {z.corrugation && (
                        <div>
                          <Lbl>Grinding interval (MGT)</Lbl>
                          <Inp value={z.corrMGT} onChange={function(v){setSpZ(function(a){return a.map(function(x){return x.id===z.id?Object.assign({},x,{corrMGT:Math.max(1,v)}):x;});});}} min={1} max={50} step={0.5}/>
                          <div style={{fontSize:10,color:cl.amber,marginTop:3}}>Sets the preventive interval and also adds a corrective corrugation trigger on this special zone. Preset: {zt.corrMGT} MGT</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <Btn onClick={function(){
              var newId = "sz_"+Date.now();
              var defType = "braking";
              setSpZ(function(a){return a.concat([{id:newId,name:"Station zone "+(a.length+1),type:defType,lengthM:100,radius:9000,speed:getSpecialZoneDefaultSpeed(defType, speed),grade:"R260",fVExtra:SPECIAL_ZONE_TYPES[defType].fVExtra,corrugation:false,corrMGT:SPECIAL_ZONE_TYPES[defType].corrMGT}]);});
            }} sm={true}>+ Add special zone</Btn>
            {specialZones.length>0&&<div style={{fontSize:10,color:"#4a6a74",marginTop:8}}>Special zones appear as additional segments in the simulation results, clearly labelled with their zone type badge.</div>}
          </Card>

          <Card title="Maintenance Strategy">
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <Btn onClick={function(){setSt("preventive");}} active={strategy==="preventive"}>Preventive</Btn>
              <Btn onClick={function(){setSt("corrective");}} active={strategy==="corrective"}>Corrective</Btn>
            </div>
            <div style={{fontSize:12,color:cl.dim,lineHeight:1.6}}>{strategy==="preventive"?"Frequent grinding (short intervals). 1 light pass ~0.2mm. RCF kept low. Maximum rail life.":"Condition-based corrective grinding. Tram/metro trigger on vertical wear and/or RCF; heavy rail also uses band-based early RCF triggers. Up to 4 heavy passes depending on severity."}</div>
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
                <Kpi label="Total grindings" value={result.results.reduce(function(a,r){return a+r.gCount;},0)} unit="passes"/>{reprActive&&<Kpi label="Total reprofiling" value={result.results.reduce(function(a,r){return a+(r.reprCount||0);},0)} unit="interventions" warn={true}/>}
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
                    <Kpi label="Grindings"   value={asr.gCount} unit="passes"/>{reprActive&&<Kpi label="Reprofiling" value={asr.reprCount||0} unit="operations" warn={true}/>}{asr.data&&asr.data.length>0&&<Kpi label="V reserve left" value={(asr.data[asr.data.length-1].res||0).toFixed(1)} unit="mm"/>}{reprActive&&asr.data&&asr.data.length>0&&<Kpi label="L reserve left" value={(asr.data[asr.data.length-1].resL||0).toFixed(1)} unit="mm"/>}
                  </div>
                  <div style={{display:"flex",gap:6,marginBottom:12}}>
                    {[["wear","Wear V and L"],["rcf","RCF Index"],["reserve","Metal Reserve"],["plan","Schedule"],["cost","Replacement Cost"],["grind","Grinding Cost"],["repr","Reprofiling Cost"],["tamp","Ballast Tamping"],["tcost","Tamping Cost"],["cmp","Strategy Comparison"]].map(function(item){return <Btn key={item[0]} onClick={function(){setCt(item[0]);}} active={ctab===item[0]} sm={true}>{item[1]}</Btn>;})}
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
                        <div style={{fontSize:12,color:cl.dim,marginBottom:4}}>
                          Grindable metal reserve (mm)
                          <span style={{marginLeft:16,color:cl.purple}}>-- Vertical (crown)</span>
                          {reprActive&&<span style={{marginLeft:16,color:"#38bdf8"}}>-- Lateral (gauge face)</span>}
                          <span style={{marginLeft:16,color:cl.warn,fontSize:10}}>- - min reserve threshold</span>
                        </div>
                        <ResponsiveContainer width="100%" height={250}>
                          <LineChart data={asr.data}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                            <XAxis dataKey="year" stroke="#4a6a74" tick={{fontSize:11}}/>
                            <YAxis stroke="#4a6a74" tick={{fontSize:11}} unit=" mm"/>
                            <Tooltip content={<Tip/>}/>
                            <Legend wrapperStyle={{fontSize:11}}/>
                            {(function(){var g=asr&&asr.seg?(asr.seg.railGrade||asr.seg.grade||"R260"):"R260";var mv=customResActive?(customMinRes||3.0):(MIN_RES_V[g]||3.0);return <ReferenceLine y={mv} stroke={cl.warn} strokeDasharray="4 4" label={{value:"Min V "+mv.toFixed(1)+"mm",fill:cl.warn,fontSize:9}}/>;})()}
                            {reprActive&&(function(){var g=asr&&asr.seg?(asr.seg.railGrade||asr.seg.grade||"R260"):"R260";var ml=customResActive?(customMinRes||3.0):(MIN_RES_L[g]||3.0);return <ReferenceLine y={ml} stroke="#38bdf8" strokeDasharray="4 4" label={{value:"Min L "+ml.toFixed(1)+"mm",fill:"#38bdf8",fontSize:9}}/>;})()}
                            <Line type="monotone" dataKey="res"  name="Vertical reserve (mm)" stroke={cl.purple} strokeWidth={2} dot={false}/>
                            {reprActive&&<Line type="monotone" dataKey="resL" name="Lateral reserve (mm)" stroke="#38bdf8" strokeWidth={2} dot={false} strokeDasharray="5 3"/>}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    {ctab==="plan"&&(
                      <div>
                        <div style={{fontSize:12,color:cl.dim,marginBottom:12}}>Maintenance schedule -- Grinding (green){reprActive?" | Reprofiling (amber)":""} | Replacement (red)</div>
                        <ResponsiveContainer width="100%" height={250}>
                          <BarChart data={asr.data}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                            <XAxis dataKey="year" stroke="#4a6a74" tick={{fontSize:11}}/>
                            <YAxis stroke="#4a6a74" tick={{fontSize:11}}/>
                            <Tooltip content={<Tip/>}/><Legend wrapperStyle={{fontSize:12}}/>
                            <Bar dataKey="ground"     name="Grinding"     fill={cl.green} opacity={0.8} radius={[2,2,0,0]}/>
                            {reprActive&&<Bar dataKey="reprofiled" name="Reprofiling" fill={cl.amber} opacity={0.85} radius={[2,2,0,0]}/>}
                            <Bar dataKey="repl"       name="Replacement"  fill={cl.warn}  opacity={0.9} radius={[2,2,0,0]}/>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    {ctab==="cost"&&<CostPanel simResult={result} horizon={horizon} initRegion={replRegion} initOvhdPct={replOvhdPct} initWeldType={replWeldType} initJointSp={replJointSp} initCurrency={sharedCurrency} onCurrencyChange={setSharedCur} ratesStatus={ratesStatus} onShowRates={function(){setShowRatesPop(true);}} currencyMap={currencyMap} currencyOptions={currencyOptions} onParamsChange={function(p){if(p.region!==undefined)setReplRegion(p.region);if(p.ovhdPct!==undefined)setReplOvhd(p.ovhdPct);if(p.weldType!==undefined)setReplWeld(p.weldType);if(p.jointSp!==undefined)setReplJoint(p.jointSp);if(p.customP!==undefined)setReplCustomP(p.customP);}}/>}
                    {ctab==="grind"&&<GrindPanel simResult={result} horizon={horizon} context={context} initMachine={grindMachine} initMode={grindMode} initRegion={grindRegion} initNight={grindNight} initDist={grindDistKm} initCurrency={sharedCurrency} onCurrencyChange={setSharedCur} ratesStatus={ratesStatus} onShowRates={function(){setShowRatesPop(true);}} currencyMap={currencyMap} currencyOptions={currencyOptions} onParamsChange={function(p){
                      setGMachine(p.machineKey); setGMode(p.mode); setGRegion(p.region);
                      setGNight(p.nightHrs); setGDist(p.distKm);
                      if(p.mobilPerInt!==undefined) setGMobil(p.mobilPerInt);
                      // Custom rate overrides  - null means reset to preset
                      setGCOp(p.cOpPerMl  !== undefined ? p.cOpPerMl  : null);
                      setGCMF(p.cMobilFix !== undefined ? p.cMobilFix : null);
                      setGCMK(p.cMobilKm  !== undefined ? p.cMobilKm  : null);
                    }}/>}
                    {ctab==="repr"&&<ReprofilingCostPanel simResult={result} horizon={horizon} context={context} initMachine={grindMachine} initRegion={grindRegion} initCurrency={sharedCurrency} onCurrencyChange={setSharedCur} ratesStatus={ratesStatus} onShowRates={function(){setShowRatesPop(true);}} currencyMap={currencyMap} currencyOptions={currencyOptions} reprActive={reprActive}/>}
                     {ctab==="tamp"&&trackMode==="ballast"&&result&&<BallastPanel segs={result.results.map(function(r){return r.seg;})} result={result} horizon={horizon} context={context} globalSpeed={speed} platform={tPlatform} onPlatformChange={setTPlatform} appoint={tAppoint} onAppointChange={setTAppoint} degCycles={tDegCycles} onDegCyclesChange={setTDegCycles} ballastDens={tBallastDens} onBallastDensChange={setTBallastDens} aidx={aidx} onSegSelect={setAi}/>}
                    {ctab==="tamp"&&trackMode==="ballast"&&!result&&<div style={{padding:40,textAlign:"center",color:"#6b9ea8",fontSize:13}}>Run the simulation first to see the tamping schedule.</div>}
                    {ctab==="tamp"&&trackMode!=="ballast"&&<div style={{padding:40,textAlign:"center",color:"#fbbf24",fontSize:13}}>Ballast Tamping is only available for ballast track.</div>}
                    {ctab==="tcost"&&trackMode==="ballast"&&result&&<TampingCostPanel segs={result.results.map(function(r){return r.seg;})} result={result} horizon={horizon} context={context} platform={tPlatform} appoint={tAppoint} degCycles={tDegCycles} globalSpeed={speed} currencyMap={currencyMap} currency={sharedCurrency} initMachine={tcMachineKey} initMode={tcMode} initRegion={tcRegion} initNight={tcNight} initBallastPxOv={tcBallastPxOv} initCOpPerMl={tcCOpPerMl} initCMobilFix={tcCMobilFix} initCDegarnMl={tcCDegarnMl} initOwnManual={tcOwnManual} initOwnFuelLph={tcOwnFuelLph} initOwnGasoil={tcOwnGasoil} initOwnMaintH={tcOwnMaintH} initOwnLabourH={tcOwnLabourH} initOwnProdMlH={tcOwnProdMlH} onParamsChange={function(p){ if(p.machineKey!==undefined) setTCMachine(p.machineKey); if(p.mode!==undefined) setTCMode(p.mode); if(p.region!==undefined) setTCRegion(p.region); if(p.nightHrs!==undefined) setTCNight(p.nightHrs); if(p.ballastPxOv!==undefined) setTCBallPx(p.ballastPxOv); if(p.cOpPerMl!==undefined) setTCCOp(p.cOpPerMl); if(p.cMobilFix!==undefined) setTCCMF(p.cMobilFix); if(p.cDegarnMl!==undefined) setTCCDeg(p.cDegarnMl); if(p.ownManual!==undefined) setTCOwnManual(p.ownManual); if(p.ownFuelLph!==undefined) setTCOwnFuel(p.ownFuelLph); if(p.ownGasoil!==undefined) setTCOwnGasoil(p.ownGasoil); if(p.ownMaintH!==undefined) setTCOwnMaint(p.ownMaintH); if(p.ownLabourH!==undefined) setTCOwnLab(p.ownLabourH); if(p.ownProdMlH!==undefined) setTCOwnProd(p.ownProdMlH); }}/>}
                    {ctab==="tcost"&&trackMode==="ballast"&&!result&&<div style={{padding:40,textAlign:"center",color:"#6b9ea8",fontSize:13}}>Run the simulation first to see tamping costs.</div>}
                    {ctab==="tcost"&&trackMode!=="ballast"&&<div style={{padding:40,textAlign:"center",color:"#fbbf24",fontSize:13}}>Tamping Cost is only available for ballast track.</div>}
                    {ctab==="cmp"&&<ComparePanel simResult={result} horizon={horizon} context={context} params={{context:context,trains:trains,segments:segs.filter(function(s){return s.active&&s.lengthKm>0;}).map(function(s){var b=Object.assign({},s,{radius:s.repr,railGrade:s.grade});if(isBF&&initCond[s.id]){var ic=initCond[s.id];b.initWearV=ic.wearV||0;b.initWearL=ic.wearL||0;b.initRCF=ic.rcf||0;b.initMGT=ic.mgt||0;}return b;}).concat(specialZones.filter(function(z){return z.lengthM>0;}).map(function(z){return {id:z.id,label:z.name,radius:z.radius||9000,railGrade:z.grade||"R260",lengthKm:z.lengthM/1000,speed:z.speed||speed,fVExtra:z.fVExtra,corrugationMGT:z.corrugation?z.corrMGT:null,isSpecialZone:true,zoneType:z.type};})),strategy:strategy,railType:railType,trackMode:trackMode,speed:speed,lubrication:lubr,horizonYears:horizon,customLimV:customLimActive?customLimV:null,customLimL:customLimActive?customLimL:null,customResActive:customResActive,customMinRes:customMinRes}} grindEurPerMl={liveGrindRate} replEurPerMl={liveReplRate} grindCostParams={liveGrindCost} calcReplRate={calcReplRateForGrade} currency={sharedCurrency} currencyMap={currencyMap} reprActive={reprActive} reprThresh={reprThresh} reprRemL={reprRemL} reprRemV={reprRemV} reprRcfR={reprRcfR} reprSkip={reprSkip} reprRadiusBased={reprRadiusBased} reprRemLByBand={reprRemLByBand} liveReprRate={liveReprRate} liveReprMobil={liveReprMobil}/>}
                  </div>
                  <div style={{background:"rgba(0,0,0,0.15)",borderRadius:10,border:"1px solid rgba(125,211,200,0.08)",overflow:"hidden"}}>
                    <div style={{padding:"12px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:11,letterSpacing:2,color:cl.teal,textTransform:"uppercase",fontWeight:700}}>Summary - All Segments</div>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                        <thead><tr style={{background:"rgba(255,255,255,0.03)"}}>{["Segment","Radius","Grade","Eff.Hardness","Wear rate V","Wear rate L","Grindings","Tamping","Degarnissage","Reprofiling","Replacement","Final RCF"].map(function(h){return <th key={h} style={{padding:"8px 12px",textAlign:"left",color:cl.dim,fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>;})}</tr></thead>
                        <tbody>
                          {result.results.map(function(r,i){var last=r.data[r.data.length-1]; var tsm=tampSummaryById[r.seg.id]; return(
                            <tr key={i} onClick={function(){setAi(i);}} style={{borderTop:"1px solid rgba(255,255,255,0.04)",cursor:"pointer",background:aidx===i?"rgba(125,211,200,0.05)":"transparent"}}>
                              <td style={{padding:"8px 12px",color:"#e8f4f3",fontWeight:500}}>{r.seg.label}</td>
                              <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{r.seg.radius>=9000?"tangent":r.seg.radius+"m"}</td>
                              <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.purple}}>{r.seg.grade||r.seg.railGrade}</td>
                              <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.amber}}>{r.he?r.he.toFixed(2):"-"}</td>
                              <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.teal}}>{r.wrV.toFixed(3)}</td>
                              <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.amber}}>{r.wrL.toFixed(3)}</td>
                              <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{r.gCount}</td>
                              <td style={{padding:"8px 12px",fontFamily:"monospace",color:trackMode==="ballast"?cl.teal:cl.dim}}>{trackMode==="ballast"&&tsm?tsm.nTamp:"-"}</td>
                              <td style={{padding:"8px 12px",fontFamily:"monospace",color:trackMode==="ballast"&&tsm&&tsm.nDegarn>0?cl.warn:cl.dim}}>{trackMode==="ballast"&&tsm?tsm.nDegarn:"-"}</td>
                              <td style={{padding:"8px 12px",fontFamily:"monospace",color:reprActive?cl.amber:cl.dim}}>{r.reprCount||0}{reprActive&&r.reprCount>0?" reprofiling":""}</td>
                              <td style={{padding:"8px 12px"}}>{r.repY?<span style={{color:cl.warn,fontWeight:700}}>Yr {r.repY}</span>:<span style={{color:cl.green}}>&gt; {horizon} yrs</span>}</td>
                              <td style={{padding:"8px 12px"}}>{last&&<RCFBadge v={last.rcf}/>}</td>
                            </tr>
                          );})}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Full horizon summary table */}
                  <div style={{background:"rgba(0,0,0,0.15)",borderRadius:10,border:"1px solid rgba(125,211,200,0.1)",marginTop:12}}>
                    <div style={{padding:"12px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontSize:11,letterSpacing:2,color:cl.teal,textTransform:"uppercase",fontWeight:700}}>Summary - All segments (full {horizon}-year horizon)</div>
                      <div style={{fontSize:10,color:cl.dim}}>Strategy: <b style={{color:cl.text}}>{strategy==="preventive"?"Preventive":"Corrective"}</b> -- compare with same column in Strategy Comparison</div>
                    </div>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                        <thead><tr style={{background:"rgba(0,0,0,0.2)"}}>{["Segment","Grade","Replacements","Total grindings","Grind cost","Repl. cost","Reprofiling cost","Tamping / Degarn. cost","Lifecycle total"].map(function(h){return <th key={h} style={{padding:"8px 12px",textAlign:"left",color:cl.teal,fontWeight:600,fontSize:10,letterSpacing:1}}>{h}</th>;})}</tr></thead>
                        <tbody>
                          {result.results.map(function(r,i){
                            var lenMl=(r.seg.lengthKm||0)*1000;
                            var passes=r.data?r.data.reduce(function(a,d){return a+d.ground;},0):0;
                            var grade=r.seg.grade||r.seg.railGrade||"R260";
                            var gFx=(currencyMap[sharedCurrency]||currencyMap.EUR||CURRENCIES.EUR).rate;
                            var gSym=(currencyMap[sharedCurrency]||currencyMap.EUR||CURRENCIES.EUR).symbol;
                            var gOp=lenMl*passes*liveGrindCost.perMl*gFx;
                            var gMob=liveGrindCost.mobilCostPerInt>0?(liveGrindCost.mobilPerInt?liveGrindCost.mobilCostPerInt*passes*gFx:liveGrindCost.mobilCostPerInt*gFx):0;
                            var gCyc=gOp+gMob;
                            var rCyc=r.repY?lenMl*calcReplRateForGrade(grade)*gFx:0;
                            var reprOpPerInt=reprActive?lenMl*(liveReprRate||0)*gFx:0;
                            var reprMobPerInt=reprActive?(liveReprMobil||0)*gFx:0;
                            var reprCostPerInt=reprOpPerInt+reprMobPerInt;
                            var reprCyc=reprActive&&(r.reprCount||0)>0?reprCostPerInt*(r.reprCount||0):0;
                            var tsm=tampSummaryById[r.seg.id];
                            var totTamp=trackMode==="ballast"&&tsm?tsm.totalCost:0;
                            var repls=0,totG=0,totR=0,totRepr=0,totP=0,yr=0;
                            if(r.repY){var cl2=r.repY;while(yr+cl2<=horizon){yr+=cl2;repls++;totG+=gCyc;totR+=rCyc;totRepr+=reprCyc;totP+=passes;}var frac=(horizon-yr)/cl2;if(frac>0){totG+=gCyc*frac;totRepr+=reprCyc*frac;totP+=Math.round(passes*frac);}}
                            else{totG=gCyc;totRepr=reprCyc;totP=passes;}
                            var tot=totG+totR+totRepr+totTamp;
                            function fmtC(v){return v>=1e6?(v/1e6).toFixed(2)+"M "+gSym:v>=1e3?(v/1e3).toFixed(1)+"k "+gSym:v.toFixed(0)+" "+gSym;}
                            return(
                              <tr key={i} onClick={function(){setAi(i);}} style={{borderTop:"1px solid rgba(255,255,255,0.04)",cursor:"pointer",background:i%2===0?"rgba(125,211,200,0.02)":"transparent"}}>
                                <td style={{padding:"8px 12px",color:"#e8f4f3",fontWeight:500}}>{r.seg.label}</td>
                                <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.purple}}>{grade}</td>
                                <td style={{padding:"8px 12px",fontFamily:"monospace",color:repls>0?cl.warn:cl.dim,fontWeight:700}}>{repls>0?repls+" repl.":"none"}</td>
                                <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{totP} passes</td>
                                <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{fmtC(totG)}</td>
                                <td style={{padding:"8px 12px",fontFamily:"monospace"}}>{totR>0?fmtC(totR):"-"}</td>
                                <td style={{padding:"8px 12px",fontFamily:"monospace",color:reprActive&&totRepr>0?cl.amber:cl.dim}}>{reprActive&&totRepr>0?fmtC(totRepr):"-"}</td>
                                <td style={{padding:"8px 12px",fontFamily:"monospace",color:trackMode==="ballast"&&totTamp>0?cl.warn:cl.dim}}>{trackMode==="ballast"?fmtC(totTamp):"-"}</td>
                                <td style={{padding:"8px 12px",fontFamily:"monospace",color:cl.teal,fontWeight:700}}>{fmtC(tot)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{borderTop:"2px solid rgba(125,211,200,0.2)",background:"rgba(125,211,200,0.05)"}}>
                            {(function(){
                              var tR=0,tP=0,tG=0,tRp=0,tRepr=0,tTamp=0,tT=0;
                              var gFx2=(currencyMap[sharedCurrency]||currencyMap.EUR||CURRENCIES.EUR).rate;
                              var gSym2=(currencyMap[sharedCurrency]||currencyMap.EUR||CURRENCIES.EUR).symbol;
                              result.results.forEach(function(r){
                                var lenMl=(r.seg.lengthKm||0)*1000;
                                var passes=r.data?r.data.reduce(function(a,d){return a+d.ground;},0):0;
                                var grade=r.seg.grade||r.seg.railGrade||"R260";
                                var gOp=lenMl*passes*liveGrindCost.perMl*gFx2;
                                var gMob=liveGrindCost.mobilCostPerInt>0?(liveGrindCost.mobilPerInt?liveGrindCost.mobilCostPerInt*passes*gFx2:liveGrindCost.mobilCostPerInt*gFx2):0;
                                var gCyc=gOp+gMob;
                                var rCyc=r.repY?lenMl*calcReplRateForGrade(grade)*gFx2:0;
                                var repls=0,g=0,rp=0,tp=0,yr=0;
                                 var reprOpC2=reprActive?lenMl*(liveReprRate||0)*gFx2:0;
                                 var reprMobC2=reprActive?(liveReprMobil||0)*gFx2:0;
                                 var reprC2=reprOpC2+reprMobC2;
                                if(r.repY){var cl2=r.repY;var rpr=0;while(yr+cl2<=horizon){yr+=cl2;repls++;g+=gCyc;rp+=rCyc;rpr+=reprC2*(r.reprCount||0);tp+=passes;}var frac=(horizon-yr)/cl2;if(frac>0){g+=gCyc*frac;rpr+=reprC2*(r.reprCount||0)*frac;tp+=Math.round(passes*frac);}}
                                else{g=gCyc;rpr=reprC2*(r.reprCount||0);tp=passes;}
                                 var rRepr=reprActive?rpr:0;
                                var tsm=tampSummaryById[r.seg.id];
                                var segTamp=trackMode==="ballast"&&tsm?tsm.totalCost:0;
                                tR+=repls;tP+=tp;tG+=g;tRp+=rp;tRepr+=rRepr;tTamp+=segTamp;tT+=g+rp+rRepr+segTamp;
                              });
                              function fmtC(v){return v>=1e6?(v/1e6).toFixed(2)+"M "+gSym2:v>=1e3?(v/1e3).toFixed(1)+"k "+gSym2:v.toFixed(0)+" "+gSym2;}
                              return [
                                <td key="l" colSpan={2} style={{padding:"9px 12px",color:cl.teal,fontWeight:700,fontSize:12}}>TOTAL {horizon} YEARS</td>,
                                <td key="r" style={{padding:"9px 12px",fontFamily:"monospace",color:cl.warn,fontWeight:700}}>{tR} repls</td>,
                                <td key="p" style={{padding:"9px 12px",fontFamily:"monospace"}}>{tP} passes</td>,
                                <td key="g" style={{padding:"9px 12px",fontFamily:"monospace",fontWeight:700}}>{fmtC(tG)}</td>,
                                <td key="rp" style={{padding:"9px 12px",fontFamily:"monospace",fontWeight:700}}>{fmtC(tRp)}</td>,
                                <td key="repr" style={{padding:"9px 12px",fontFamily:"monospace",fontWeight:700,color:reprActive?cl.amber:cl.dim}}>{reprActive?fmtC(tRepr):"-"}</td>,
                                <td key="tamp" style={{padding:"9px 12px",fontFamily:"monospace",fontWeight:700,color:trackMode==="ballast"?cl.warn:cl.dim}}>{trackMode==="ballast"?fmtC(tTamp):"-"}</td>,
                                <td key="t" style={{padding:"9px 12px",fontFamily:"monospace",color:cl.teal,fontWeight:800,fontSize:13}}>{fmtC(tT)}</td>,
                              ];
                            })()}
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <div style={{padding:"8px 16px",fontSize:10,color:"#4a6a74"}}>
                    <div style={{padding:"8px 16px",fontSize:10,color:"#4a6a74"}}>Greenfield at each replacement. Rates: {liveGrindCost.perMl.toFixed(0)} EUR/ml/pass op.{liveGrindCost.mobilCostPerInt>0?" + "+Math.round(liveGrindCost.mobilCostPerInt)+" EUR mobil":""} | {liveReplRate.toFixed(0)} EUR/ml replacement. Partial final cycle prorated.</div>
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
