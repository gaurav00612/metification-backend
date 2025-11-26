// convert MetalPriceAPI timeframe response into usable format
const TEN_GRAM_FACTOR = 10 / 31.1034768;

export function parseGoldTimeframe(apiData) {
  const rates = apiData.rates;

  return Object.entries(rates).map(([date, obj]) => {
    const ouncePriceInInr = Number(obj.INRXAU);
    const tenGramInr = Math.round(ouncePriceInInr * TEN_GRAM_FACTOR);

    return {
      date,
      ounceINR: ouncePriceInInr,
      tenGramINR: tenGramInr
    };
  });
}
