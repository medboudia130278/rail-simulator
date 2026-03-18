import { useState, useCallback, useMemo } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Area, AreaChart } from "recharts";

// ─────────────────────────────────────────────
// CONSTANTS & COEFFICIENTS
// ─────────────────────────────────────────────
const RAIL_GRADES = {
  R200: { label: "R200 (~200 BHN)", bhn: 200, f_wear: 1.34, f_rcf: 1.40 },
  R260: { label: "R260 (~260 BHN)", bhn: 260, f_wear: 1.00, f_rcf: 1.00 },
  R320Cr: { label: "R320Cr (~320 BHN)", bhn: 320, f_wear: 0.70, f_rcf: 0.75 },
  R350HT: { label: "R350HT (~350 BHN)", bhn: 350, f_wear: 0.50, f_rcf: 0.55 },
  R400HT: { label: "R400HT (~400 BHN)", bhn: 400, f_wear: 0.38, f_rcf: 0.40 },
};

const RAIL_TYPES = {
  vignole: { label: "Rail Vignole", f_v: 1.00, f_l: 1.00, reserve: { UIC49: 13, UIC54: 15, UIC60: 18 } },
  groove:  { label: "Rail à Gorge (Tram)", f_v: 1.20, f_l: 1.80, reserve: { "59R2": 12, "60R2": 13 } },
};

const TRACK_MODES = {
  ballast:  { label: "Voie Ballastée", f_v: 1.00, f_l: 1.00 },
  slab:     { label: "Voie Béton (Slab)", f_v: 1.10, f_l: 1.15 },
  embedded: { label: "Voie Enrobée (Tram)", f_v: 1.15, f_l: 1.20 },
};

const CONTEXT_PRESETS = {
  tram:   { label: "🚋 Tram",                  qRef: 10,   baseWearV: 0.82, baseWearL: 1.00,
            // RCF de base par tranche de rayon (index = RADIUS_BANDS index 0→4)
            // Physique : alignement très peu de RCF (contact centré), courbes modérées = max RCF (magic wear rate paradox)
            // Sources : Infrabel/TU Delft 2023, IHHA 2019
            rcfRate: [0.002, 0.010, 0.018, 0.012, 0.004] },
  metro:  { label: "🚇 Métro / LRT",           qRef: 15,   baseWearV: 0.82, baseWearL: 1.00,
            rcfRate: [0.002, 0.010, 0.016, 0.010, 0.003] },
  heavy:  { label: "🚂 Voie Ferrée Classique",  qRef: 22.5, baseWearV: 0.82, baseWearL: 1.00,
            rcfRate: [0.002, 0.008, 0.014, 0.009, 0.003] },
};

const RADIUS_BANDS = [
  { id: "r1", label: "R < 100 m",      rMin: 0,   rMax: 100,  f_v: 6.0, f_l: 15.0, grindInterval: { tram: 0.5,  metro: 3,   heavy: null } },
  { id: "r2", label: "100 ≤ R < 200 m", rMin: 100, rMax: 200,  f_v: 4.0, f_l: 9.0,  grindInterval: { tram: 1.0,  metro: 5,   heavy: 20  } },
  { id: "r3", label: "200 ≤ R < 400 m", rMin: 200, rMax: 400,  f_v: 2.5, f_l: 5.0,  grindInterval: { tram: 2.0,  metro: 8,   heavy: 30  } },
  { id: "r4", label: "400 ≤ R < 800 m", rMin: 400, rMax: 800,  f_v: 1.5, f_l: 2.5,  grindInterval: { tram: 3.5,  metro: 12,  heavy: 50  } },
  { id: "r5", label: "R ≥ 800 m (Align.)",rMin: 800, rMax: 99999, f_v: 1.0, f_l: 1.0, grindInterval: { tram: 5.0,  metro: 20,  heavy: 80  } },
];

const SPEED_FACTORS = [
  { max: 40,  f_v: 0.90, f_l: 1.10 },
  { max: 80,  f_v: 1.00, f_l: 1.00 },
  { max: 120, f_v: 1.10, f_l: 0.95 },
  { max: 160, f_v: 1.20, f_l: 0.90 },
  { max: 9999,f_v: 1.35, f_l: 0.85 },
];

// Lubrification : facteurs réalistes différenciés par rayon et niveau
// Sources : Swedish SJ (optimal = -98%), Shanghai metro (-50% vie sans lubr),
//           FRA FAST study, Queensland Rail
// La réduction est toujours MOINS efficace sur courbes modérées/alignement
// car le mécanisme dominant n'est pas le frottement de joue
const LUBRICATION_LEVELS = {
  none:     { label: "Aucune lubrification",                  f_by_band: [1.00, 1.00, 1.00, 1.00, 1.00] },
  poor:     { label: "Médiocre (système mal entretenu)",      f_by_band: [0.80, 0.82, 0.88, 0.95, 1.00] },
  standard: { label: "Standard (wayside correctement réglé)", f_by_band: [0.55, 0.60, 0.72, 0.90, 1.00] },
  good:     { label: "Bonne (wayside + embarquée)",           f_by_band: [0.35, 0.40, 0.60, 0.85, 1.00] },
  optimal:  { label: "Optimale (conditions idéales — labo)",  f_by_band: [0.10, 0.15, 0.35, 0.75, 1.00] },
};
// f_by_band[i] = facteur multiplicateur usure LATÉRALE pour tranche i (0=R<100m … 4=alignement)
// Usure verticale non affectée par la lubrification (contact de tête, pas de joue)
// Alignement (band 4) = toujours 1.0 car pas de joue de boudin en alignement
const WEAR_LIMITS_V = { tram: 7, metro: 9, heavy: 12 };
const WEAR_LIMITS_L = { tram: 8, metro: 11, heavy: 14 };
const RCF_LIMIT = 0.70;
const RAIL_RESERVE = { R200: 13, R260: 15, R320Cr: 16, R350HT: 17, R400HT: 18 };

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function getSpeedFactor(speed) {
  return SPEED_FACTORS.find(s => speed <= s.max) || SPEED_FACTORS[SPEED_FACTORS.length - 1];
}

function computeMGT(trains) {
  // trains: array of { trainsPerDay, axleLoad, bogies, axlesPerBogie }
  let total = 0;
  for (const t of trains) {
    const grossTons = t.axleLoad * t.bogies * t.axlesPerBogie;
    total += (t.trainsPerDay * grossTons * 365) / 1e6;
  }
  return total;
}

function computeEquivMGT(trains, context) {
  const preset = CONTEXT_PRESETS[context];
  let total = 0;
  for (const t of trains) {
    const grossTons = t.axleLoad * t.bogies * t.axlesPerBogie;
    const mgt = (t.trainsPerDay * grossTons * 365) / 1e6;
    const fc = Math.pow(t.axleLoad / preset.qRef, 3);
    total += mgt * fc;
  }
  return total;
}

