/** Default tradable instruments, inserted by the seeder / on first boot. Admins can edit payouts etc. later. */
export interface AssetSeed {
  symbol: string;
  name: string;
  category: 'crypto' | 'currency' | 'commodity' | 'stock' | 'index';
  source: 'binance' | 'otc';
  binanceSymbol?: string;
  icon: string;
  precision: number;
  payout: number;
  sort: number;
  otc?: { basePrice: number; volatility: number; meanReversion: number };
  cfd?: { enabled: boolean; spread: number; leverage: number; contractSize: number };
}

// volatility = relative sigma per sqrt(second); meanReversion = pull toward basePrice per second
const otc = (basePrice: number, volatility: number, meanReversion = 0.0004) => ({ basePrice, volatility, meanReversion });

export const ASSET_CATALOG: AssetSeed[] = [
  // ---- OTC (generated, 24/7) ----
  { symbol: 'BTCUSD_OTC', name: 'BTC/USD OTC', category: 'crypto', source: 'otc', icon: '₿', precision: 2, payout: 79, sort: 1, otc: otc(72800, 0.00042) },
  { symbol: 'ETHUSD_OTC', name: 'ETH/USD OTC', category: 'crypto', source: 'otc', icon: 'Ξ', precision: 2, payout: 80, sort: 2, otc: otc(3450, 0.0005) },
  { symbol: 'EURUSD_OTC', name: 'EUR/USD OTC', category: 'currency', source: 'otc', icon: '€', precision: 5, payout: 88, sort: 3, otc: otc(1.0842, 0.00007) },
  { symbol: 'GBPUSD_OTC', name: 'GBP/USD OTC', category: 'currency', source: 'otc', icon: '£', precision: 5, payout: 87, sort: 4, otc: otc(1.2715, 0.00008) },
  { symbol: 'USDJPY_OTC', name: 'USD/JPY OTC', category: 'currency', source: 'otc', icon: '¥', precision: 3, payout: 86, sort: 5, otc: otc(151.42, 0.00007) },
  { symbol: 'AUDCAD_OTC', name: 'AUD/CAD OTC', category: 'currency', source: 'otc', icon: 'A$', precision: 5, payout: 85, sort: 6, otc: otc(0.8961, 0.00007) },
  { symbol: 'EURJPY_OTC', name: 'EUR/JPY OTC', category: 'currency', source: 'otc', icon: '€', precision: 3, payout: 84, sort: 7, otc: otc(164.18, 0.00008) },
  { symbol: 'USDKES_OTC', name: 'USD/KES OTC', category: 'currency', source: 'otc', icon: 'KSh', precision: 3, payout: 82, sort: 8, otc: otc(129.2, 0.00006) },
  { symbol: 'XAUUSD_OTC', name: 'Gold OTC', category: 'commodity', source: 'otc', icon: 'Au', precision: 2, payout: 83, sort: 9, otc: otc(2385, 0.00012) },
  { symbol: 'XAGUSD_OTC', name: 'Silver OTC', category: 'commodity', source: 'otc', icon: 'Ag', precision: 3, payout: 81, sort: 10, otc: otc(28.4, 0.0002) },
  { symbol: 'BRENT_OTC', name: 'Brent Oil OTC', category: 'commodity', source: 'otc', icon: '🛢', precision: 2, payout: 80, sort: 11, otc: otc(82.6, 0.0002) },
  { symbol: 'AAPL_OTC', name: 'Apple OTC', category: 'stock', source: 'otc', icon: '', precision: 2, payout: 78, sort: 12, otc: otc(214.3, 0.00018) },
  { symbol: 'TSLA_OTC', name: 'Tesla OTC', category: 'stock', source: 'otc', icon: 'T', precision: 2, payout: 77, sort: 13, otc: otc(248.5, 0.0003) },
  { symbol: 'AMZN_OTC', name: 'Amazon OTC', category: 'stock', source: 'otc', icon: 'a', precision: 2, payout: 78, sort: 14, otc: otc(186.9, 0.0002) },
  { symbol: 'US100_OTC', name: 'US Tech 100 OTC', category: 'index', source: 'otc', icon: 'US', precision: 2, payout: 82, sort: 15, otc: otc(19840, 0.00012) },
  { symbol: 'UK100_OTC', name: 'UK 100 OTC', category: 'index', source: 'otc', icon: 'UK', precision: 2, payout: 82, sort: 16, otc: otc(8240, 0.0001) },
  { symbol: 'DE40_OTC', name: 'Germany 40 OTC', category: 'index', source: 'otc', icon: 'DE', precision: 2, payout: 82, sort: 17, otc: otc(18650, 0.0001) },
  { symbol: 'JP225_OTC', name: 'Japan 225 OTC', category: 'index', source: 'otc', icon: 'JP', precision: 2, payout: 82, sort: 18, otc: otc(39120, 0.00012) },

  // ---- Real market (Binance spot, live) ----
  { symbol: 'BTCUSDT', name: 'Bitcoin / TetherUS', category: 'crypto', source: 'binance', binanceSymbol: 'BTCUSDT', icon: '₿', precision: 2, payout: 82, sort: 30, cfd: { enabled: true, spread: 8, leverage: 100, contractSize: 1 } },
  { symbol: 'ETHUSDT', name: 'Ethereum / TetherUS', category: 'crypto', source: 'binance', binanceSymbol: 'ETHUSDT', icon: 'Ξ', precision: 2, payout: 82, sort: 31, cfd: { enabled: true, spread: 0.6, leverage: 100, contractSize: 1 } },
  { symbol: 'SOLUSDT', name: 'Solana / TetherUS', category: 'crypto', source: 'binance', binanceSymbol: 'SOLUSDT', icon: '◎', precision: 3, payout: 80, sort: 32, cfd: { enabled: true, spread: 0.05, leverage: 50, contractSize: 10 } },
  { symbol: 'BNBUSDT', name: 'BNB / TetherUS', category: 'crypto', source: 'binance', binanceSymbol: 'BNBUSDT', icon: 'B', precision: 2, payout: 80, sort: 33, cfd: { enabled: true, spread: 0.2, leverage: 50, contractSize: 1 } },
  { symbol: 'XRPUSDT', name: 'XRP / TetherUS', category: 'crypto', source: 'binance', binanceSymbol: 'XRPUSDT', icon: 'X', precision: 4, payout: 79, sort: 34, cfd: { enabled: true, spread: 0.0008, leverage: 50, contractSize: 1000 } },
  { symbol: 'DOGEUSDT', name: 'Dogecoin / TetherUS', category: 'crypto', source: 'binance', binanceSymbol: 'DOGEUSDT', icon: 'Ð', precision: 5, payout: 78, sort: 35, cfd: { enabled: true, spread: 0.00008, leverage: 50, contractSize: 10000 } },
  { symbol: 'ADAUSDT', name: 'Cardano / TetherUS', category: 'crypto', source: 'binance', binanceSymbol: 'ADAUSDT', icon: '₳', precision: 4, payout: 78, sort: 36, cfd: { enabled: true, spread: 0.0006, leverage: 50, contractSize: 1000 } },
  { symbol: 'LTCUSDT', name: 'Litecoin / TetherUS', category: 'crypto', source: 'binance', binanceSymbol: 'LTCUSDT', icon: 'Ł', precision: 2, payout: 78, sort: 37, cfd: { enabled: true, spread: 0.08, leverage: 50, contractSize: 10 } },
];
