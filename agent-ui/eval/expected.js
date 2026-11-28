// The seeded defects of the benchmark shop and the traps (correct behaviour that looks suspicious).
//
// A defect counts as found when ONE finding of an allowed layer matches one of its `match` alternatives:
// every regex of the alternative must match the same finding (title, details and evidence together).
// A trap counts as a false alarm when a finding matches it. `primary` is the layer that is expected to find the defect;
// the per-phase numbers use it, the overall recall accepts any layer listed in `layers`.
//
// Keep the regexes tolerant of wording, strict about the fact: name the field, the value or the rule that is broken.
//
// Each defect is also checked against the running shop by test/eval.test.js (`probe`), so the benchmark itself cannot rot.

const TICKETS = {
  'BENCH-1': { file: 'BENCH-1.md', stages: { static: true, whitebox: false, design: true, api: true, ui: true }, page: '/#/register' },
  'BENCH-2': { file: 'BENCH-2.md', stages: { static: true, whitebox: false, design: true, api: true, ui: true }, page: '/#/' },
  'BENCH-3': { file: 'BENCH-3.md', stages: { static: true, whitebox: true, design: true, api: true, ui: true }, page: '/#/login' },
};

const DEFECTS = [
  // ---- BENCH-1 registration and sign-in
  { id: 'R1', ticket: 'BENCH-1', primary: 'api', layers: ['api', 'ui'], what: 'The duplicate-email check is case-sensitive: Anna@x.com registers again after anna@x.com',
    match: [[/case|upper|lower|capital/i, /duplicate|already|409|twice|second|again|unique/i]] },
  { id: 'R2', ticket: 'BENCH-1', primary: 'api', layers: ['api', 'ui'], what: 'A password of exactly 8 characters (with a digit) is rejected; the rule is at least 8',
    match: [[/\b8\b|eight/i, /reject|400|refus|not accept|denied|boundary|exactly/i]] },
  { id: 'R3', ticket: 'BENCH-1', primary: 'api', layers: ['api'], what: 'The registration response contains passwordHash',
    match: [[/passwordHash|password hash|hash of the password|hashed password/i]] },
  { id: 'R4', ticket: 'BENCH-1', primary: 'api', layers: ['api', 'ui'], what: 'An unknown email returns 404 "User not found" instead of 401 "Invalid email or password" (user enumeration)',
    match: [[/404|user not found/i, /unknown|not registered|non-?existent|enumerat|does not exist|unregistered/i]] },
  { id: 'R5', ticket: 'BENCH-1', primary: 'api', layers: ['api', 'ui'], what: 'The account is never locked: after 5 failed attempts sign-in still returns 401/200, never 423',
    match: [[/lock|423/i, /never|not locked|no lock|still|without|does not|missing|200|401/i]] },
  { id: 'R6', ticket: 'BENCH-1', primary: 'ui', layers: ['ui'], what: 'The registration form says "at least 6 characters"; the rule is 8',
    match: [[/\b6\b|six/i, /character|password/i]] },
  { id: 'R7', ticket: 'BENCH-1', primary: 'ui', layers: ['ui'], what: 'After sign-in the header shows the email instead of the name',
    match: [[/header|nav|top bar|banner/i, /email|e-mail|address|demo@shop\.test/i, /name|Demo Customer/i]] },
  { id: 'S1', ticket: 'BENCH-1', primary: 'static', layers: ['static'], what: 'Lock duration contradicts itself: 15 minutes in the description, 30 minutes in the criteria',
    match: [[/15/, /30/, /lock|minute/i]] },
  { id: 'S2', ticket: 'BENCH-1', primary: 'static', layers: ['static'], what: '"Sign-in must be secure" is not testable: no measurable criterion',
    match: [[/secure/i, /vague|not testable|untestable|measurable|undefined|ambiguous|no criteri|not defined|unclear|subjective/i]] },
  { id: 'S3', ticket: 'BENCH-1', primary: 'static', layers: ['static'], what: 'No limits for the name (length, characters, whitespace)',
    match: [[/name/i, /length|maximum|max|limit|characters|whitespace|long/i]] },

  // ---- BENCH-2 search and pagination
  { id: 'P1', ticket: 'BENCH-2', primary: 'api', layers: ['api', 'ui'], what: 'Search is case-sensitive: "MUG" finds nothing',
    match: [[/case|upper|lower|MUG\b/i, /search|q=|match|find|result/i]] },
  { id: 'P2', ticket: 'BENCH-2', primary: 'api', layers: ['api'], what: 'pageSize above 50 (51..100) is accepted instead of 400',
    match: [[/pageSize|page size/i, /\b5[1-9]\b|\b[6-9]\d\b|\b100\b|above 50|over 50|more than 50|larger than 50|greater than 50|exceed/i]] },
  { id: 'P3', ticket: 'BENCH-2', primary: 'api', layers: ['api', 'ui'], what: 'total is the size of the whole catalogue (23), not the number of matches',
    match: [[/total|Page \d+ of|page count|number of pages/i, /23|whole catalogue|all products|entire|not the number of match|regardless|instead of|catalog/i]] },
  { id: 'P4', ticket: 'BENCH-2', primary: 'api', layers: ['api', 'ui'], what: 'Sorting is case-sensitive: "eco bag" comes after "Zebra notebook"',
    match: [[/sort|order/i, /eco bag|lower-?case|case|Zebra|last/i]] },
  { id: 'P5', ticket: 'BENCH-2', primary: 'ui', layers: ['ui'], what: 'No "No products found" message when nothing matches',
    match: [[/no products found|empty|nothing matches|no results|no match/i, /message|shown|not show|missing|blank|text|absent|display/i]] },
  { id: 'P6', ticket: 'BENCH-2', primary: 'ui', layers: ['ui'], what: 'Prices are not shown with two decimals ("12.5 PLN")',
    match: [[/12\.5 PLN|9\.99|24\.9 PLN|two decimals|2 decimals|decimal|59 PLN/i, /price|PLN|format/i]] },
  { id: 'P7', ticket: 'BENCH-2', primary: 'ui', layers: ['ui'], what: '"Next" is enabled on the last page and opens an empty page',
    match: [[/next/i, /last page|enabled|not disabled|empty page|page 4|beyond/i]] },
  { id: 'S4', ticket: 'BENCH-2', primary: 'static', layers: ['static'], what: 'Sort order contradicts itself: popularity in the description, name A to Z in the criteria',
    match: [[/popularity|popular/i, /name|A to Z|A-Z|alphabet|contradict|conflict/i]] },
  { id: 'S5', ticket: 'BENCH-2', primary: 'static', layers: ['static'], what: '"Search should feel instant" has no measurable response time',
    match: [[/instant/i, /vague|not testable|untestable|measurable|threshold|response time|ms\b|second|undefined|ambiguous|subjective|unclear/i]] },

  // ---- BENCH-3 discount codes (change on a branch: whitebox finds the code-level ones)
  { id: 'W1', ticket: 'BENCH-3', primary: 'whitebox', layers: ['whitebox', 'api', 'ui'], what: 'The percentage discount is computed on subtotal + shipping, not on the items only',
    match: [[/shipping/i, /discount|percent|%|SAVE10|WINTER15/i, /includ|added|plus|\+|on top|base|computed|calculated|subtotal \+|together|also/i]] },
  { id: 'W2', ticket: 'BENCH-3', primary: 'whitebox', layers: ['whitebox'], what: 'The validity check excludes the last day (now < validUntil at midnight)',
    match: [[/validUntil|valid until|last day|2026-12-31|expir/i, /midnight|last day|inclusive|exclud|<=|00:00|end of the day|whole day|off-by-one/i]] },
  { id: 'W3', ticket: 'BENCH-3', primary: 'api', layers: ['whitebox', 'api', 'ui'], what: 'Codes stack: a second code (or the same one twice) adds another discount instead of replacing',
    match: [[/second|twice|again|another|multiple|two codes|both|stack|add up|accumulat|replace|repeated/i, /code|discount/i, /stack|add up|accumulat|both|twice|sum|not replac|added|push|replac|doubl|array/i]] },
  { id: 'W4', ticket: 'BENCH-3', primary: 'api', layers: ['whitebox', 'api', 'ui'], what: 'Codes are case-sensitive: "save10" returns 404 Unknown code',
    match: [[/save10|lower-?case|case/i, /code|404|unknown/i]] },
  { id: 'W5', ticket: 'BENCH-3', primary: 'whitebox', layers: ['whitebox', 'api', 'ui'], what: 'Unrelated change: free shipping moved from 200 to 300',
    match: [[/FREE_SHIPPING_FROM|free shipping|shipping/i, /300/]] },
  { id: 'W6', ticket: 'BENCH-3', primary: 'api', layers: ['whitebox', 'api', 'ui'], what: 'The order ignores the discount: its total is subtotal + shipping and the code is not kept',
    match: [[/order/i, /discount|code/i, /total|ignor|not kept|not stored|missing|without|lost|differ|not appl|not includ|dropped/i]] },
  { id: 'W7', ticket: 'BENCH-3', primary: 'whitebox', layers: ['whitebox', 'api', 'ui'], what: 'The discount is rounded down to whole PLN (Math.floor) instead of half up to 2 decimals',
    match: [[/floor|round|whole|integer|decimal|cents|grosz|truncat/i, /discount|amount|percent/i]] },
  { id: 'U1', ticket: 'BENCH-3', primary: 'ui', layers: ['ui'], what: 'The cart page says "Code applied" for an invalid code and never shows the server error',
    match: [[/code applied/i, /invalid|unknown|expired|wrong|error|fake|not exist|bogus|non-?existent|OLD5/i]] },
  { id: 'S6', ticket: 'BENCH-3', primary: 'static', layers: ['static'], what: 'Not said what happens to an applied code when the cart later drops below the minimum',
    match: [[/minimum|below|drops|remov|reduc|falls/i, /after|later|already applied|applied code|once applied|when items|changes|removed/i]] },
  { id: 'S7', ticket: 'BENCH-3', primary: 'static', layers: ['static'], what: 'The dev comment (codes typed exactly) contradicts "codes are case-insensitive"',
    match: [[/exactly|as printed|comment/i, /case/i]] },
];

