// Bufory wyjścia procesów z górnym limitem: gadatliwy pytest albo log nie rośnie w RAM bez końca.
// Zostaje OGON (wynik pytest i podsumowania są na końcu). Limit jest hojny, realne wyjścia go nie dotykają.
const MAX_CHARS = Number(process.env.QA_MAX_OUTPUT_CHARS) || 8000000;
function capAppend(buf, chunk, max = MAX_CHARS) {
  const s = buf + chunk;
  return s.length > max ? s.slice(s.length - max) : s;
}
module.exports = { capAppend, MAX_CHARS };