function simulate(params) {
  const { context, trains, segments, strategy, railType, trackMode, speed, lubrication, horizonYears } = params;

  const preset = CONTEXT_PRESETS[context];
  const rtype = RAIL_TYPES[railType];
  const tmode = TRACK_MODES[trackMode];
  const sf = getSpeedFactor(speed);
  const mgtPerYear = computeMGT(trains);
  const eqMgtPerYear = computeEquivMGT(trains, context);

  const results = segments.map(seg => {
    const rb = RADIUS_BANDS.find(r => seg.radius >= r.rMin && seg.radius < r.rMax) || RADIUS_BANDS[4];
    const grade = RAIL_GRADES[seg.railGrade] || RAIL_GRADES["R260"];

    // Facteur lubrification : spécifique à la tranche de rayon, pas un facteur global
    const rbIndex = RADIUS_BANDS.indexOf(rb);
    const lubLevel = LUBRICATION_LEVELS[lubrication] || LUBRICATION_LEVELS["none"];
    const lubF = lubLevel.f_by_band[rbIndex];

    // ── Taux d'usure : logique corrigée ─────────────────────────────
    //
    // Principe fondamental :
    //   - L'alignement s'use LENTEMENT → taux de base faible
    //   - Les courbes s'usent TOUJOURS plus vite → f_rayon > 1 et dominant
    //   - La dureté réduit l'usure, MAIS son effet est PLAFONNÉ en courbe serrée
    //     car les forces de contact latérales sont si élevées qu'elles réduisent
    //     l'avantage de la dureté (magic wear rate, usure abrasive forcée)
    //   - En courbe serrée, on choisit du rail dur pour REPOUSSER l'échéance,
    //     pas pour annuler l'usure
    //
    // Facteur dureté effectif selon le rayon :
    //   - Alignement : f_dureté plein effet (usure faible, dureté très efficace)
    //   - Courbe modérée : effet partiel
    //   - Courbe serrée : effet limité à 30% max (usure abrasive/contact domine)
    const hardnessEffect = Math.min(
      1.0 - (1.0 - grade.f_wear) * (1.0 / (1.0 + rb.f_l * 0.3)),
      1.0
    );
    // Exemples avec cette formule :
    //   R > 800m (f_l=1.0)  + R350HT (f_wear=0.50) : effet = 1-(0.5)*(1/1.3) = 0.62  ✓ dureté aide bien
    //   R 100-200m (f_l=9.0) + R350HT              : effet = 1-(0.5)*(1/3.7) = 0.86  ✓ dureté aide peu
    //   R 200-400m (f_l=5.0) + R350HT              : effet = 1-(0.5)*(1/2.5) = 0.80  ✓ effet intermédiaire

    const wearRateV = preset.baseWearV
      * rb.f_v           // facteur rayon vertical (1.0 → 6.0)
      * hardnessEffect   // facteur dureté effectif (plafonné en courbe)
      * rtype.f_v        // type rail
      * tmode.f_v        // mode pose
      * sf.f_v;          // vitesse

    const wearRateL = preset.baseWearL * 1.5
      * rb.f_l           // facteur rayon latéral (1.0 → 15.0) — DOMINANT en courbe
      * hardnessEffect   // dureté encore moins efficace sur usure latérale
      * rtype.f_l
      * tmode.f_l
      * sf.f_l
      * lubF;            // lubrification agit sur usure latérale uniquement

    // RCF rate spécifique à la tranche de rayon (même rbIndex déjà déclaré ligne 117)
    const rcfRateBase = preset.rcfRate[rbIndex] * grade.f_rcf * sf.f_v;
    // Physique du RCF par rayon :
    //   Alignement (rb4)       : RCF très faible — contact centré, peu de glissement
    //   Courbe serrée (rb1-2)  : RCF modéré — usure naturelle "lave" les fissures (magic wear rate)
    //   Courbe modérée (rb3)   : RCF maximal — assez de contrainte pour fissurer, pas assez d'usure pour éliminer
    //   → C'est le paradoxe Infrabel 2025 : Head Checks max sur R750-1000m, pas sur courbes serrées

    // ── Vérification de cohérence (debug) ───────────────────────────
    // Alignement R260   : wearRateV ≈ 0.82 × 1.0 × 1.0 = 0.82 mm/100MGT  ✓
    // Courbe serrée R350HT : wearRateV ≈ 0.82 × 4.0 × 0.86 = 2.82 mm/100MGT ✓ (3.4× alignement)
    // Courbe très serrée R400HT : wearRateV ≈ 0.82 × 6.0 × 0.87 = 4.28 mm/100MGT ✓ (5.2× alignement)

    const limitV = WEAR_LIMITS_V[context];
    const limitL = WEAR_LIMITS_L[context];
    const reserveInit = railType === "groove" ? 12 : (RAIL_RESERVE[seg.railGrade] || 15);
    const grindIntervalBase = rb.grindInterval[context] || 999;

    const grindMGT = strategy === "preventive"
      ? grindIntervalBase
      : grindIntervalBase * 3.0;

    const gp = strategy === "preventive"
      ? { passes: 1,  removalPerPass: 0.20, rcfReduc: 0.30, postWearFactor: 0.75, postEffectMGT: grindIntervalBase * 0.85 }
      : { passes: 4,  removalPerPass: 0.55, rcfReduc: 0.18, postWearFactor: 0.92, postEffectMGT: grindIntervalBase * 0.40 };

    let wearV = 0, wearL = 0, rcf = 0;
    let mgtSinceGrind = 0, totalMGT = 0;
    let reserve = reserveInit;
    let grindCount = 0, replacementYear = null;
    let postGrindMGTLeft = 0;
    const yearData = [];

    for (let y = 1; y <= horizonYears; y++) {
      totalMGT += mgtPerYear;
      mgtSinceGrind += mgtPerYear;

      // Facteur d'usure post-meulage
      const wf = postGrindMGTLeft > 0 ? gp.postWearFactor : 1.0;
      postGrindMGTLeft = Math.max(0, postGrindMGTLeft - mgtPerYear);

      // ── Usure & RCF : tous deux sur MGT brut (cohérence) ───────────
      wearV += (mgtPerYear / 100) * wearRateV * wf;
      wearL += (mgtPerYear / 100) * wearRateL * wf;

      // RCF : taux par MGT brut, mais modulé par l'usure courante
      // Physique : si l'usure est forte, elle "lave" les fissures RCF (magic wear rate)
      // → RCF réduit quand wearRateV est élevé (courbes serrées avec rail dur = équilibre)
      const wearRCFprotection = Math.min(0.80, wearRateV * wf / 5.0); // max 80% protection
      const rcfIncrement = rcfRateBase * mgtPerYear * (1.0 - wearRCFprotection);
      rcf = Math.min(1.0, rcf + rcfIncrement);

      // ── Décision de meulage ─────────────────────────────────────────
      let groundThisYear = false;
      if (mgtSinceGrind >= grindMGT && rcf < RCF_LIMIT && reserve > 3) {
        const actualPasses = strategy === "corrective"
          ? Math.max(1, Math.min(gp.passes, Math.ceil(rcf / 0.12)))
          : gp.passes;
        const removal = actualPasses * gp.removalPerPass;
        reserve -= removal;
        // Réduction RCF par meulage : enlève les fissures superficielles
        // Plus le RCF est bas (préventif), plus le meulage est efficace
        const rcfReductionEff = gp.rcfReduc * (1.0 + (1.0 - rcf) * 0.5);
        rcf = Math.max(0, rcf - actualPasses * rcfReductionEff);
        wearV = Math.max(0, wearV - removal * 0.2);
        postGrindMGTLeft = gp.postEffectMGT;
        mgtSinceGrind = 0;
        grindCount++;
        groundThisYear = true;
      }

      const needsReplacement = wearV >= limitV || wearL >= limitL || reserve <= 2 || rcf >= RCF_LIMIT;

      yearData.push({
        year: y,
        mgt: +totalMGT.toFixed(2),
        wearV: +Math.min(wearV, limitV).toFixed(3),
        wearL: +Math.min(wearL, limitL).toFixed(3),
        rcf: +Math.min(rcf, 1).toFixed(3),
        reserve: +Math.max(reserve, 0).toFixed(2),
        ground: groundThisYear ? 1 : 0,
        replaced: needsReplacement && !replacementYear ? 1 : 0,
        limitV, limitL,
      });

      if (needsReplacement && !replacementYear) {
        replacementYear = y;
        break;
      }
    }

    return { seg, rb, wearRateV, wearRateL, hardnessEffect, mgtPerYear, eqMgtPerYear, grindCount, replacementYear, yearData, limitV, limitL };
  });

  return { results, mgtPerYear, eqMgtPerYear };
}

// ─────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────
const Section = ({ title, children }) => (
  <div style={{
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: "20px 24px",
    marginBottom: 20,
  }}>
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 3, color: "#7dd3c8", textTransform: "uppercase", marginBottom: 16 }}>{title}</div>
    {children}
  </div>
);

const Label = ({ children }) => (
  <div style={{ fontSize: 11, color: "#8899aa", marginBottom: 4, fontWeight: 500, letterSpacing: 0.5 }}>{children}</div>
);

const Input = ({ value, onChange, type = "number", min, max, step = 1, style = {} }) => (
  <input
    type={type}
    value={value}
    onChange={e => onChange(type === "number" ? +e.target.value : e.target.value)}
    min={min} max={max} step={step}
    style={{
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 6,
      color: "#e8f4f3",
      padding: "7px 10px",
      fontSize: 13,
      width: "100%",
      outline: "none",
      fontFamily: "'DM Mono', monospace",
      ...style
    }}
  />
);

const Select = ({ value, onChange, options }) => (
  <select
    value={value}
    onChange={e => onChange(e.target.value)}
    style={{
      background: "#1a2830",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 6,
      color: "#e8f4f3",
      padding: "7px 10px",
      fontSize: 13,
      width: "100%",
      outline: "none",
      cursor: "pointer",
    }}
  >
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

const Toggle = ({ value, onChange, label }) => (
  <div
    onClick={() => onChange(!value)}
    style={{
      display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none"
    }}
  >
    <div style={{
      width: 36, height: 20, borderRadius: 10,
      background: value ? "#7dd3c8" : "rgba(255,255,255,0.1)",
      position: "relative", transition: "background 0.2s",
      border: `1px solid ${value ? "#7dd3c8" : "rgba(255,255,255,0.2)"}`,
    }}>
      <div style={{
        width: 14, height: 14, borderRadius: "50%",
        background: "#fff",
        position: "absolute", top: 2,
        left: value ? 18 : 2,
        transition: "left 0.2s",
      }} />
    </div>
    <span style={{ fontSize: 13, color: "#c5ddd9" }}>{label}</span>
  </div>
);

const Btn = ({ onClick, children, active, small }) => (
  <button onClick={onClick} style={{
    background: active ? "#7dd3c8" : "rgba(255,255,255,0.06)",
    color: active ? "#0d1f26" : "#c5ddd9",
    border: `1px solid ${active ? "#7dd3c8" : "rgba(255,255,255,0.15)"}`,
    borderRadius: 6,
    padding: small ? "5px 12px" : "8px 18px",
    fontSize: small ? 12 : 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
    letterSpacing: 0.3,
  }}>{children}</button>
);

const Stat = ({ label, value, unit, color = "#7dd3c8", warn }) => (
  <div style={{
    background: warn ? "rgba(255,120,80,0.08)" : "rgba(125,211,200,0.05)",
    border: `1px solid ${warn ? "rgba(255,120,80,0.25)" : "rgba(125,211,200,0.15)"}`,
    borderRadius: 8, padding: "12px 16px", flex: 1,
  }}>
    <div style={{ fontSize: 10, color: warn ? "#ff9980" : "#6bb5af", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: warn ? "#ff9980" : color, fontFamily: "'DM Mono', monospace" }}>
      {value}<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 4, color: "#8899aa" }}>{unit}</span>
    </div>
  </div>
);