const TRAPS = [
  { id: 'T1', ticket: 'BENCH-1', what: 'The email is saved in lower case, as the ticket says',
    match: [[/lower-?case|lowercased|normali[sz]ed/i, /email/i, /saved|stored|returned|altered|changed|modif|convert/i]], unless: /duplicate|409|twice|already|again|second/i },
  { id: 'T2', ticket: 'BENCH-1', what: 'expiresIn 3600 is the agreed 1-hour token',
    match: [[/expiresIn|3600/i, /should|expected|wrong|short|long|incorrect/i]] },
  { id: 'T3', ticket: 'BENCH-2', what: 'A one-character query lists all products, as the ticket says',
    match: [[/one|single|1 char|short/i, /all products|ignored|not filter|every product|whole catalogue|returns all/i]] },
  { id: 'T4', ticket: 'BENCH-3', what: 'An expired code returns 422, as the ticket says (not 400)',
    match: [[/expired|OLD5/i, /422/, /should be 400|expected 400|instead of 400|not 400|wrong status/i]] },
  { id: 'T5', ticket: 'BENCH-3', what: 'FIXED20 on an item subtotal of exactly 150.00 is accepted (the minimum is inclusive)',
    match: [[/FIXED20/i, /150/, /accept|applied|allowed/i, /should|wrong|not be|incorrect/i]] },
];

module.exports = { TICKETS, DEFECTS, TRAPS };
