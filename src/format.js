export function formatCompactNumber(value) {
  const number = Number(value) || 0;
  const sign = number < 0 ? "-" : "";
  const absolute = Math.abs(number);

  if (absolute < 100000) return `${sign}${Math.round(absolute).toLocaleString()}`;
  if (absolute < 1000000) return `${sign}${trimCompact(absolute / 1000)}K`;
  if (absolute < 1000000000) return `${sign}${trimCompact(absolute / 1000000)}MILL`;
  if (absolute < 1000000000000) return `${sign}${trimCompact(absolute / 1000000000)}BILL`;
  return `${sign}${trimCompact(absolute / 1000000000000)}TRILL`;
}

function trimCompact(value) {
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return value.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}