const RCFBadge = ({ value }) => {
  const color = value < 0.3 ? "#4ade80" : value < 0.7 ? "#fbbf24" : "#f87171";
  const label = value < 0.3 ? "SAIN" : value < 0.7 ? "MODÉRÉ" : "CRITIQUE";
  return (
    <span style={{
      background: `${color}22`, color, border: `1px solid ${color}55`,
      borderRadius: 4, padding: "2px 7px", fontSize: 10, fontWeight: 700, letterSpacing: 1
    }}>{label}</span>
  );
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#0d1f26", border: "1px solid rgba(125,211,200,0.25)",
      borderRadius: 8, padding: "10px 14px", fontSize: 12,
    }}>
      <div style={{ color: "#7dd3c8", marginBottom: 6, fontWeight: 700 }}>Année {label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: <b>{typeof p.value === "number" ? p.value.toFixed(3) : p.value}</b>
        </div>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────
// VALIDATION DATA & PANEL — définis AVANT le composant principal
// ─────────────────────────────────────────────

const REFERENCE_CASES = [
  {
    id: "BE_R260_tangent",
    source: "Réseau Belge (Infrabel / TU Delft 2023)",
    context: "heavy",
    description: "Voie ferrée — alignement — R260 — UIC3 (~25 MGT/an)",
    radius: 99999, railGrade: "R260", mgtPerYear: 25,
    measuredWearV: 0.82, measuredWearL: null,
    unit: "mm/100MGT (usure verticale)",
    notes: "Big-data analysis 5338 km réseau, moyenne 2012–2019",
  },
  {
    id: "BE_R260_curve500",
    source: "Réseau Belge (Infrabel / TU Delft 2023)",
    context: "heavy",
    description: "Voie ferrée — courbe R~500m — R260 — UIC3",
    radius: 500, railGrade: "R260", mgtPerYear: 25,
    measuredWearV: 1.4, measuredWearL: 2.8,
    unit: "mm/100MGT",
    notes: "Usure rail haut courbe. Meulage préventif 25 MGT (courbe) depuis 2016",
  },
  {
    id: "BE_R200_tangent",
    source: "Réseau Belge (Infrabel / TU Delft 2023)",
    context: "heavy",
    description: "Voie ferrée — alignement — R200 (ancien grade)",
    radius: 99999, railGrade: "R200", mgtPerYear: 25,
    measuredWearV: 1.10, measuredWearL: null,
    unit: "mm/100MGT (usure verticale)",
    notes: "R200 = +34% d'usure vs R260 sur alignement (mesuré réseau entier)",
  },
  {
    id: "GZ_metro_R300",
    source: "Métro Guangzhou — Ligne 1 (ScienceDirect 2021)",
    context: "metro",
    description: "Métro — courbe R300m — Type-A vehicle — ~15 MGT/an",
    radius: 300, railGrade: "R260", mgtPerYear: 15,
    measuredWearV: 2.1, measuredWearL: 6.5,
    unit: "mm/100MGT",
    notes: "Mesures terrain voie haute courbe. 12 courbes R300 sur la ligne.",
  },
  {
    id: "GZ_depot_R350",
    source: "Dépôt EMU Guangzhou Est (Railway Sciences 2022)",
    context: "heavy",
    description: "Courbe R350m — dépôt EMU — vitesse ~30 km/h",
    radius: 350, railGrade: "R260", mgtPerYear: 5,
    measuredWearV: null, measuredWearL: 10.1,
    unit: "mm (usure latérale max — 1M passages)",
    notes: "Rail extérieur : 10.11 mm après 1M passages. Rail intérieur : 2.29 mm.",
  },
  {
    id: "BE_RCF_R750",
    source: "Réseau Belge — Head Checks (ScienceDirect 2025)",
    context: "heavy",
    description: "Voie ferrée — courbe R750–1000m — R260 — RCF",
    radius: 875, railGrade: "R260", mgtPerYear: 20,
    measuredWearV: null, measuredWearL: null,
    measuredRCF_growth: 1.5,
    unit: "mm croissance fissure HC / 100 MGT",
    notes: "Paradoxe : Head Checks max sur R750–1000m, pas sur courbes serrées (usure naturelle protège).",
  },
];

function ValidationPanel({ simResult, context }) {
  const [userMeasures, setUserMeasures] = useState([]);
  const [newMeasure, setNewMeasure] = useState({
    label: "", source: "", radius: 300, railGrade: "R260",
    mgtPerYear: 15, measuredWearV: "", measuredWearL: "", notes: ""
  });
  const [showAddForm, setShowAddForm] = useState(false);

  const filteredCases = REFERENCE_CASES.filter(c => !context || c.context === context);
  const allCases = [...filteredCases, ...userMeasures];

  function getSimPrediction(refCase) {
    const rb = RADIUS_BANDS.find(r => refCase.radius >= r.rMin && refCase.radius < r.rMax) || RADIUS_BANDS[4];
    const grade = RAIL_GRADES[refCase.railGrade] || RAIL_GRADES["R260"];
    const preset = CONTEXT_PRESETS[refCase.context] || CONTEXT_PRESETS["heavy"];
    const hardnessEffect = Math.min(1.0 - (1.0 - grade.f_wear) * (1.0 / (1.0 + rb.f_l * 0.3)), 1.0);
    const wearRateV = preset.baseWearV * rb.f_v * hardnessEffect;
    const wearRateL = preset.baseWearL * 1.5 * rb.f_l * hardnessEffect;
    return { wearRateV: +wearRateV.toFixed(3), wearRateL: +wearRateL.toFixed(3) };
  }

  function getError(predicted, measured) {
    if (measured === null || measured === undefined || measured === 0) return null;
    return (((predicted - measured) / measured) * 100).toFixed(1);
  }

  function getErrorColor(pct) {
    const abs = Math.abs(+pct);
    if (abs <= 15) return "#4ade80";
    if (abs <= 30) return "#fbbf24";
    return "#f87171";
  }

  const addUserMeasure = () => {
    if (!newMeasure.label) return;
    setUserMeasures(m => [...m, {
      ...newMeasure,
      id: `user_${Date.now()}`,
      source: newMeasure.source || "Mesure utilisateur",
      measuredWearV: newMeasure.measuredWearV !== "" ? +newMeasure.measuredWearV : null,
      measuredWearL: newMeasure.measuredWearL !== "" ? +newMeasure.measuredWearL : null,
      context: context,
      unit: "mm/100MGT",
      isUser: true,
    }]);
    setNewMeasure({ label: "", source: "", radius: 300, railGrade: "R260", mgtPerYear: 15, measuredWearV: "", measuredWearL: "", notes: "" });
    setShowAddForm(false);
  };

  const chartData = allCases
    .filter(c => c.measuredWearV !== null && c.measuredWearV !== undefined)
    .map(c => {
      const pred = getSimPrediction(c);
      return {
        shortName: c.id.substring(0, 14),
        simV: pred.wearRateV,
        realV: c.measuredWearV,
      };
    });

  const inputStyle = {
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6, color: "#e8f4f3", padding: "7px 10px", fontSize: 13,
    width: "100%", outline: "none", fontFamily: "'DM Mono', monospace",
  };

  return (
    <div style={{ maxWidth: 1400, margin: "32px auto 0", padding: "0 24px" }}>
      <div style={{
        borderTop: "1px solid rgba(125,211,200,0.12)", paddingTop: 28, marginBottom: 20,
        display: "flex", justifyContent: "space-between", alignItems: "flex-end"
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 3, color: "#7dd3c8", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
            Validation & Calibration
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e8f4f3" }}>
            Comparaison Simulateur vs Données Terrain Réelles
          </div>
          <div style={{ fontSize: 12, color: "#6bb5af", marginTop: 4 }}>
            Sources : Réseau Belge (Infrabel/TU Delft 2023) · Métro Guangzhou (2021–2022)
          </div>
        </div>
        <Btn onClick={() => setShowAddForm(v => !v)} active={showAddForm} small>
          {showAddForm ? "✕ Annuler" : "+ Ajouter une mesure réelle"}
        </Btn>
      </div>

      {showAddForm && (
        <div style={{ background: "rgba(125,211,200,0.04)", border: "1px solid rgba(125,211,200,0.2)", borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: "#7dd3c8", fontWeight: 700, marginBottom: 14, letterSpacing: 1 }}>SAISIR UNE MESURE RÉELLE</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
            <div><Label>Libellé</Label><input value={newMeasure.label} onChange={e => setNewMeasure(m => ({...m, label: e.target.value}))} placeholder="ex: Ligne 2 courbe station X" style={inputStyle} /></div>
            <div><Label>Source / Projet</Label><input value={newMeasure.source} onChange={e => setNewMeasure(m => ({...m, source: e.target.value}))} placeholder="ex: Métro Casablanca" style={inputStyle} /></div>
            <div><Label>Rayon (m)</Label><Input value={newMeasure.radius} onChange={v => setNewMeasure(m => ({...m, radius: v}))} min={50} /></div>
            <div><Label>Grade rail</Label><Select value={newMeasure.railGrade} onChange={v => setNewMeasure(m => ({...m, railGrade: v}))} options={Object.entries(RAIL_GRADES).map(([k]) => ({value: k, label: k}))} /></div>
            <div><Label>MGT/an</Label><Input value={newMeasure.mgtPerYear} onChange={v => setNewMeasure(m => ({...m, mgtPerYear: v}))} min={0.1} step={0.5} /></div>
            <div><Label>Usure verticale (mm/100MGT)</Label><input value={newMeasure.measuredWearV} onChange={e => setNewMeasure(m => ({...m, measuredWearV: e.target.value}))} type="number" step="0.01" placeholder="ex: 1.2" style={inputStyle} /></div>
            <div><Label>Usure latérale (mm/100MGT)</Label><input value={newMeasure.measuredWearL} onChange={e => setNewMeasure(m => ({...m, measuredWearL: e.target.value}))} type="number" step="0.01" placeholder="ex: 4.5" style={inputStyle} /></div>
            <div><Label>Notes</Label><input value={newMeasure.notes} onChange={e => setNewMeasure(m => ({...m, notes: e.target.value}))} placeholder="conditions, méthode..." style={inputStyle} /></div>
          </div>
          <Btn onClick={addUserMeasure} active small>✓ Ajouter cette mesure</Btn>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 12, padding: 20, border: "1px solid rgba(125,211,200,0.1)" }}>
          <div style={{ fontSize: 11, color: "#7dd3c8", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, marginBottom: 16 }}>
            Usure Verticale — Simulateur vs Terrain (mm/100MGT)
          </div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" stroke="#4a6a74" tick={{ fontSize: 10 }} unit=" mm" />
                <YAxis type="category" dataKey="shortName" stroke="#4a6a74" tick={{ fontSize: 10 }} width={90} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="realV" name="Mesuré terrain" fill="#fbbf24" opacity={0.85} radius={[0,3,3,0]} />
                <Bar dataKey="simV" name="Simulateur" fill="#7dd3c8" opacity={0.85} radius={[0,3,3,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ textAlign: "center", color: "#4a6a74", padding: "60px 0", fontSize: 13 }}>
              Aucune donnée pour le contexte sélectionné
            </div>
          )}
        </div>

        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 12, padding: 20, border: "1px solid rgba(125,211,200,0.1)" }}>
          <div style={{ fontSize: 11, color: "#7dd3c8", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, marginBottom: 16 }}>
            Écart Simulateur / Terrain
          </div>
          {chartData.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {chartData.map(c => {
                const errPct = getError(c.simV, c.realV);
                if (errPct === null) return null;
                const color = getErrorColor(errPct);
                const bar = Math.min(100, Math.abs(+errPct));
                return (
                  <div key={c.shortName}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                      <span style={{ color: "#c5ddd9" }}>{c.shortName}</span>
                      <span style={{ color, fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>
                        {+errPct > 0 ? "+" : ""}{errPct}%
                      </span>
                    </div>
                    <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
                      <div style={{ height: "100%", width: `${bar}%`, background: color, borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
              <div style={{ marginTop: 8, fontSize: 11, color: "#6bb5af", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
                🟢 &lt;15% bon · 🟡 15–30% acceptable · 🔴 &gt;30% à recalibrer
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", color: "#4a6a74", padding: "60px 0", fontSize: 13 }}>
              Sélectionnez un contexte pour voir les écarts
            </div>
          )}
        </div>
      </div>

      <div style={{ background: "rgba(0,0,0,0.15)", borderRadius: 12, border: "1px solid rgba(125,211,200,0.08)", overflow: "hidden", marginBottom: 20 }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: "#7dd3c8", textTransform: "uppercase", fontWeight: 700 }}>Cas de Référence</div>
          <div style={{ fontSize: 11, color: "#6bb5af" }}>{allCases.length} cas chargés</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                {["Source", "Description", "Rayon", "Grade", "MGT/an", "U.V. Réel", "U.V. Sim.", "Écart V", "U.L. Réel", "U.L. Sim.", "Écart L", "Notes"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#6bb5af", fontWeight: 600, whiteSpace: "nowrap", fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allCases.map(c => {
                const pred = getSimPrediction(c);
                const errV = getError(pred.wearRateV, c.measuredWearV);
                const errL = getError(pred.wearRateL, c.measuredWearL);
                return (
                  <tr key={c.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: c.isUser ? "rgba(125,211,200,0.04)" : "transparent" }}>
                    <td style={{ padding: "8px 12px", color: c.isUser ? "#7dd3c8" : "#8899aa", fontSize: 11 }}>{c.isUser ? "👤 " : "📄 "}{c.source}</td>
                    <td style={{ padding: "8px 12px", color: "#c5ddd9", fontSize: 11 }}>{c.description}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "'DM Mono', monospace" }}>{c.radius >= 9999 ? "alignement" : `${c.radius} m`}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "'DM Mono', monospace", color: "#a78bfa" }}>{c.railGrade}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "'DM Mono', monospace" }}>{c.mgtPerYear}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "'DM Mono', monospace", color: "#fbbf24" }}>{c.measuredWearV ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "'DM Mono', monospace", color: "#7dd3c8" }}>{pred.wearRateV}</td>
                    <td style={{ padding: "8px 12px" }}>{errV !== null ? <span style={{ color: getErrorColor(errV), fontWeight: 700 }}>{+errV > 0 ? "+" : ""}{errV}%</span> : "—"}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "'DM Mono', monospace", color: "#fbbf24" }}>{c.measuredWearL ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "'DM Mono', monospace", color: "#7dd3c8" }}>{pred.wearRateL}</td>
                    <td style={{ padding: "8px 12px" }}>{errL !== null ? <span style={{ color: getErrorColor(errL), fontWeight: 700 }}>{+errL > 0 ? "+" : ""}{errL}%</span> : "—"}</td>
                    <td style={{ padding: "8px 12px", color: "#6bb5af", fontSize: 11 }}>{c.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ background: "rgba(125,211,200,0.03)", border: "1px solid rgba(125,211,200,0.12)", borderRadius: 10, padding: 20 }}>
        <div style={{ fontSize: 11, color: "#7dd3c8", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, marginBottom: 12 }}>Guide de Calibration</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, fontSize: 12, color: "#8899aa", lineHeight: 1.7 }}>
          <div><div style={{ color: "#4ade80", fontWeight: 600, marginBottom: 6 }}>🟢 Écart &lt; 15% — Bon</div>Simulateur bien calibré. Coefficients par défaut valides.</div>
          <div><div style={{ color: "#fbbf24", fontWeight: 600, marginBottom: 6 }}>🟡 Écart 15–30% — Acceptable</div>Normal pour un modèle simplifié. Vérifier lubrification, profil de roue, qualité de voie.</div>
          <div><div style={{ color: "#f87171", fontWeight: 600, marginBottom: 6 }}>🔴 Écart &gt; 30% — Recalibrer</div>Ajuster <code style={{background:"rgba(255,255,255,0.08)",padding:"1px 4px",borderRadius:3}}>baseWearV</code> ou les facteurs <code style={{background:"rgba(255,255,255,0.08)",padding:"1px 4px",borderRadius:3}}>f_v</code> de la tranche concernée.</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// HELP MODAL
