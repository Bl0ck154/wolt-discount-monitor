export const OFFER_VALUE_VERSION = 4;

export const DEFAULT_VALUE_RULES = {
  minValueScore: 45,
  minMultibuyScore: 52,
  minGroceryPercent: 10,
  minRestaurantPercent: 15,
  minOtherPercent: 20,
  minCashValueRatio: 0.2,
  minUnconditionalCashReference: 0.6,
};

const CURRENCY_PROFILES = {
  EUR: { reference: 5, aliases: ["€", "eur", "euro", "euros"] },
  PLN: { reference: 15, aliases: ["pln", "zł", "zl"] },
  CZK: { reference: 100, aliases: ["czk", "kč", "kc"] },
  HUF: { reference: 1500, aliases: ["huf", "ft"] },
  GEL: { reference: 12, aliases: ["gel", "₾"] },
  AZN: { reference: 6, aliases: ["azn", "₼"] },
  DKK: { reference: 50, aliases: ["dkk", "kr", "kr."] },
  SEK: { reference: 50, aliases: ["sek", "kr", "kr."] },
  NOK: { reference: 50, aliases: ["nok", "kr", "kr."] },
  ILS: { reference: 20, aliases: ["ils", "₪"] },
  ISK: { reference: 700, aliases: ["isk", "kr", "kr."] },
  KZT: { reference: 2000, aliases: ["kzt", "₸"] },
  RON: { reference: 20, aliases: ["ron", "lei"] },
  RSD: { reference: 500, aliases: ["rsd", "din"] },
  BGN: { reference: 10, aliases: ["bgn", "лв"] },
  ALL: { reference: 500, aliases: ["all", "lek"] },
  MKD: { reference: 300, aliases: ["mkd", "ден", "den"] },
};

const QUANTITY_WORDS = new Map([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
]);
const QUANTITY_TOKEN = "(?:\\d+|one|two|three|four|five)";

