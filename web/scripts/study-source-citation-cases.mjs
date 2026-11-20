// Synthetic URL boundary cases shared by exporter tests and the real browser validator.
export const exactStudyCitations = [
  'https://esmis.nal.usda.gov/sites/default/release-files/796099/wasde1026.pdf',
  'https://esmis.nal.usda.gov/sites/default/release-files/796142/wasde1126.pdf',
  'https://www.kibot.com/free-historical-intraday-data.html',
];
export const rejectedStudyCitations = exactStudyCitations.flatMap(value => {
  const url = new URL(value);
  return [
    value + '/extra', value.replace(/[^/]+$/, 'other.pdf'),
    value + '?', value + '?download=1', value + '#', value + '#page=18',
    value.replace('https:', 'http:'), value.replace(url.host, url.host + ':8443'),
    value.replace(url.host, url.host + ':443'), value.replace('https://', 'https://user:password@'),
    value.replace(url.host, url.host + '.evil.example'), value.replace(url.host, 'sub.' + url.host),
    value.replace(url.host, url.host + '.'), value.replace(url.host, url.host.toUpperCase()),
    value.replace(/\/([^/])([^/]*)$/, (_, first, rest) => '/%' + first.charCodeAt(0).toString(16) + rest),
    value.replace(/\/([^/]+)$/, '/placeholder/../$1'), value.replace('https://', 'https:\\\\'),
    ' ' + value, value + '\n', value.replace('https:', 'HTTPS:'),
  ];
});
// Preserve existing broad-host semantics, including their existing port/query behavior.
export const legacyCitationCases = [
  ['https://www.sec.gov/Archives/example.htm', true],
  ['https://www.sec.gov:8443/Archives/example.htm?x=1#page=2', true],
  ['HTTPS://WWW.SEC.GOV/example', true],
  ['http://www.sec.gov/example', false],
  ['https://user@www.sec.gov/example', false],
  ['https://www.sec.gov.evil.example/', false],
];