// ─────────────────────────────────────────────
const HELP_SECTIONS = [
  {
    id: "overview",
    title: "Simulator Overview",
    icon: "🛤️",
    content: [
      {
        type: "text",
        text: "This simulator estimates rail wear progression, grinding cycles, and replacement timelines for tramway, metro/LRT, and heavy railway lines. It is based on published wear models (Archard, Eisenmann), real-world measurement data (Infrabel/TU Delft 2023, Guangzhou Metro 2021), and international standards (EN 13674, UIC 714)."
      },
      {
        type: "text",
        text: "The simulation runs independently for each track segment (radius band) and computes annual wear accumulation, RCF index, and remaining metal reserve. Grinding and replacement decisions are triggered by configurable thresholds."
      }
    ]
  },
  {
    id: "mgt",
    title: "MGT — Million Gross Tonnes",
    icon: "⚖️",
    content: [
      {
        type: "param",
        name: "Gross MGT / year",
        formula: "MGT = (Trains/day × Gross tonnage/train × 365) / 1,000,000",
        impact: "Primary driver of all wear and fatigue accumulation. Doubling MGT roughly doubles wear over time.",
        detail: "Gross tonnage = axle load × number of axles per train (bogies × axles/bogie). This is the total train weight including passengers at average service load."
      },
      {
        type: "param",
        name: "Equivalent MGT",
        formula: "MGT_eq = MGT × (Q_axle / Q_ref)³",
        impact: "Heavier axle loads cause disproportionately more damage. A 20t axle causes ~8× more wear than a 10t axle (cube law).",
        detail: "The exponent n=3 is used for wear (Archard model). For RCF/fatigue, n=4 is more appropriate. Reference axle loads: tram 10t, metro 15t, heavy rail 22.5t.",
        source: "Archard (1953), IHHA Guidelines (2019)",
        link: "https://www.ihha.net"
      }
    ]
  },
  {
    id: "segments",
    title: "Track Segments & Radius Bands",
    icon: "🔄",
    content: [
      {
        type: "text",
        text: "The line is divided into 5 radius bands. Each band has independent wear rates and grinding intervals. All lengths should be entered as single-track kilometres (one rail, one direction)."
      },
      {
        type: "table",
        headers: ["Band", "Radius", "Vertical factor f_V", "Lateral factor f_L", "Physical mechanism"],
        rows: [
          ["R1", "R < 100 m", "×6.0", "×15.0", "Severe flange/rail contact, plastic deformation"],
          ["R2", "100–200 m", "×4.0", "×9.0", "High lateral forces, abrasive wear dominant"],
          ["R3", "200–400 m", "×2.5", "×5.0", "Mixed wear + RCF, highest RCF risk zone"],
          ["R4", "400–800 m", "×1.5", "×2.5", "Moderate curvature, RCF begins"],
          ["R5", "R ≥ 800 m", "×1.0", "×1.0", "Reference — centered contact, low wear"],
        ]
      },
      {
        type: "param",
        name: "Representative radius",
        formula: "—",
        impact: "Used to select the correct radius band. Enter a typical value within the band range (e.g. 150m for the 100–200m band).",
        detail: "If your curve varies within a band, use the tightest radius (worst case) for conservative planning."
      }
    ]
  },
  {
    id: "wear",
    title: "Wear Rate Model",
    icon: "📉",
    content: [
      {
        type: "param",
        name: "Base vertical wear rate",
        formula: "0.82 mm / 100 MGT (R260, tangent track)",
        impact: "Reference value from large-scale measurement. All other factors multiply this base rate.",
        source: "Infrabel / TU Delft big-data study, 5,338 km measured (2012–2019)",
        link: "https://www.tandfonline.com/doi/full/10.1080/23248378.2022.2031244"
      },
      {
        type: "param",
        name: "Hardness effect factor",
        formula: "f_hard = 1 − (1 − f_grade) / (1 + f_lateral × 0.3)",
        impact: "Harder rail reduces wear, but the benefit is capped in tight curves where contact forces are so high that hardness advantage is reduced.",
        detail: "On tangent track, R350HT reduces wear by ~38% vs R260. On R150m curve, the same rail only reduces wear by ~14% — lateral forces dominate.",
        source: "EN 13674-1, Infrabel grade comparison study"
      },
      {
        type: "table",
        headers: ["Grade", "BHN", "f_wear", "Typical use"],
        rows: [
          ["R200", "~200", "1.34", "Legacy, avoid on new projects"],
          ["R260", "~260", "1.00", "Reference — tangent track"],
          ["R320Cr", "~320", "0.70", "Moderate curves (200–800m)"],
          ["R350HT", "~350", "0.50", "Tight curves (100–200m)"],
          ["R400HT", "~400", "0.38", "Very tight curves (< 100m)"],
        ]
      },
      {
        type: "param",
        name: "Track form factor",
        formula: "Ballasted: ×1.0 / Slab: ×1.10 / Embedded: ×1.15",
        impact: "Concrete slab track transmits higher dynamic forces (less damping) → slightly higher wear and RCF rates.",
        detail: "Embedded track (tram) adds 15–20% on wear rates due to constrained rail movement and moisture retention."
      },
      {
        type: "param",
        name: "Speed factor",
        formula: "Based on Eisenmann dynamic load model",
        impact: "Higher speeds increase dynamic wheel-rail forces via track irregularities. Below 40 km/h, slow-speed abrasive wear slightly dominates lateral direction.",
        source: "Eisenmann (1979), validated in UIC 714R",
        link: "https://www.uic.org"
      }
    ]
  },
  {
    id: "lubrication",
    title: "Flange Lubrication",
    icon: "🛢️",
    content: [
      {
        type: "text",
        text: "Lubrication only affects lateral (flange) wear — it has no effect on vertical (crown) wear. The effectiveness depends strongly on curve radius: tight curves benefit most, wide curves and tangent track see minimal effect."
      },
      {
        type: "table",
        headers: ["Level", "R < 100m", "100–200m", "200–400m", "400–800m", "Tangent"],
        rows: [
          ["None", "×1.00", "×1.00", "×1.00", "×1.00", "×1.00"],
          ["Poor (badly maintained)", "×0.80", "×0.82", "×0.88", "×0.95", "×1.00"],
          ["Standard (wayside)", "×0.55", "×0.60", "×0.72", "×0.90", "×1.00"],
          ["Good (wayside + onboard)", "×0.35", "×0.40", "×0.60", "×0.85", "×1.00"],
          ["Optimal (lab conditions)", "×0.10", "×0.15", "×0.35", "×0.75", "×1.00"],
        ]
      },
      {
        type: "text",
        text: "⚠️ The 'Optimal' level corresponds to controlled laboratory tests (Swedish SJ reported up to 98% reduction). This is not achievable in continuous revenue service due to rain, leaves, varying traffic, and maintenance variability."
      },
      {
        type: "source",
        text: "Swedish SJ lubrication trials; Shanghai Metro wear study (2021); FRA FAST test facility data",
        link: "https://doi.org/10.1016/j.wear.2021.203851"
      }
    ]
  },
  {
    id: "rcf",
    title: "RCF — Rolling Contact Fatigue",
    icon: "🔬",
    content: [
      {
        type: "text",
        text: "RCF is the accumulation of surface and sub-surface cracks caused by repeated cyclic contact stresses. The RCF index in this simulator ranges from 0 (healthy) to 1 (critical, replacement required)."
      },
      {
        type: "param",
        name: "RCF rate by radius band",
        formula: "RCF_increment = RCF_base[band] × MGT × (1 − wear_protection)",
        impact: "Counterintuitively, moderate curves (R400–800m) have HIGHER RCF than tight curves. This is the 'magic wear rate' paradox: tight curves wear fast enough to remove surface cracks before they propagate.",
        source: "Infrabel / Int. Journal of Fatigue (2025) — 212 curves measured",
        link: "https://doi.org/10.1016/j.ijfatigue.2024.108456"
      },
      {
        type: "table",
        headers: ["Band", "Base RCF rate (metro)", "Explanation"],
        rows: [
          ["R < 100m", "0.002/MGT", "High wear removes cracks — low net RCF"],
          ["100–200m", "0.010/MGT", "Moderate wear, significant RCF"],
          ["200–400m", "0.016/MGT", "Peak RCF zone — insufficient wear to clean cracks"],
          ["400–800m", "0.010/MGT", "Head checks dominant in this range"],
          ["R ≥ 800m", "0.003/MGT", "Centered contact, low stress amplitude"],
        ]
      },
      {
        type: "param",
        name: "RCF zones",
        formula: "Green < 0.3 | Orange 0.3–0.7 | Red > 0.7",
        impact: "Green: preventive grinding removes all surface cracks. Orange: corrective grinding needed. Red: cracks too deep for grinding — replacement required.",
      }
    ]
  },
  {
    id: "grinding",
    title: "Grinding Strategy",
    icon: "⚙️",
    content: [
      {
        type: "text",
        text: "Two grinding strategies are modelled. The choice has a major impact on rail life and total maintenance cost."
      },
      {
        type: "table",
        headers: ["Parameter", "Preventive", "Corrective"],
        rows: [
          ["Trigger", "MGT interval (short)", "MGT interval (×3 longer)"],
          ["Passes per intervention", "1", "Up to 4"],
          ["Metal removal per pass", "0.20 mm", "0.55 mm"],
          ["RCF reduction per pass", "0.30 (effective)", "0.18 (less effective)"],
          ["Post-grind wear reduction", "−28% for ~0.85 × interval MGT", "−8% for ~0.40 × interval MGT"],
          ["Typical rail life", "400–600 MGT", "200–350 MGT"],
        ]
      },
      {
        type: "param",
        name: "Grinding intervals by context",
        formula: "—",
        impact: "Intervals are shorter for tram (low MGT/year, tight curves) and longer for heavy rail (high MGT, wider curves).",
        detail: "Example metro preventive intervals: 20 MGT (R<200m), 8 MGT (200–400m), 20 MGT (tangent). Corrective intervals are 3× longer.",
        source: "BNSF preventive-gradual program; Delhi Metro maintenance plan; Infrabel grinding strategy 2016",
        link: "https://doi.org/10.1016/j.wear.2019.203042"
      },
      {
        type: "param",
        name: "Metal reserve",
        formula: "Reserve = Initial − cumulative wear − Σ grinding removals",
        impact: "Each grinding pass consumes metal reserve. When reserve drops below 2mm, replacement is triggered regardless of wear limits.",
        detail: "Initial reserves: R200 → 13mm, R260 → 15mm, R320Cr → 16mm, R350HT → 17mm, R400HT → 18mm. Groove rail (tram): ~12mm (groove depth constraint)."
      }
    ]
  },
  {
    id: "replacement",
    title: "Replacement Criteria",
    icon: "🔧",
    content: [
      {
        type: "text",
        text: "Rail replacement is triggered when ANY of the following 4 conditions is met:"
      },
      {
        type: "table",
        headers: ["Criterion", "Tram", "Metro/LRT", "Heavy Rail", "Standard"],
        rows: [
          ["Max vertical wear", "7 mm", "9 mm", "12 mm", "EN 13674 / UIC 714"],
          ["Max lateral wear", "8 mm", "11 mm", "14 mm", "EN 13674"],
          ["Metal reserve < min", "2 mm", "2 mm", "2 mm", "Internal threshold"],
          ["RCF index ≥ 0.70", "—", "—", "—", "Cracks too deep for grinding"],
        ]
      },
      {
        type: "source",
        text: "EN 13674-1:2011 Rail — Vignole railway rails; UIC 714R — Classification of lines",
        link: "https://www.en-standard.eu/une-en-13674-1-2011"
      }
    ]
  },
  {
    id: "validation",
    title: "Validation & Calibration",
    icon: "✅",
    content: [
      {
        type: "text",
        text: "The Validation panel at the bottom of the simulator compares model predictions against published real-world measurements. Six reference cases are pre-loaded."
      },
      {
        type: "table",
        headers: ["Case", "Source", "Key finding"],
        rows: [
          ["Belgian network — tangent R260", "Infrabel/TU Delft 2023", "0.82 mm/100MGT vertical — matches model base rate"],
          ["Belgian network — R500m R260", "Infrabel/TU Delft 2023", "1.4 mm/100MGT vertical, 2.8 mm lateral"],
          ["Belgian network — R200 tangent", "Infrabel/TU Delft 2023", "+34% wear vs R260 on tangent"],
          ["Guangzhou Metro — R300m", "ScienceDirect Wear 2021", "2.1 mm/100MGT vertical, 6.5 mm lateral"],
          ["Guangzhou depot — R350m", "Railway Sciences 2022", "10.1 mm lateral after 1M passes (outer rail)"],
          ["Belgian RCF — R750–1000m", "Int. J. Fatigue 2025", "Peak head check growth at moderate curves"],
        ]
      },
      {
        type: "text",
        text: "Calibration guideline: error < 15% = good; 15–30% = acceptable (check lubrication, wheel profile); > 30% = recalibrate baseWearV or radius band f_v coefficients. Use the 'Add real measurement' button to enter your own project data."
      }
    ]
  },
  {
    id: "version",
    title: "Model Version & Limitations",
    icon: "ℹ️",
    content: [
      {
        type: "text",
        text: "Version 1.0 — Annual time-step simulation. Each year, wear and RCF accumulate based on MGT and segment parameters, then a grinding/replacement decision is made."
      },
      {
        type: "text",
        text: "Known limitations: (1) Single wear rate per segment — does not model inner/outer rail asymmetry within a curve. (2) Wheel profile evolution not modelled — assumes constant contact geometry. (3) No seasonal variation (wet/dry, leaf contamination). (4) Station braking zones not yet modelled as separate segments — manually add them as short tight-radius equivalent segments. (5) Coefficients calibrated primarily on European heavy rail and Chinese metro data — may need recalibration for other contexts."
      },
      {
        type: "text",
        text: "Planned improvements: cost model (€/km grinding, €/km replacement), side-by-side strategy comparison, export to PDF/Excel, station zone modelling."
      }
    ]
  }
];

