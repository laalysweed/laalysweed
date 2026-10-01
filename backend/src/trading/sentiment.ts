import { computeSentiment, sentimentPct } from './trade.service';
import { marketHub } from '../market/market-hub';
import { toSymbol } from '../realtime/io';
import { createLogger } from '../lib/logger';

const log = createLogger('sentiment');
export const sentimentCache = new Map<string, { up: number; down: number }>();

/** Broadcasts crowd sentiment (share of open stake UP vs DOWN) to each symbol room every 3s. */
export function startSentimentWorker() {
  setInterval(async () => {
    try {
      const fresh = await computeSentiment();
      sentimentCache.clear();
      for (const [k, v] of fresh) sentimentCache.set(k, v);
      for (const a of marketHub.listAssets()) {
        toSymbol(a.symbol, 'sentiment', { symbol: a.symbol, ...sentimentPct(sentimentCache.get(a.symbol)) });
      }
    } catch (e) {
      log.error('failed', e);
    }
  }, 3000);
}
