#!/usr/bin/env node

export const SECTOR_BETAS = {
  TECH: 1.2,
  FINANCIALS: 1.0,
  HEALTHCARE: 0.9,
  ENERGY: 1.0,
  ENERGY_TRANSITION: 1.25,
  MATERIALS: 1.15,
  INDUSTRIALS: 1.0,
  COMMUNICATIONS: 1.15,
  CONSUMER: 1.05,
  CONSUMER_STAPLES: 0.8,
  ETF: 1.0,
  UNKNOWN: 1.05,
};

export function displaySectorLabel(sector, subIndustry) {
  const s = String(sector || '').toUpperCase();
  const sub = String(subIndustry || '').toUpperCase();
  if (s !== 'ETF') return s || 'UNKNOWN';

  if (sub.includes('COUNTRY_ETF') || sub === 'EMERGING_MARKETS_ETF') return 'COUNTRY_ETF';
  if (sub.includes('LEVERAGED')) return 'LEVERAGED_ETF';
  if (sub.includes('THEMATIC') || sub.includes('BATTERY') || sub.includes('CROSSOVER') || sub.includes('INNOVATION')) return 'THEMATIC_ETF';
  if (sub.includes('METALS_MINING') || sub.includes('SECTOR_ETF') || sub.includes('METALS_AND_ALLOYS')) return 'SECTOR_ETF';
  return 'ETF';
}

export function normalizeSubIndustry(symbol, name, sectorMap = {}) {
  const ticker = String(symbol || '').toUpperCase();
  const sector = normalizeSector(symbol, name, sectorMap);
  const label = `${name || ''} ${ticker}`.toUpperCase();

  if (ticker === 'IBKR' || label.includes('INTERACTIVE BROKERS') || label.includes('BROKER')) return 'BROKERAGE';
  if (ticker === 'PLTR') return 'DEFENSE_SOFTWARE';
  if (ticker === 'ANET') return 'NETWORKING';
  if (ticker === 'APP' || label.includes('APPLOVIN')) return 'ADTECH';
  if (ticker === 'NVDA' || ticker === 'AVGO' || ticker === 'TSM' || ticker === 'INTC' || label.includes('SEMICONDUCTOR')) return 'SEMICONDUCTORS';
  if (ticker === 'TTD') return 'ADTECH';
  if (ticker === 'TTWO' || ticker === 'OTGLY' || label.includes('ENTERTAINMENT')) return 'INTERACTIVE_MEDIA';
  if (ticker === 'FSLR') return 'SOLAR';
  if (ticker === 'XOM' || ticker === 'CLMT' || ticker === 'BTU') return 'FOSSIL_FUELS';
  if (ticker === 'XME') return 'METALS_MINING_ETF';
  if (ticker === 'NEM' || ticker === 'B' || ticker === 'GAU' || ticker === 'BHP' || label.includes('GOLD')) return 'MINING';
  if (ticker === 'ATI' || ticker === 'WS' || ticker === 'MTX' || label.includes('STEEL') || label.includes('METALS')) return 'METALS_AND_ALLOYS';
  if (ticker === 'RTX' || label.includes('AEROSPACE')) return 'AEROSPACE_DEFENSE';
  if (ticker === 'FIX' || label.includes('COMFORT')) return 'ENGINEERING_CONSTRUCTION';
  if (ticker === 'UBER') return 'MOBILITY_PLATFORMS';
  if (ticker === 'DAL') return 'AIRLINES';
  if (ticker === 'CVS') return 'PHARMACY_RETAIL';
  if (ticker === 'LLY' || ticker === 'MRK' || ticker === 'ABBV') return 'PHARMA';
  if (ticker === 'CRSP' || ticker === 'SEELQ') return 'BIOTECH';
  if (ticker === 'MO' || ticker === 'KO') return 'STAPLES_BRANDS';
  if (ticker === 'CHEF' || ticker === 'EBAY') return 'SPECIALTY_RETAIL';
  if (ticker === 'ARGT') return 'COUNTRY_ETF_ARGENTINA';
  if (ticker === 'ARKK') return 'DISRUPTIVE_INNOVATION_ETF';
  if (ticker === 'EEM') return 'EMERGING_MARKETS_ETF';
  if (ticker === 'INDA') return 'COUNTRY_ETF_INDIA';
  if (ticker === 'LIT') return 'BATTERY_CHAIN_ETF';
  if (ticker === 'XOVR') return 'CROSSOVER_EQUITY_ETF';
  if (ticker === 'TQQQ') return 'LEVERAGED_NASDAQ_ETF';

  if (sector === 'TECH') return 'SOFTWARE_INFRASTRUCTURE';
  if (sector === 'FINANCIALS') return 'FINANCIAL_SERVICES';
  if (sector === 'HEALTHCARE') return 'HEALTHCARE_SERVICES';
  if (sector === 'ENERGY') return 'ENERGY_PRODUCERS';
  if (sector === 'ENERGY_TRANSITION') return 'ENERGY_TRANSITION';
  if (sector === 'MATERIALS') return 'MATERIALS';
  if (sector === 'INDUSTRIALS') return 'INDUSTRIALS';
  if (sector === 'COMMUNICATIONS') return 'DIGITAL_MEDIA';
  if (sector === 'CONSUMER') return 'CONSUMER_DISCRETIONARY';
  if (sector === 'CONSUMER_STAPLES') return 'CONSUMER_STAPLES';
  if (sector === 'ETF') return 'ETF';
  return 'UNKNOWN';
}

