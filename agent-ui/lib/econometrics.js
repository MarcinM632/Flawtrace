// Econometric model builder: ordinary least squares (OLS) multiple linear regression, computed
// in plain JS (no dependency — this app has zero). Given a dependent variable (y) and one or more
// explanatory variables (X), it fits y = b0 + b1*x1 + ... + bk*xk by the normal equations, then
// reports the full standard diagnostic set a correct OLS write-up needs — not just the headline
// R²: standard errors, t-stats and p-values per coefficient (is this effect distinguishable from
// noise), VIF per predictor (multicollinearity — two explanatory variables fighting over the same
// signal make individual coefficients meaningless even when the model fits well), the F-test (is
// the model as a whole better than predicting the mean), and Durbin–Watson (serial correlation —
// only meaningful when rows are a time series, i.e. the "week" granularity in lib/metrics.js).
// Every number here is computed from the caller's data; nothing is invented or estimated by a
// model call — the LLM step (lib/metrics.js aiInterpretation) only narrates numbers already in
// this report.

/** n x n matrix inverse by Gauss-Jordan elimination with partial pivoting. Throws if singular
 * (perfectly collinear columns — e.g. two explanatory variables that are the same up to scale). */
function invert(m) {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) < 1e-10) throw new Error('The explanatory variables are perfectly or near-perfectly collinear — drop one of them.');
    [a[col], a[piv]] = [a[piv], a[col]];
    const d = a[col][col];
    for (let c = 0; c < 2 * n; c++) a[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (!f) continue;
      for (let c = 0; c < 2 * n; c++) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((row) => row.slice(n));
}
const matMulT = (a, b) => { // a^T * b, a: n x p, b: n x q -> p x q
  const p = a[0].length, q = b[0].length, n = a.length, out = Array.from({ length: p }, () => new Array(q).fill(0));
  for (let i = 0; i < p; i++) for (let j = 0; j < q; j++) { let s = 0; for (let k = 0; k < n; k++) s += a[k][i] * b[k][j]; out[i][j] = s; }
  return out;
};
const matMul = (a, b) => { // a: m x p, b: p x q -> m x q
  const m = a.length, p = a[0].length, q = b[0].length, out = Array.from({ length: m }, () => new Array(q).fill(0));
  for (let i = 0; i < m; i++) for (let j = 0; j < q; j++) { let s = 0; for (let k = 0; k < p; k++) s += a[i][k] * b[k][j]; out[i][j] = s; }
  return out;
};