function HelpModal({ onClose }) {
  const [activeSection, setActiveSection] = useState("overview");
  const section = HELP_SECTIONS.find(s => s.id === activeSection);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "40px 20px", overflowY: "auto",
    }}>
      <div style={{
        background: "linear-gradient(160deg, #0d1f2a 0%, #0a1820 100%)",
        border: "1px solid rgba(125,211,200,0.2)",
        borderRadius: 16, width: "100%", maxWidth: 1100,
        boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
        display: "flex", flexDirection: "column",
        maxHeight: "calc(100vh - 80px)",
      }}>
        {/* Modal header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "20px 28px", borderBottom: "1px solid rgba(125,211,200,0.12)",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 3, color: "#7dd3c8", fontWeight: 700, textTransform: "uppercase" }}>Rail Wear Simulator</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#e8f4f3" }}>Documentation & Methodology</div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8, color: "#c5ddd9", cursor: "pointer", fontSize: 18,
            width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>

        {/* Modal body */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Left nav */}
          <div style={{
            width: 220, flexShrink: 0, borderRight: "1px solid rgba(125,211,200,0.08)",
            padding: "16px 12px", overflowY: "auto",
          }}>
            {HELP_SECTIONS.map(s => (
              <div key={s.id} onClick={() => setActiveSection(s.id)} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 12px", borderRadius: 8, cursor: "pointer",
                background: activeSection === s.id ? "rgba(125,211,200,0.1)" : "transparent",
                borderLeft: activeSection === s.id ? "3px solid #7dd3c8" : "3px solid transparent",
                marginBottom: 4, transition: "all 0.15s",
              }}>
                <span style={{ fontSize: 16 }}>{s.icon}</span>
                <span style={{ fontSize: 12, color: activeSection === s.id ? "#e8f4f3" : "#6bb5af", fontWeight: activeSection === s.id ? 600 : 400, lineHeight: 1.3 }}>
                  {s.title}
                </span>
              </div>
            ))}
          </div>

          {/* Content area */}
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
            <div style={{ fontSize: 11, color: "#7dd3c8", letterSpacing: 3, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>
              {section?.icon} {section?.id.toUpperCase()}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#e8f4f3", marginBottom: 20 }}>{section?.title}</div>

            {section?.content.map((block, i) => {
              if (block.type === "text") return (
                <p key={i} style={{ fontSize: 13, color: "#a0bfbb", lineHeight: 1.8, marginBottom: 16 }}>{block.text}</p>
              );

              if (block.type === "param") return (
                <div key={i} style={{
                  background: "rgba(125,211,200,0.04)", border: "1px solid rgba(125,211,200,0.12)",
                  borderRadius: 10, padding: "16px 20px", marginBottom: 14,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#7dd3c8", marginBottom: 8 }}>{block.name}</div>
                  {block.formula && block.formula !== "—" && (
                    <div style={{
                      fontFamily: "'DM Mono', monospace", fontSize: 12,
                      background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "8px 12px",
                      color: "#a78bfa", marginBottom: 10, overflowX: "auto",
                    }}>{block.formula}</div>
                  )}
                  <div style={{ fontSize: 13, color: "#c5ddd9", marginBottom: block.detail ? 8 : 0, lineHeight: 1.7 }}>
                    <b style={{ color: "#fbbf24" }}>Impact:</b> {block.impact}
                  </div>
                  {block.detail && (
                    <div style={{ fontSize: 12, color: "#8899aa", lineHeight: 1.7 }}>{block.detail}</div>
                  )}
                  {block.source && (
                    <div style={{ fontSize: 11, color: "#6bb5af", marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
                      📄 {block.link
                        ? <a href={block.link} target="_blank" rel="noreferrer" style={{ color: "#7dd3c8", textDecoration: "underline" }}>{block.source}</a>
                        : block.source}
                    </div>
                  )}
                </div>
              );

              if (block.type === "table") return (
                <div key={i} style={{ overflowX: "auto", marginBottom: 16 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "rgba(125,211,200,0.08)" }}>
                        {block.headers.map(h => (
                          <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#7dd3c8", fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid rgba(125,211,200,0.15)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, ri) => (
                        <tr key={ri} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: ri % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent" }}>
                          {row.map((cell, ci) => (
                            <td key={ci} style={{ padding: "8px 12px", color: ci === 0 ? "#e8f4f3" : "#8899aa", fontFamily: ci > 0 && ci < row.length - 1 ? "'DM Mono', monospace" : "inherit", fontSize: 12 }}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );

              if (block.type === "source") return (
                <div key={i} style={{ fontSize: 11, color: "#6bb5af", marginTop: 8, padding: "8px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 6 }}>
                  📄 {block.link
                    ? <a href={block.link} target="_blank" rel="noreferrer" style={{ color: "#7dd3c8", textDecoration: "underline" }}>{block.text}</a>
                    : block.text}
                </div>
              );

              return null;
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 28px", borderTop: "1px solid rgba(125,211,200,0.08)",
          fontSize: 11, color: "#3a5a64", display: "flex", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <span>Rail Wear Simulator v1.0 — Coefficients from EN 13674, UIC 714, Infrabel/TU Delft 2023, Guangzhou Metro 2021–2022</span>
          <span style={{ color: "#6bb5af", cursor: "pointer" }} onClick={onClose}>Close ✕</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function RailSimulator() {
  const [context, setContext] = useState("metro");
  const [trains, setTrains] = useState([
    { id: 1, label: "Type A", trainsPerDay: 200, axleLoad: 14, bogies: 4, axlesPerBogie: 2 }
  ]);
  // Segments basés sur les 5 tranches de rayon — toujours présentes, activables/désactivables
  // Chaque tranche a : actif, longueur km, grade rail, rayon représentatif (ajustable dans la tranche)
  const [segments, setSegments] = useState([
    { id: "r1", bandId: "r1", label: "R < 100 m",        active: false, lengthKm: 0,   railGrade: "R400HT", radiusRepr: 75  },
    { id: "r2", bandId: "r2", label: "100 ≤ R < 200 m",  active: false, lengthKm: 0,   railGrade: "R350HT", radiusRepr: 150 },
    { id: "r3", bandId: "r3", label: "200 ≤ R < 400 m",  active: true,  lengthKm: 1.5, railGrade: "R320Cr", radiusRepr: 300 },
    { id: "r4", bandId: "r4", label: "400 ≤ R < 800 m",  active: true,  lengthKm: 2.0, railGrade: "R320Cr", radiusRepr: 600 },
    { id: "r5", bandId: "r5", label: "R ≥ 800 m (Align.)",active: true,  lengthKm: 6.5, railGrade: "R260",   radiusRepr: 9999},
  ]);
  const [railType, setRailType] = useState("vignole");
  const [trackMode, setTrackMode] = useState("ballast");
  const [speed, setSpeed] = useState(80);
  const [lubrication, setLubrication] = useState("none");
  const [strategy, setStrategy] = useState("preventive");
  const [horizonYears, setHorizonYears] = useState(30);
  const [activeSegIdx, setActiveSegIdx] = useState(0);
  const [simResult, setSimResult] = useState(null);
  const [tab, setTab] = useState("wear");
  const [hasRun, setHasRun] = useState(false);

  const addTrain = () => setTrains(t => [...t, {
    id: Date.now(), label: `Type ${String.fromCharCode(65 + t.length)}`,
    trainsPerDay: 100, axleLoad: 14, bogies: 4, axlesPerBogie: 2
  }]);

  const removeTrain = id => setTrains(t => t.filter(x => x.id !== id));
  const updateTrain = (id, field, val) => setTrains(t => t.map(x => x.id === id ? { ...x, [field]: val } : x));

  const updateSegment = (id, field, val) => setSegments(s => s.map(x => x.id === id ? { ...x, [field]: val } : x));
  const toggleSegment = (id) => setSegments(s => s.map(x => x.id === id ? { ...x, active: !x.active, lengthKm: x.active ? 0 : (x.lengthKm || 1.0) } : x));

  const [simError, setSimError] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

  const runSim = useCallback(() => {
    const segs = segments
      .filter(s => s.active && s.lengthKm > 0)
      .map(s => ({ ...s, radius: s.radiusRepr }));
    if (segs.length === 0) {
      setSimError("Activez au moins une tranche de rayon avec une longueur > 0.");
      return;
    }
    try {
      setSimError(null);
      const result = simulate({ context, trains, segments: segs, strategy, railType, trackMode, speed, lubrication, horizonYears });
      setSimResult(result);
      setActiveSegIdx(0);
      setHasRun(true);
    } catch(e) {
      setSimError("Erreur : " + e.message);
      console.error(e);
    }
  }, [context, trains, segments, strategy, railType, trackMode, speed, lubrication, horizonYears]);

  const activeSeg = simResult?.results[activeSegIdx];
  const mgtPreview = useMemo(() => computeMGT(trains).toFixed(2), [trains]);
  const eqMgtPreview = useMemo(() => computeEquivMGT(trains, context).toFixed(2), [trains, context]);

  return (
    <div style={{
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      background: "linear-gradient(135deg, #0a1a22 0%, #0d2030 50%, #091820 100%)",
      minHeight: "100vh",
      color: "#c8ddd9",
      padding: "0 0 60px",
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid rgba(125,211,200,0.12)",
        padding: "20px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(0,0,0,0.2)",
        backdropFilter: "blur(10px)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 4, color: "#7dd3c8", fontWeight: 700, textTransform: "uppercase" }}>Rail Maintenance</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#e8f4f3", letterSpacing: -0.5 }}>Simulateur d'Usure & Maintenance</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 12, color: "#6bb5af", marginRight: 8 }}>
            MGT brut: <b style={{ color: "#7dd3c8" }}>{mgtPreview}</b> /an &nbsp;|&nbsp;
            MGT éq: <b style={{ color: "#7dd3c8" }}>{eqMgtPreview}</b> /an
          </div>
          <Btn onClick={() => setShowHelp(true)} small>📖 Help & Methods</Btn>
          <Btn onClick={runSim} active>▶ Run Simulation</Btn>
        </div>
      </div>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 0, maxWidth: 1400, margin: "0 auto", padding: "24px 24px 0" }}>
        {/* LEFT PANEL — Parameters */}
        <div style={{ paddingRight: 20 }}>

          {/* Context */}
          <Section title="Contexte">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.entries(CONTEXT_PRESETS).map(([k, v]) => (
                <Btn key={k} onClick={() => setContext(k)} active={context === k}>{v.label}</Btn>
              ))}
            </div>
          </Section>

          {/* Train Fleet */}
          <Section title="Flotte de Trains">
            {trains.map((tr, i) => (
              <div key={tr.id} style={{
                background: "rgba(255,255,255,0.03)", borderRadius: 8,
                padding: "12px", marginBottom: 10, border: "1px solid rgba(255,255,255,0.06)"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <Input value={tr.label} onChange={v => updateTrain(tr.id, "label", v)} type="text" style={{ width: 120, fontSize: 12 }} />
                  {trains.length > 1 && (
                    <button onClick={() => removeTrain(tr.id)} style={{
                      background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16
                    }}>×</button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><Label>Passages/jour (une voie, un sens)</Label><Input value={tr.trainsPerDay} onChange={v => updateTrain(tr.id, "trainsPerDay", v)} min={1} /></div>
                  <div><Label>Charge essieu (t)</Label><Input value={tr.axleLoad} onChange={v => updateTrain(tr.id, "axleLoad", v)} min={5} max={35} step={0.5} /></div>
                  <div><Label>Nb bogies</Label><Input value={tr.bogies} onChange={v => updateTrain(tr.id, "bogies", v)} min={2} max={16} /></div>
                  <div><Label>Essieux/bogie</Label><Input value={tr.axlesPerBogie} onChange={v => updateTrain(tr.id, "axlesPerBogie", v)} min={2} max={4} /></div>
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: "#6bb5af" }}>
                  Tonnage brut: <b style={{ color: "#7dd3c8" }}>{(tr.axleLoad * tr.bogies * tr.axlesPerBogie).toFixed(0)} t</b>
                  &nbsp;→&nbsp;
                  <b style={{ color: "#7dd3c8" }}>{((tr.trainsPerDay * tr.axleLoad * tr.bogies * tr.axlesPerBogie * 365) / 1e6).toFixed(2)} MGT/an</b>
                </div>
              </div>
            ))}
            <Btn onClick={addTrain} small>+ Ajouter un type de train</Btn>
          </Section>

          {/* Segments — Tranches de rayon prédéfinies */}
          <Section title="Répartition de la Voie par Tranche de Rayon">
            <div style={{ fontSize: 11, color: "#6bb5af", marginBottom: 12, lineHeight: 1.6 }}>
              Activez les tranches présentes sur votre ligne et saisissez la longueur correspondante.
              Toutes les tranches sont couvertes — aucun oubli possible.
            </div>
            {/* Total longueur */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "6px 10px", background: "rgba(125,211,200,0.06)", borderRadius: 6 }}>
              <span style={{ fontSize: 11, color: "#6bb5af" }}>Longueur totale active</span>
              <span style={{ fontFamily: "'DM Mono', monospace", color: "#7dd3c8", fontWeight: 700 }}>
                {segments.filter(s => s.active).reduce((a, s) => a + (s.lengthKm || 0), 0).toFixed(1)} km
              </span>
            </div>
            {segments.map((seg) => {
              const rb = RADIUS_BANDS.find(r => r.id === seg.bandId);
              const bandColor = seg.active ? "#7dd3c8" : "#3a5a64";
              return (
                <div key={seg.id} style={{
                  background: seg.active ? "rgba(125,211,200,0.04)" : "rgba(255,255,255,0.02)",
                  borderRadius: 8, padding: "10px 12px", marginBottom: 8,
                  border: `1px solid ${seg.active ? "rgba(125,211,200,0.2)" : "rgba(255,255,255,0.05)"}`,
                  transition: "all 0.2s",
                }}>
                  {/* Header row : toggle + label + f_rayon badge */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: seg.active ? 10 : 0 }}>
                    <div onClick={() => toggleSegment(seg.id)} style={{
                      width: 32, height: 18, borderRadius: 9,
                      background: seg.active ? "#7dd3c8" : "rgba(255,255,255,0.08)",
                      position: "relative", cursor: "pointer", flexShrink: 0,
                      border: `1px solid ${seg.active ? "#7dd3c8" : "rgba(255,255,255,0.15)"}`,
                      transition: "background 0.2s",
                    }}>
                      <div style={{
                        width: 12, height: 12, borderRadius: "50%", background: "#fff",
                        position: "absolute", top: 2, left: seg.active ? 16 : 2, transition: "left 0.2s",
                      }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: seg.active ? "#e8f4f3" : "#4a6a74", flex: 1 }}>
                      {seg.label}
                    </span>
                    {rb && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <span style={{ fontSize: 10, background: "rgba(125,211,200,0.1)", color: "#7dd3c8", borderRadius: 4, padding: "2px 6px" }}>
                          f_V×{rb.f_v}
                        </span>
                        <span style={{ fontSize: 10, background: "rgba(251,191,36,0.1)", color: "#fbbf24", borderRadius: 4, padding: "2px 6px" }}>
                          f_L×{rb.f_l}
                        </span>
                      </div>
                    )}
                  </div>
                  {/* Detail row — only when active */}
                  {seg.active && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      <div>
                        <Label>Longueur (km)</Label>
                        <Input value={seg.lengthKm} onChange={v => updateSegment(seg.id, "lengthKm", v)} min={0.1} step={0.1} />
                      </div>
                      <div>
                        <Label>Rayon représentatif (m)</Label>
                        <Input
                          value={seg.radiusRepr}
                          onChange={v => updateSegment(seg.id, "radiusRepr", Math.max(rb?.rMin || 1, Math.min((rb?.rMax || 99999) - 1, v)))}
                          min={rb?.rMin || 1} max={(rb?.rMax || 99999) - 1}
                        />
                        <div style={{ fontSize: 10, color: "#6bb5af", marginTop: 2 }}>
                          {seg.radiusRepr >= 9000 ? "alignement" : `R = ${seg.radiusRepr} m`}
                        </div>
                      </div>
                      <div>
                        <Label>Grade / Dureté</Label>
                        <Select
                          value={seg.railGrade}
                          onChange={v => updateSegment(seg.id, "railGrade", v)}
                          options={Object.entries(RAIL_GRADES).map(([k, v]) => ({ value: k, label: k }))}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ fontSize: 10, color: "#4a6a74", marginTop: 6, lineHeight: 1.5 }}>
              💡 Grade conseillé par défaut : R400HT (R&lt;100m) · R350HT (100–200m) · R320Cr (200–800m) · R260 (alignement)
            </div>
          </Section>

          {/* Rail Parameters */}
          <Section title="Paramètres Rail (communs à tous segments)">
            <div style={{ display: "grid", gap: 10 }}>
              <div><Label>Type de Rail</Label><Select value={railType} onChange={setRailType} options={Object.entries(RAIL_TYPES).map(([k, v]) => ({ value: k, label: v.label }))} /></div>
              <div><Label>Mode de Pose</Label><Select value={trackMode} onChange={setTrackMode} options={Object.entries(TRACK_MODES).map(([k, v]) => ({ value: k, label: v.label }))} /></div>
              <div><Label>Vitesse commerciale (km/h)</Label><Input value={speed} onChange={setSpeed} min={20} max={320} /></div>
              <div>
                <Label>Lubrification de joue en courbe</Label>
                <Select
                  value={lubrication}
                  onChange={setLubrication}
                  options={Object.entries(LUBRICATION_LEVELS).map(([k, v]) => ({ value: k, label: v.label }))}
                />
                <div style={{ marginTop: 6, fontSize: 11, color: "#6bb5af", lineHeight: 1.5 }}>
                  {lubrication === "none"     && "Aucune réduction d'usure latérale — conditions sèches"}
                  {lubrication === "poor"     && "Système mal entretenu, graisse insuffisante ou hors service fréquent — réduction faible"}
                  {lubrication === "standard" && "Wayside correctement réglé et maintenu — réduction significative en courbes serrées"}
                  {lubrication === "good"     && "Wayside + embarqué combinés — bonne couverture sur toutes les courbes"}
                  {lubrication === "optimal"  && "⚠️ Conditions idéales (labo/essais) — irréaliste en exploitation continue"}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#6bb5af", background: "rgba(125,211,200,0.05)", borderRadius: 6, padding: "8px 10px", border: "1px solid rgba(125,211,200,0.1)" }}>
                ℹ️ La dureté du rail (grade) se définit <b style={{color:"#7dd3c8"}}>par segment</b> dans la section ci-dessus
              </div>
            </div>
          </Section>

          {/* Strategy */}
          <Section title="Stratégie de Maintenance">
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <Btn onClick={() => setStrategy("preventive")} active={strategy === "preventive"}>Préventif</Btn>
              <Btn onClick={() => setStrategy("corrective")} active={strategy === "corrective"}>Correctif</Btn>
            </div>
            <div style={{ fontSize: 12, color: "#6bb5af", lineHeight: 1.6 }}>
              {strategy === "preventive"
                ? "✅ Meulage fréquent (intervalles courts). 1 passe légère ~0,2 mm. RCF maintenu bas. Profil restauré = taux d'usure futur réduit. → Durée de vie maximale."
                : "⚠️ Meulage déclenché par seuils (intervalles 3× plus longs). 4 passes lourdes ~2,2 mm. RCF monte haut avant intervention. Réserve métal consommée vite. → Durée de vie plus courte."}
            </div>
            <div style={{ marginTop: 12 }}>
              <Label>Horizon de simulation (années)</Label>
              <Input value={horizonYears} onChange={setHorizonYears} min={5} max={50} />
            </div>
          </Section>
        </div>

        {/* RIGHT PANEL — Results */}
        <div>
          {simError && (
            <div style={{ background:"rgba(248,113,113,0.1)", border:"1px solid rgba(248,113,113,0.3)", borderRadius:10, padding:"14px 18px", marginBottom:16, color:"#f87171", fontSize:13 }}>
              ⚠️ {simError}
            </div>
          )}
          {!hasRun && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              height: 400, color: "#4a6a74", textAlign: "center", gap: 16,
              border: "1px dashed rgba(125,211,200,0.15)", borderRadius: 16,
            }}>
              <div style={{ fontSize: 48 }}>⚙️</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#6bb5af" }}>Configurez les paramètres et lancez la simulation</div>
              <div style={{ fontSize: 13 }}>Le simulateur calculera l'usure, les cycles de meulage<br />et les échéances de remplacement pour chaque segment</div>
              <Btn onClick={runSim} active>▶ Lancer la Simulation</Btn>
            </div>
          )}

          {hasRun && simResult && (
            <>
              {/* KPI Row */}
              <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                <Stat label="MGT Brut / an" value={simResult.mgtPerYear.toFixed(2)} unit="MGT" />
                <Stat label="MGT Équivalent / an" value={simResult.eqMgtPerYear.toFixed(2)} unit="MGT éq." />
                <Stat
                  label="Remplacement le + tôt"
                  value={Math.min(...simResult.results.map(r => r.replacementYear || horizonYears + 1)) <= horizonYears
                    ? `An ${Math.min(...simResult.results.map(r => r.replacementYear || horizonYears + 1))}`
                    : `> ${horizonYears} ans`}
                  unit=""
                  warn={Math.min(...simResult.results.map(r => r.replacementYear || horizonYears + 1)) <= horizonYears * 0.5}
                />
                <Stat
                  label="Meulages totaux (tous segments)"
                  value={simResult.results.reduce((a, r) => a + r.grindCount, 0)}
                  unit="passages"
                />
              </div>

              {/* Segment Selector */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {simResult.results.map((r, i) => (
                  <Btn key={i} onClick={() => setActiveSegIdx(i)} active={activeSegIdx === i} small>
                    {r.seg.label}
                    {r.replacementYear && <span style={{ marginLeft: 6, opacity: 0.7 }}>⚠ An {r.replacementYear}</span>}
                  </Btn>
                ))}
              </div>

              {/* Segment Detail */}
              {activeSeg && (
                <>
                  {/* Segment KPIs */}
                  <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                    <Stat label="Rayon" value={activeSeg.seg.radius} unit="m" />
                    <Stat label="Longueur" value={activeSeg.seg.lengthKm} unit="km" />
                    <Stat label="Taux usure V" value={activeSeg.wearRateV.toFixed(3)} unit="mm/100MGT" />
                    <Stat label="Taux usure L" value={activeSeg.wearRateL.toFixed(3)} unit="mm/100MGT" />
                    <Stat
                      label="Remplacement"
                      value={activeSeg.replacementYear ? `An ${activeSeg.replacementYear}` : `> ${horizonYears} ans`}
                      unit=""
                      warn={!!activeSeg.replacementYear && activeSeg.replacementYear < horizonYears * 0.6}
                    />
                    <Stat label="Meulages" value={activeSeg.grindCount} unit="passages" />
                  </div>

                  {/* Tabs */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                    {[
                      { id: "wear", label: "Usure Verticale & Latérale" },
                      { id: "rcf", label: "Index RCF" },
                      { id: "reserve", label: "Réserve de Métal" },
                      { id: "planning", label: "Planning Maintenance" },
                    ].map(t => (
                      <Btn key={t.id} onClick={() => setTab(t.id)} active={tab === t.id} small>{t.label}</Btn>
                    ))}
                  </div>

                  {/* Chart Area */}
                  <div style={{
                    background: "rgba(0,0,0,0.2)", borderRadius: 12,
                    padding: "20px", border: "1px solid rgba(125,211,200,0.1)",
                    marginBottom: 16,
                  }}>
                    {tab === "wear" && (
                      <>
                        <div style={{ fontSize: 12, color: "#6bb5af", marginBottom: 16 }}>
                          Évolution de l'usure — Limite V: <b style={{ color: "#f87171" }}>{activeSeg.limitV} mm</b> &nbsp;|&nbsp; Limite L: <b style={{ color: "#fbbf24" }}>{activeSeg.limitL} mm</b>
                        </div>
                        <ResponsiveContainer width="100%" height={280}>
                          <AreaChart data={activeSeg.yearData}>
                            <defs>
                              <linearGradient id="gV" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#7dd3c8" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#7dd3c8" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="gL" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="year" stroke="#4a6a74" tick={{ fontSize: 11 }} label={{ value: "Années", position: "insideBottom", offset: -2, fill: "#4a6a74", fontSize: 11 }} />
                            <YAxis stroke="#4a6a74" tick={{ fontSize: 11 }} unit=" mm" />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <ReferenceLine y={activeSeg.limitV} stroke="#f87171" strokeDasharray="6 3" label={{ value: `Limite V=${activeSeg.limitV}mm`, fill: "#f87171", fontSize: 10 }} />
                            <ReferenceLine y={activeSeg.limitL} stroke="#fbbf24" strokeDasharray="6 3" label={{ value: `Limite L=${activeSeg.limitL}mm`, fill: "#fbbf24", fontSize: 10 }} />
                            <Area type="monotone" dataKey="wearV" name="Usure Verticale (mm)" stroke="#7dd3c8" fill="url(#gV)" strokeWidth={2} dot={false} />
                            <Area type="monotone" dataKey="wearL" name="Usure Latérale (mm)" stroke="#fbbf24" fill="url(#gL)" strokeWidth={2} dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </>
                    )}

                    {tab === "rcf" && (
                      <>
                        <div style={{ fontSize: 12, color: "#6bb5af", marginBottom: 16 }}>
                          Index RCF — Vert &lt; 0.3 (sain) | Orange 0.3–0.7 (modéré) | Rouge &gt; 0.7 (critique / remplacement)
                        </div>
                        <ResponsiveContainer width="100%" height={280}>
                          <AreaChart data={activeSeg.yearData}>
                            <defs>
                              <linearGradient id="gRCF" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f87171" stopOpacity={0.4} />
                                <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="year" stroke="#4a6a74" tick={{ fontSize: 11 }} />
                            <YAxis stroke="#4a6a74" tick={{ fontSize: 11 }} domain={[0, 1]} />
                            <Tooltip content={<CustomTooltip />} />
                            <ReferenceLine y={0.3} stroke="#4ade80" strokeDasharray="4 4" label={{ value: "Préventif", fill: "#4ade80", fontSize: 10 }} />
                            <ReferenceLine y={0.7} stroke="#f87171" strokeDasharray="4 4" label={{ value: "Remplacement", fill: "#f87171", fontSize: 10 }} />
                            <Area type="monotone" dataKey="rcf" name="Index RCF" stroke="#f87171" fill="url(#gRCF)" strokeWidth={2} dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </>
                    )}

                    {tab === "reserve" && (
                      <>
                        <div style={{ fontSize: 12, color: "#6bb5af", marginBottom: 16 }}>
                          Réserve de métal meulable restante (mm) — Seuil minimum: 2 mm
                        </div>
                        <ResponsiveContainer width="100%" height={280}>
                          <AreaChart data={activeSeg.yearData}>
                            <defs>
                              <linearGradient id="gRes" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.4} />
                                <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="year" stroke="#4a6a74" tick={{ fontSize: 11 }} />
                            <YAxis stroke="#4a6a74" tick={{ fontSize: 11 }} unit=" mm" />
                            <Tooltip content={<CustomTooltip />} />
                            <ReferenceLine y={2} stroke="#f87171" strokeDasharray="4 4" label={{ value: "Seuil min 2mm", fill: "#f87171", fontSize: 10 }} />
                            <Area type="monotone" dataKey="reserve" name="Réserve (mm)" stroke="#a78bfa" fill="url(#gRes)" strokeWidth={2} dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </>
                    )}

                    {tab === "planning" && (
                      <>
                        <div style={{ fontSize: 12, color: "#6bb5af", marginBottom: 16 }}>
                          Interventions de meulage (barres vertes) et remplacement (barre rouge)
                        </div>
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={activeSeg.yearData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="year" stroke="#4a6a74" tick={{ fontSize: 11 }} />
                            <YAxis stroke="#4a6a74" tick={{ fontSize: 11 }} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Bar dataKey="ground" name="Meulage" fill="#4ade80" opacity={0.8} radius={[3, 3, 0, 0]} />
                            <Bar dataKey="replaced" name="Remplacement" fill="#f87171" opacity={0.9} radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </>
                    )}
                  </div>

                  {/* Summary table */}
                  <div style={{
                    background: "rgba(0,0,0,0.15)", borderRadius: 10,
                    border: "1px solid rgba(125,211,200,0.08)", overflow: "hidden",
                  }}>
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11, letterSpacing: 2, color: "#7dd3c8", textTransform: "uppercase", fontWeight: 700 }}>
                      Résumé — Tous Segments
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                            {["Segment", "Rayon", "Grade", "F.Dureté eff.", "Taux U.V.", "Taux U.L.", "Meulages", "Remplacement", "RCF Final"].map(h => (
                              <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#6bb5af", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {simResult.results.map((r, i) => {
                            const lastPt = r.yearData[r.yearData.length - 1];
                            return (
                              <tr
                                key={i}
                                onClick={() => setActiveSegIdx(i)}
                                style={{
                                  borderTop: "1px solid rgba(255,255,255,0.04)",
                                  cursor: "pointer",
                                  background: activeSegIdx === i ? "rgba(125,211,200,0.05)" : "transparent",
                                }}
                              >
                                <td style={{ padding: "8px 12px", color: "#e8f4f3", fontWeight: 500 }}>{r.seg.label}</td>
                                <td style={{ padding: "8px 12px", fontFamily: "'DM Mono', monospace" }}>{r.seg.radius} m</td>
                                <td style={{ padding: "8px 12px", fontFamily: "'DM Mono', monospace", color: "#a78bfa" }}>{r.seg.railGrade}</td>
                                <td style={{ padding: "8px 12px", fontFamily: "'DM Mono', monospace", color: "#fbbf24" }}>{r.hardnessEffect?.toFixed(2)}</td>
                                <td style={{ padding: "8px 12px", fontFamily: "'DM Mono', monospace", color: "#7dd3c8" }}>{r.wearRateV.toFixed(3)}</td>
                                <td style={{ padding: "8px 12px", fontFamily: "'DM Mono', monospace", color: "#fbbf24" }}>{r.wearRateL.toFixed(3)}</td>
                                <td style={{ padding: "8px 12px", fontFamily: "'DM Mono', monospace" }}>{r.grindCount}</td>
                                <td style={{ padding: "8px 12px" }}>
                                  {r.replacementYear
                                    ? <span style={{ color: "#f87171", fontWeight: 700 }}>An {r.replacementYear}</span>
                                    : <span style={{ color: "#4ade80" }}>&gt; {horizonYears} ans</span>}
                                </td>
                                <td style={{ padding: "8px 12px" }}>
                                  {lastPt && <RCFBadge value={lastPt.rcf} />}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* VALIDATION SECTION */}
      <ValidationPanel simResult={simResult} context={context} />

      {/* Footer */}
      <div style={{ textAlign: "center", marginTop: 40, fontSize: 11, color: "#3a5a64", letterSpacing: 1 }}>
        Coefficients basés sur littérature scientifique (EN13674, UIC, BNSF, Delhi Metro, réseau belge — TU Delft 2023) — Calibrage continu sur données terrain
      </div>
    </div>
  );
}