export function normalizeSector(symbol, name, sectorMap = {}) {
  const ticker = String(symbol || '').toUpperCase();
  if (sectorMap[ticker]) return String(sectorMap[ticker]);

  const label = `${name || ''} ${ticker}`.toUpperCase();
  if (label.includes('ETF')) return 'ETF';
  if (label.includes('SOFTWARE') || label.includes('SEMICONDUCTOR') || label.includes('COMPUT') || label.includes('NETWORK') || label.includes('HEWLETT') || label.includes('INTEL')) return 'TECH';
  if (label.includes('BANK') || label.includes('BROKER') || label.includes('FINANCIAL') || label.includes('INTERACTIVE BROKERS')) return 'FINANCIALS';
  if (label.includes('PHARMA') || label.includes('THERAPEUTICS') || label.includes('CRISPR') || label.includes('BIO') || label.includes('HEALTH') || label.includes('MERCK') || label.includes('LILLY') || label.includes('ABBVIE') || label.includes('CVS')) return 'HEALTHCARE';
  if (label.includes('OIL') || label.includes('GAS') || label.includes('ENERGY') || label.includes('EXXON') || label.includes('CALUMET') || label.includes('PEABODY')) return 'ENERGY';
  if (label.includes('MINING') || label.includes('STEEL') || label.includes('METALS')) return 'MATERIALS';
  if (label.includes('SOLAR') || label.includes('LITHIUM') || label.includes('BATTERY')) return 'ENERGY_TRANSITION';
  if (label.includes('AIR') || label.includes('DELTA') || label.includes('AEROSPACE') || label.includes('RTX') || label.includes('UBER') || label.includes('WORTHINGTON') || label.includes('COMFORT')) return 'INDUSTRIALS';
  if (label.includes('ADVERTIS') || label.includes('MEDIA') || label.includes('ENTERTAINMENT') || label.includes('TAKE-TWO') || label.includes('CD PROJEKT') || label.includes('TRADE DESK')) return 'COMMUNICATIONS';
  if (label.includes('RETAIL') || label.includes('EBAY') || label.includes('CHEF') || label.includes('APPLOVIN')) return 'CONSUMER';
  if (label.includes('COCA-COLA') || label.includes('ALTRIA')) return 'CONSUMER_STAPLES';
  if (label.includes('GOLD')) return 'MATERIALS';
  return 'UNKNOWN';
}

export function betaProxyForSector(sector) {
  return SECTOR_BETAS[sector] ?? SECTOR_BETAS.UNKNOWN;
}
