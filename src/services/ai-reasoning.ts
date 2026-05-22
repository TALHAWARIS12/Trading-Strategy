import axios from 'axios';
import { config } from '@/config';
import { Trade } from '@/types';
import logger from '@/logging';

export class AIReasoningService {
  /**
   * Generate AI explanation/reasoning for a specific trade based on its execution parameters
   */
  static async generateTradeReasoning(trade: Trade, candleContext?: string): Promise<string> {
    if (!config.openaiApiKey) {
      logger.warn('[AIReasoningService] OpenAI API key not configured.');
      return 'AI Reasoning not available: OpenAI API key is missing. Please configure OPENAI_API_KEY in your .env file.';
    }

    try {
      const prompt = `
You are a highly professional crypto technical analysis AI. 
Provide a concise, expert analysis and reasoning for the following executed paper trade:

Trade Details:
- Pair: ${trade.pair}
- Side: ${trade.side}
- Entry Price: ${trade.entryPrice}
- Quantity: ${trade.entryQty}
- Entry Time: ${new Date(trade.entryTime).toISOString()}
- Stop Loss: ${trade.stopLoss}
- Take Profit 1 (1:1): ${trade.takeProfit1}
- Take Profit 2 (2:1): ${trade.takeProfit2}
- Current Status: ${trade.status}
${trade.exitPrice ? `- Exit Price: ${trade.exitPrice}` : ''}
${trade.exitReason ? `- Exit Reason: ${trade.exitReason}` : ''}
${trade.pnl ? `- PnL: $${trade.pnl} (${trade.pnlPercent}%)` : ''}

Market Context / Rules:
${
  trade.pair === 'BTCUSDT'
    ? '- BTC Micro Range Sweep Strategy: Trades exact boundaries of the first 3m candle of a 15m block.'
    : '- ETH Breakout Strategy: 15m EMA Trend filter (EMA50 > EMA200), 15m ATR high volatility filter, 1m initial range breakout.'
}
${candleContext ? `Additional context:\n${candleContext}` : ''}

Provide your expert response in 3 brief, beautifully formatted sections:
1. **Trade Setup & Justification**: Why this trade was triggered based on the strategy rules.
2. **Risk/Reward Dynamics**: Comments on the SL/TP spacing, leverage (if any), and quantity relative to the $10,000 portfolio.
3. **Outcome / Key Takeaways**: A professional review of the outcome (or current status) and what this trade teaches us about current market behavior.

Keep the total response under 200 words, utilizing clean Markdown. Do not include boilerplate headers or unnecessary intro.
`;

      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: config.openaiModel,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.7,
          max_completion_tokens: 400,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.openaiApiKey}`,
          },
          timeout: 10000, // 10 seconds timeout
        }
      );

      if (response.data?.choices?.[0]?.message?.content) {
        return response.data.choices[0].message.content.trim();
      }

      throw new Error('Invalid response structure from OpenAI API');
    } catch (error: any) {
      logger.error(`[AIReasoningService] Failed to generate trade reasoning: ${error.message}`);
      return `Failed to generate AI reasoning: ${error.response?.data?.error?.message || error.message}`;
    }
  }
}