// Student-t two-tailed p-value via the regularized incomplete beta function — the standard way to
// get a t-distribution p-value without a stats library.
function logGamma(x) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function betacf(x, a, b) {
  const MAXIT = 200, EPS = 3e-9, FPMIN = 1e-30;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function betainc(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(x, a, b) / a : 1 - bt * betacf(1 - x, b, a) / b;
}
/** Two-tailed p-value for a t-statistic with `df` degrees of freedom. */
function tTestPValue(t, df) { if (!Number.isFinite(t) || df <= 0) return null; return betainc(df / (df + t * t), df / 2, 0.5); }
/** Right-tail p-value for an F-statistic (df1, df2). */
function fTestPValue(f, df1, df2) { if (!Number.isFinite(f) || f <= 0 || df1 <= 0 || df2 <= 0) return null; return betainc(df2 / (df2 + df1 * f), df2 / 2, df1 / 2); }

/** Pearson correlation coefficient — used for pairwise VIF and the quick correlation matrix. */
function corr(xs, ys) {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return (sxx && syy) ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** Fits y on X (X has no intercept column — one is added here) and returns the full diagnostic
 * report. `names` labels each column of X in the same order. `ordered` marks the rows as a time
 * series (enables the Durbin–Watson check); otherwise rows are treated as cross-sectional (e.g.
 * one row per service) and DW is omitted since it has no meaning without a row order. */
function regress(y, X, names, ordered) {
  const n = y.length, k = names.length;
  if (n !== X.length) throw new Error('y and X must have the same number of rows');
  if (n < k + 2) throw new Error(`Not enough rows: ${n} rows for ${k} explanatory variable${k === 1 ? '' : 's'} — need at least ${k + 2} (one per variable plus the intercept, plus one to spare).`);
  const Xi = X.map((row) => [1, ...row]); // intercept column
  const XtX = matMulT(Xi, Xi);
  const XtXinv = invert(XtX);
  const Xty = matMulT(Xi, y.map((v) => [v]));
  const betaCol = matMul(XtXinv, Xty);
  const beta = betaCol.map((r) => r[0]);
  const fitted = Xi.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0));
  const resid = y.map((v, i) => v - fitted[i]);
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = resid.reduce((s, e) => s + e * e, 0);
  const ssReg = ssTot - ssRes;
  const dfResid = n - (k + 1);
  const mse = dfResid > 0 ? ssRes / dfResid : NaN;
  const se = Array.from({ length: k + 1 }, (_, j) => Math.sqrt(Math.max(0, mse * XtXinv[j][j])));
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const adjR2 = dfResid > 0 ? 1 - (1 - r2) * (n - 1) / dfResid : null;
  const fStat = (k > 0 && dfResid > 0 && mse > 0) ? (ssReg / k) / mse : null;
  const fPValue = fStat != null ? fTestPValue(fStat, k, dfResid) : null;
  const coefNames = ['Intercept', ...names];
  const coefficients = coefNames.map((name, j) => {
    const b = beta[j], s = se[j], t = s ? b / s : null;
    const p = t != null ? tTestPValue(t, dfResid) : null;
    return { name, beta: b, se: s, t, p, significant: p != null && p < 0.05 };
  });
  // VIF per explanatory variable: regress each X column on the rest; VIF = 1/(1-R²_j). VIF > 10 is
  // the usual rule-of-thumb flag for problematic multicollinearity (Kutner et al., Applied Linear
  // Statistical Models — the standard econometrics-methodology reference for this check).
  const vif = names.map((_, j) => {
    if (k < 2) return 1;
    const others = names.map((__, jj) => jj).filter((jj) => jj !== j);
    try {
      const sub = regress(X.map((row) => row[j]), X.map((row) => others.map((jj) => row[jj])), others.map((jj) => names[jj]), false);
      return sub.r2 >= 1 ? Infinity : 1 / (1 - sub.r2);
    } catch (_) { return null; } // collinear sub-regression — VIF is effectively infinite/undefined
  });
  coefficients.slice(1).forEach((c, j) => { c.vif = vif[j]; });
  // Durbin–Watson: sum((e_t - e_{t-1})^2) / sum(e_t^2). ~2 = no autocorrelation, <1 or >3 flags it.
  // Only reported for time-ordered rows — on cross-sectional data (one row per service) there is no
  // "next" row, so the statistic would be meaningless.
  let durbinWatson = null;
  if (ordered && resid.length > 1) {
    let num = 0; for (let i = 1; i < resid.length; i++) num += (resid[i] - resid[i - 1]) ** 2;
    durbinWatson = num / ssRes;
  }
  // Pairwise correlation matrix of the explanatory variables, for the heatmap — the quick visual
  // companion to the VIF numbers (high |corr| between two X's is the usual cause of high VIF).
  const corrMatrix = names.map((_, i) => names.map((__, j) => corr(X.map((r) => r[i]), X.map((r) => r[j]))));
  // Methodology flags: plain-English notices about assumptions that may not hold, so the reader
  // (human or the AI narrator) treats the numbers with the right amount of caution instead of
  // over-reading a small or shaky model. Nothing here is a guess about the data's meaning — each
  // check is a known OLS diagnostic threshold.
  const flags = [];
  if (n < 30) flags.push(`Small sample (n=${n}): coefficient estimates are indicative only, not statistically reliable the way a larger sample would be.`);
  vif.forEach((v, j) => { if (v != null && v > 10) flags.push(`High multicollinearity: "${names[j]}" has VIF ${v === Infinity ? '∞' : v.toFixed(1)} — it moves together with another explanatory variable, so its individual coefficient cannot be trusted in isolation.`); });
  if (durbinWatson != null && (durbinWatson < 1 || durbinWatson > 3)) flags.push(`Durbin–Watson = ${durbinWatson.toFixed(2)} — residuals show likely autocorrelation (values near 2 indicate none); standard errors may be understated.`);
  if (adjR2 != null && adjR2 < 0.2) flags.push(`Low explanatory power (adjusted R²=${adjR2.toFixed(2)}): these explanatory variables account for little of the variation in the outcome — treat any single coefficient as weak evidence.`);
  if (fPValue != null && fPValue >= 0.05) flags.push(`The model as a whole is not statistically significant (F-test p=${fPValue.toFixed(3)} ≥ 0.05) — the explanatory variables jointly do not explain the outcome better than its mean.`);
  flags.push('Correlation is not causation: a significant coefficient means the two moved together in this data, not that one necessarily causes the other.');
  return { n, k, coefficients, r2, adjR2, fStat, fPValue, dfResid, residuals: resid, fitted, corrMatrix, names, durbinWatson, flags };
}

module.exports = { regress, corr };