const ALIAS_TO_CODES = buildAliasIndex();
const MONEY_TOKEN_PATTERN = [...ALIAS_TO_CODES.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join("|");
const NUMBER_PATTERN = "(-?\\d{1,3}(?:[ .,:]\\d{3})+|-?\\d+(?:[.,]\\d+)?)";

export function analyzeOffer(offer, rules = DEFAULT_VALUE_RULES) {
  const analysis = analyzeOfferWithoutEligibility(offer);
  const extracted = analysis.discount;

  return {
    ...analysis,
    notificationEligible: isNotificationWorthy({
      ...offer,
      amount: extracted?.amount ?? null,
      amountType: extracted?.type ?? null,
      amountLabel: extracted?.label ?? null,
      currencyCode: analysis.value.currencyCode,
      value: analysis.value,
    }, rules),
  };
}

export function extractDiscount(text = "", { currencyCode = null } = {}) {
  const normalized = normalizeOfferText(text);
  const percent = normalized.match(/(-?\d+(?:[.,]\d+)?)\s*%/u);
  if (percent) {
    const amount = Math.abs(Number(percent[1].replace(",", ".")));
    return Number.isFinite(amount)
      ? { amount, type: "percent", currencyCode: null, label: `${formatNumber(amount)}%` }
      : null;
  }

  const money = extractMoneyDiscount(normalized, currencyCode);
  return money
    ? {
        amount: money.amount,
        type: "money",
        currencyCode: money.currencyCode,
        label: formatDiscountLabel(money.amount, "money", money.currencyCode),
      }
    : null;
}

export function extractMultibuy(text = "") {
  const normalized = normalizeOfferText(text).toLowerCase();
  if (!normalized) return null;

  const buyPay = normalized.match(new RegExp(
    `(?:buy|pirk|kup|koupit|купи)\\s+(${QUANTITY_TOKEN}).{0,32}?` +
      `(?:pay(?:\\s+for)?|mok[ėe]k(?:\\s+už)?|zap(?:ł|l)a[ćť](?:\\s+za)?|заплати(?:\\s+за)?)\\s+(${QUANTITY_TOKEN})\\b`,
    "iu",
  ));
  if (buyPay) {
    return buildMultibuy(parseQuantity(buyPay[1]), parseQuantity(buyPay[2]), "buy-pay");
  }

  const buyGetFree = normalized.match(new RegExp(
    `(?:buy|pirk|kup|koupit|купи)\\s+(${QUANTITY_TOKEN}).{0,24}?` +
      `(?:get|gauk|z[íi]skej|otrzymaj|отримай|получи)\\s+(${QUANTITY_TOKEN})\\s+` +
      `(?:free|nemokam\\w*|gratis|zdarma|bezp[łl]atn\\w*|безкоштовн\\w*|бесплатн\\w*)\\b`,
    "iu",
  ));
  if (buyGetFree) {
    const paid = parseQuantity(buyGetFree[1]);
    const free = parseQuantity(buyGetFree[2]);
    return buildMultibuy(paid + free, paid, "buy-get-free");
  }

  const plusFree = normalized.match(new RegExp(
    `\\b(${QUANTITY_TOKEN})\\s*\\+\\s*(${QUANTITY_TOKEN})` +
      `(?:\\s*(?:free|nemokam\\w*|gratis|zdarma|dovan\\w*|безкоштовн\\w*|бесплатн\\w*))?\\b`,
    "iu",
  ));
  if (plusFree) {
    const paid = parseQuantity(plusFree[1]);
    const free = parseQuantity(plusFree[2]);
    return buildMultibuy(paid + free, paid, "plus-free");
  }

  const compact = normalized.match(/\b(\d+)\s*[x×]\s*(\d+)\b/u);
  if (compact) {
    return buildMultibuy(Number(compact[1]), Number(compact[2]), "compact");
  }

  const forPriceOf = normalized.match(new RegExp(
    `\\b(${QUANTITY_TOKEN})\\s*(?:for|už|uz|za|за|pour|al\\s+precio\\s+de)\\s*(${QUANTITY_TOKEN})\\b`,
    "iu",
  ));
  if (forPriceOf) {
    return buildMultibuy(parseQuantity(forPriceOf[1]), parseQuantity(forPriceOf[2]), "for-price-of");
  }

  return null;
}

export function extractMinimumSpend(text = "", currencyCode = null) {
  const match = normalizeOfferText(text).match(/(?:spend|minimum(?:\s+(?:order|spend|basket))?|min\.?\s*(?:order|spend|basket)?|orders?\s+over|basket\s+over|(?:off|discount)\s+over|from)\s+(.{0,40})/iu);
  return match ? extractMoney(match[1], currencyCode)?.amount ?? null : null;
}

export function extractMaximumSavings(text = "", currencyCode = null) {
  const match = normalizeOfferText(text).match(/(?:up\s+to|max(?:imum)?)\s+(.{0,30})/iu);
  return match ? extractMoney(match[1], currencyCode)?.amount ?? null : null;
}

export function isNotificationWorthy(offer, rules = DEFAULT_VALUE_RULES) {
  const analysis = offer?.value?.version === OFFER_VALUE_VERSION
    ? { discount: normalizeExistingDiscount(offer), value: offer.value }
    : analyzeOfferWithoutEligibility(offer);
  const { discount, value } = analysis;

  if (value.isUpToPercent) {
    return false;
  }

  if (value.scope === "multibuy") {
    const confidence = value.multibuy?.isClearlyBroad || value.multibuy?.isSubstantialItem;
    const minMultibuyScore = Number.isFinite(Number(rules.minMultibuyScore))
      ? Number(rules.minMultibuyScore)
      : DEFAULT_VALUE_RULES.minMultibuyScore;
    return Boolean(
      discount &&
      confidence &&
      !value.multibuy?.isLowCostItem &&
      value.score >= minMultibuyScore
    );
  }

  if (!discount || value.scope !== "broad" || value.score < rules.minValueScore) {
    return false;
  }

  const productLine = String(offer?.productLine ?? offer?.venue?.productLine ?? "").toLowerCase();
  if (discount.type === "percent") {
    const threshold = productLine === "grocery"
      ? rules.minGroceryPercent
      : productLine === "restaurant"
        ? rules.minRestaurantPercent
        : rules.minOtherPercent;
    return discount.amount >= threshold;
  }

  if (discount.type === "money") {
    if (value.minimumSpend) {
      return discount.amount / value.minimumSpend >= rules.minCashValueRatio;
    }
    return Number(value.normalizedCashReference) >= rules.minUnconditionalCashReference;
  }

  return false;
}

export function sortOffersByValue(offers = []) {
  return [...offers].sort((a, b) =>
    offerScore(b) - offerScore(a) ||
    String(a.venue?.name ?? "").localeCompare(String(b.venue?.name ?? ""), "en") ||
    String(a.text ?? "").localeCompare(String(b.text ?? ""), "en"));
}

export function offerScore(offer) {
  const stored = Number(offer?.value?.score ?? offer?.valueScore ?? offer?.score);
  return Number.isFinite(stored) ? stored : analyzeOfferWithoutEligibility(offer).value.score;
}

export function valueTier(score) {
  if (score >= 75) return "exceptional";
  if (score >= 60) return "great";
  if (score >= 45) return "good";
  if (score >= 30) return "fair";
  return "low";
}

export function normalizeOfferText(text = "") {
  return String(text).replace(/\u202f|\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function analyzeOfferWithoutEligibility(offer) {
  const text = normalizeOfferText(offer?.text);
  const normalized = text.toLowerCase();
  const preferredCurrency = normalizeCurrencyCode(offer?.currencyCode ?? offer?.currency ?? offer?.venue?.currency);
  const multibuy = extractMultibuy(text);
  const explicitDiscount = text
    ? extractDiscount(text, { currencyCode: preferredCurrency })
    : normalizeExistingDiscount(offer);
  const discount = explicitDiscount ?? multibuy?.discount ?? null;
  const currencyCode = discount?.currencyCode ?? preferredCurrency;
  const minimumSpend = extractMinimumSpend(text, currencyCode);
  const maxSavings = extractMaximumSavings(text, currencyCode);
  const isDelivery = isDeliveryRelated(text);
  const isMultibuy = Boolean(multibuy);
  const isGenericPerk = !isMultibuy && isPerkOffer(text);
  const isPerk = isMultibuy || isGenericPerk;
  const itemSignals = offerItemSignals(text);
  const isSelectedItems = !isMultibuy && isSpecificItemOffer(text, discount);
  const isUpToPercent = /(?:up\s+to|iki|do)\s*-?\d+(?:[.,]\d+)?\s*%/iu.test(normalized);
  const scope = isDelivery
    ? "delivery"
    : isMultibuy
      ? "multibuy"
      : isGenericPerk
        ? "perk"
        : isSelectedItems
          ? "selected"
          : discount
            ? "broad"
            : "other";
  const referenceAmount = currencyReference(currencyCode);
  const effectiveDiscountPercent = multibuy?.effectiveDiscountPercent ?? effectivePercent(discount, minimumSpend, referenceAmount);
  const score = valueScore({
    extracted: discount,
    effectiveDiscountPercent,
    minimumSpend,
    maxSavings,
    referenceAmount,
    scope,
    isUpToPercent,
    productLine: offer?.productLine ?? offer?.venue?.productLine,
    text,
    multibuy,
    itemSignals,
  });

  return {
    discount,
    value: {
      version: OFFER_VALUE_VERSION,
      score,
      tier: valueTier(score),
      scope,
      currencyCode,
      minimumSpend,
      maxSavings,
      effectiveDiscountPercent: roundNullable(effectiveDiscountPercent, 1),
      normalizedCashReference: discount?.type === "money" && referenceAmount
        ? round(discount.amount / referenceAmount, 3)
        : null,
      isDelivery,
      isPerk,
      isMultibuy,
      multibuy: multibuy
        ? {
            kind: multibuy.kind,
            totalQuantity: multibuy.totalQuantity,
            paidQuantity: multibuy.paidQuantity,
            freeQuantity: multibuy.freeQuantity,
            effectiveDiscountPercent: multibuy.effectiveDiscountPercent,
            isClearlyBroad: itemSignals.isClearlyBroad,
            isSubstantialItem: itemSignals.isSubstantialItem,
            isLowCostItem: itemSignals.isLowCostItem,
          }
        : null,
      isSelectedItems,
      isUpToPercent,
    },
  };
}

function valueScore({ extracted, effectiveDiscountPercent, minimumSpend, maxSavings, referenceAmount, scope, isUpToPercent, productLine, text, multibuy, itemSignals }) {
  if (scope === "delivery") {
    return deliveryScore(text);
  }
  if (scope === "perk") {
    return perkScore(text, itemSignals);
  }
  if (scope === "multibuy") {
    return multibuyScore(multibuy, itemSignals, productLine);
  }
  if (!extracted || !Number.isFinite(effectiveDiscountPercent)) {
    return 0;
  }

  let score = effectiveDiscountPercent;
  if (scope === "broad") score += 20;
  if (scope === "selected") score -= 25;
  if (scope === "broad" && !minimumSpend) score += 8;

  const normalizedProductLine = String(productLine ?? "").toLowerCase();
  if (scope === "broad" && normalizedProductLine === "grocery") score += 8;
  else if (scope === "broad" && normalizedProductLine === "restaurant") score += 3;
  else if (scope === "broad" && normalizedProductLine) score += 4;

  if (extracted.type === "percent" && minimumSpend && referenceAmount) {
    score -= Math.min(30, minimumSpend / referenceAmount * 3);
  }
  if (isUpToPercent) score -= 15;
  if (maxSavings && referenceAmount && maxSavings < referenceAmount) {
    score -= (1 - maxSavings / referenceAmount) * 12;
  }

  return clampScore(score);
}

function multibuyScore(multibuy, itemSignals, productLine) {
  if (!multibuy || !Number.isFinite(multibuy.effectiveDiscountPercent)) {
    return 0;
  }

  let score = multibuy.effectiveDiscountPercent + 8;
  if (itemSignals.isClearlyBroad) score += 14;
  if (itemSignals.isSubstantialItem) score += 10;
  if (itemSignals.isLowCostItem) score -= 18;
  if (!itemSignals.isClearlyBroad && !itemSignals.isSubstantialItem && !itemSignals.isLowCostItem) {
    score -= 4;
  }

  const normalizedProductLine = String(productLine ?? "").toLowerCase();
  if (normalizedProductLine === "restaurant") score += 3;
  else if (normalizedProductLine && normalizedProductLine !== "grocery") score += 1;

  return clampScore(score);
}

function perkScore(text, itemSignals) {
  let score = 18;
  if (itemSignals.isSubstantialItem) score += 10;
  if (/dessert|desserts|pastry|pastries|cake|cakes|desert|ciasto|tort|десерт/iu.test(text)) score += 5;
  if (itemSignals.isLowCostItem) score -= 6;
  return clampScore(Math.max(8, score));
}

function deliveryScore(text) {
  let score = 10;
  if (/\b\d+\s*(?:days?|deliveries|orders?)\b/iu.test(text)) score += 5;
  if (/free|0\s*(?:€|eur|euro)|nemokam|gratis|zdarma|безкоштов|бесплат/iu.test(text)) score += 2;
  return clampScore(score);
}

function offerItemSignals(text) {
  const normalized = normalizeOfferText(text).toLowerCase();
  return {
    isClearlyBroad: /\b(?:all|any|every|everything|entire|whole|full)\b|(?:all|entire|whole|full)\s+menu|menu[-\s]?wide|\bvis(?:as|i|iems|os)?\b|\bvis[ąa]\s+meniu\b|\bwszystk\w*\b|\bca[łl]e\s+menu\b|\bv[šs]echny\b|\bcel[ée]\s+menu\b|\b(?:всі|усі|все|весь|вся)\b/iu.test(normalized),
    isSubstantialItem: /\b(?:pizza|pizzas|pica|picos|burger|burgers|meal|meals|main|mains|entree|entrees|combo|combos|set|sets|sushi|ramen|noodle|noodles|kebab|kebabs|sandwich|sandwiches|wrap|wraps|burrito|burritos|bowl|bowls|poke|pasta|curry|wok|chicken|steak|fish|salmon|lunch|dinner|menu|patiekal\w*|piet\w*|vakarien\w*|zestaw\w*|dani\w*|obiad\w*|j[ií]dl\w*|піца|пицца|бургер\w*|страва|страви|блюдо|блюда)\b/iu.test(normalized),
    isLowCostItem: /\b(?:sauce|sauces|dip|dips|dressing|cola|coke|soda|soft\s+drink|water|tea|juice|drink|drinks|beverage|beverages|pada[žz]\w*|arbata|vanduo|g[ėe]rim\w*|sos|herbata|woda|nap[oó]j\w*|om[aá][čc]k\w*|[čc]aj|voda|n[aá]poj\w*|соус\w*|чай|вода|кола|напій|напиток)\b/iu.test(normalized),
  };
}

function effectivePercent(discount, minimumSpend, referenceAmount) {
  if (!discount) return null;
  if (discount.type === "percent") return Math.min(100, discount.amount);
  if (discount.type === "money" && minimumSpend > 0) return Math.min(100, discount.amount / minimumSpend * 100);
  if (discount.type === "money" && referenceAmount > 0) return Math.min(70, discount.amount / referenceAmount * 50);
  if (discount.type === "money") return 35;
  return null;
}

function buildMultibuy(totalQuantity, paidQuantity, kind) {
  if (!Number.isInteger(totalQuantity) || !Number.isInteger(paidQuantity)) return null;
  if (totalQuantity < 2 || paidQuantity < 1 || paidQuantity >= totalQuantity || totalQuantity > 20) return null;

  const freeQuantity = totalQuantity - paidQuantity;
  const effectiveDiscountPercent = round(freeQuantity / totalQuantity * 100, 1);
  return {
    kind,
    totalQuantity,
    paidQuantity,
    freeQuantity,
    effectiveDiscountPercent,
    discount: {
      amount: effectiveDiscountPercent,
      type: "percent",
      currencyCode: null,
      label: `${formatNumber(effectiveDiscountPercent)}%`,
    },
  };
}

function parseQuantity(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (QUANTITY_WORDS.has(normalized)) return QUANTITY_WORDS.get(normalized);
  const numeric = Number(normalized);
  return Number.isInteger(numeric) ? numeric : null;
}

function extractMoney(text, preferredCurrencyCode) {
  const prefix = new RegExp(`(${MONEY_TOKEN_PATTERN})\\s*${NUMBER_PATTERN}`, "iu").exec(text);
  const suffix = new RegExp(`${NUMBER_PATTERN}\\s*(${MONEY_TOKEN_PATTERN})`, "iu").exec(text);
  const match = prefix ?? suffix;
  if (!match) return null;

  const isPrefix = match === prefix;
  const token = isPrefix ? match[1] : match[2];
  const numeric = isPrefix ? match[2] : match[1];
  const amount = Math.abs(parseNumeric(numeric));
  if (!Number.isFinite(amount)) return null;

  return {
    amount,
    currencyCode: resolveCurrencyCode(token, preferredCurrencyCode),
  };
}

function extractMoneyDiscount(text, preferredCurrencyCode) {
  const currencyFirst = `(?:${MONEY_TOKEN_PATTERN})\\s*${NUMBER_PATTERN}`;
  const currencyLast = `${NUMBER_PATTERN}\\s*(?:${MONEY_TOKEN_PATTERN})`;
  const moneyAmount = `(?:${currencyFirst}|${currencyLast})`;
  const afterAmount = new RegExp(
    `${moneyAmount}\\s*(?:off|discount|(?:selected\\s+)?items?\\s+discount)\\b`,
    "iu",
  ).exec(text);
  const beforeAmount = new RegExp(
    `\\b(?:save|get|discount(?:ed)?\\s+by)\\s+(?:up\\s+to\\s+)?${moneyAmount}`,
    "iu",
  ).exec(text);
  const match = afterAmount ?? beforeAmount;
  return match ? extractMoney(match[0], preferredCurrencyCode) : null;
}

function parseNumeric(value) {
  const normalized = String(value).replace(/\s/g, "");
  if (/^\d{1,3}(?:[.,:]\d{3})+$/.test(normalized)) {
    return Number(normalized.replace(/[.,:]/g, ""));
  }
  return Number(normalized.replace(",", "."));
}

function normalizeExistingDiscount(offer) {
  const amount = Number(offer?.amount);
  if (!Number.isFinite(amount) || !offer?.amountType) return null;
  const currencyCode = normalizeCurrencyCode(offer?.currencyCode ?? offer?.currency ?? offer?.venue?.currency);
  return {
    amount: Math.abs(amount),
    type: offer.amountType,
    currencyCode: offer.amountType === "money" ? currencyCode : null,
    label: offer.amountLabel ?? formatDiscountLabel(Math.abs(amount), offer.amountType, currencyCode),
  };
}

function resolveCurrencyCode(token, preferredCurrencyCode) {
  const preferred = normalizeCurrencyCode(preferredCurrencyCode);
  const codes = ALIAS_TO_CODES.get(String(token).toLowerCase()) ?? [];
  if (preferred && (!codes.length || codes.includes(preferred))) return preferred;
  return codes.length === 1 ? codes[0] : preferred;
}

function normalizeCurrencyCode(value) {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function currencyReference(currencyCode) {
  return CURRENCY_PROFILES[normalizeCurrencyCode(currencyCode)]?.reference ?? null;
}

function isDeliveryRelated(text) {
  return /delivery|deliveries|delivery\s+fee/iu.test(text);
}

function isPerkOffer(text) {
  return /\bfree\b|\bgift\b|complimentary|bonus|nemokam\w*|gratis|dovan\w*|zdarma|bezp[łl]atn\w*|безкоштовн\w*|бесплатн\w*|подар(?:ок|унок)/iu.test(text);
}

function isSpecificItemOffer(text, discount) {
  const normalized = normalizeOfferText(text);
  const explicitlyLimited =
    /selected\s+(?:item|items|product|products)|specific\s+(?:item|items|product|products)|\bitem\s+discount\b|\b(?:wide|large)\s+selection\b|your\s+favou?rites?|wybrane\s+pozycje|wybranych\s+pozycj|ausgew[a\u00e4]hlte|se\u00e7ilmi\u015f|secilmis/iu.test(normalized);

  if (explicitlyLimited) {
    return true;
  }

  if (discount?.type === "percent") {
    return !isClearlyBroadPercentOffer(normalized);
  }

  if (discount?.type === "money") {
    return (
      /\b(?:bun|buns|burger|burgers|tortilla|tortillas|meal|meals|combo|combos|set|sets|pizza|pizzas|sushi\s+set|wines?|coffee|wok|pastry|pastries|dessert|desserts|drink|drinks|beverage|beverages|cake|cakes|snack|snacks|sandwich|sandwiches|roll|rolls|bowl|bowls|ramen|noodle|noodles|kebab|kebabs|chocolate|chocolates|bread|salad|salads|soup|soups)\b/iu.test(normalized) ||
      /\b(?:for|on)\s+(?!the\s+(?:basket|order)|all\s+(?:items|products)|your\s+order)\p{L}/iu.test(normalized)
    );
  }

  return false;
}

function isClearlyBroadPercentOffer(text) {
  if (
    /\b(?:basket\s+discount|(?:whole|entire)\s+basket|off\s+(?:the|your)\s+basket|(?:whole|entire|full)\s+(?:menu|order)|(?:the|rest\s+of\s+the)\s+menu|all\s+(?:items|products)|everything|order\s+discount|menu\s+discount)\b/iu.test(text)
  ) {
    return true;
  }

  return /^(?:get\s+)?-?\d+(?:[.,]\d+)?\s*%\s*(?:off|discount)?(?:\s*\((?:up\s+to|max(?:imum)?|spend|minimum|min\.?|orders?\s+over|basket\s+over|from)[^)]*\))*\s*[.!]?$/iu.test(text);
}

function formatDiscountLabel(amount, type, currencyCode) {
  if (type === "percent") return `${formatNumber(amount)}%`;
  if (type === "money") return `${formatNumber(amount)}${currencyCode ? ` ${currencyCode}` : ""}`;
  return formatNumber(amount);
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2, useGrouping: false });
}

function buildAliasIndex() {
  const index = new Map();
  for (const [code, profile] of Object.entries(CURRENCY_PROFILES)) {
    for (const alias of [code, ...profile.aliases]) {
      const key = alias.toLowerCase();
      index.set(key, [...new Set([...(index.get(key) ?? []), code])]);
    }
  }
  return index;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function roundNullable(value, precision) {
  return Number.isFinite(value) ? round(value, precision) : null;
}

function clampScore(value) {
  return round(Math.max(0, Math.min(100, value)), 1);
}

function round(value, precision) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
