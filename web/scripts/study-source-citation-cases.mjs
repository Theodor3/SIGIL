// Synthetic URL boundary cases shared by exporter tests and the real browser validator.
export const exactStudyCitations = [
  'https://esmis.nal.usda.gov/sites/default/release-files/796099/wasde1026.pdf',
  'https://esmis.nal.usda.gov/sites/default/release-files/796142/wasde1126.pdf',
  'https://www.kibot.com/free-historical-intraday-data.html',
  'https://agtransport.usda.gov/resource/deqi-uken.json',
  'https://www.ams.usda.gov/services/transportation-analysis/gtr/archive-2025',
  'https://content.govdelivery.com/accounts/USDHSCG/bulletins/3f132bb',
  'https://content.govdelivery.com/accounts/USDHSCG/bulletins/3f57772',
  'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message?guid=66239383',
  'https://www.iso-ne.com/markets-operations/system-forecast-status/seven-day-capacity-forecast-list',
  'https://www.iso-ne.com/static-assets/documents/100029/we_2025_11_09_weekly_final.pdf',
  'https://www.nrc.gov/documents-reports/document-collections/events-reports-associated-with/power-reactor-status-reports/2025/20251103ps',
  'https://www.nrc.gov/documents-reports/document-collections/events-reports-associated-with/power-reactor-status-reports/2025/20251104ps',
];
export const rejectedStudyCitations = [...exactStudyCitations.flatMap(value => {
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
}),
  // This one reviewed query is literal permission, not permission for other queries.
  'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message',
  'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message?guid=66239384',
  'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message?guid=',
  'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message?GUID=66239383',
  'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message?guid=%366239383',
  'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message?guid=66239383&extra=1',
  'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message?extra=1&guid=66239383',
  'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message?guid=66239383&guid=66239383',
  'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message?guid=66239383;extra=1',
  'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message?guid=066239383',
];
// Preserve existing broad-host semantics, including their existing port/query behavior.
export const legacyCitationCases = [
  ['https://www.sec.gov/Archives/example.htm', true],
  ['https://www.sec.gov:8443/Archives/example.htm?x=1#page=2', true],
  ['HTTPS://WWW.SEC.GOV/example', true],
  ['http://www.sec.gov/example', false],
  ['https://user@www.sec.gov/example', false],
  ['https://www.sec.gov.evil.example/', false],
];
