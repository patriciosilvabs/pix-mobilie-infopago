/**
 * Parse Brazilian boleto barcode or linha digitável to extract amount and due date.
 * 
 * Bank boleto barcode (44 digits):
 *   [0-2] Bank code
 *   [3]   Currency (9 = BRL)
 *   [4]   Check digit
 *   [5-8] Due date factor (days since 1997-10-07)
 *   [9-18] Amount in cents (10 digits)
 *   [19-43] Free field
 * 
 * Bank boleto linha digitável (47 digits):
 *   [0-9]   Field 1
 *   [10-20] Field 2
 *   [21-31] Field 3
 *   [32]    General check digit
 *   [33-36] Due date factor
 *   [37-46] Amount in cents
 * 
 * Convênio/utility boleto (48 digits typed, 44 barcode starting with 8):
 *   Different structure, value is in positions [4-14] of barcode
 */

export interface BoletoInfo {
  amount: number; // in BRL (e.g., 150.00)
  dueDate: string | null; // ISO date string or null
  isConvenio: boolean; // true if utility bill
  bankCode: string | null;
}

const BASE_DATE = new Date(1997, 9, 7); // October 7, 1997

function cleanCode(code: string): string {
  return code.replace(/[\s.\-]/g, '');
}

function dueDateFromFactor(factor: number): string | null {
  if (factor === 0) return null; // No due date
  const date = new Date(BASE_DATE);
  date.setDate(date.getDate() + factor);
  return date.toISOString().split('T')[0];
}

/**
 * Convert linha digitável (47 digits) to barcode (44 digits)
 */
function linhaDigitavelToBarcode(ld: string): string {
  // LD format: AAABC.CCCCX DDDDD.DDDDDX EEEEE.EEEEEX F GGGGHHHHHHHHII
  // After cleaning (47 digits):
  // [0-3]  = barcode [0-3] (bank + currency)
  // [4-8]  = barcode [19-23] (free field part 1)
  // [9]    = field 1 check digit (skip)
  // [10-19]= barcode [24-33] (free field part 2)
  // [20]   = field 2 check digit (skip)
  // [21-30]= barcode [34-43] (free field part 3)
  // [31]   = field 3 check digit (skip)
  // [32]   = barcode [4] (general check digit)
  // [33-36]= barcode [5-8] (due date factor)
  // [37-46]= barcode [9-18] (amount)
  
  const barcode = 
    ld.substring(0, 4) +     // bank + currency
    ld[32] +                  // general check digit
    ld.substring(33, 37) +    // due date factor
    ld.substring(37, 47) +    // amount
    ld.substring(4, 9) +      // free field part 1
    ld.substring(10, 20) +    // free field part 2
    ld.substring(21, 31);     // free field part 3
  
  return barcode;
}

/**
 * Parse bank boleto barcode (44 digits)
 */
function parseBankBarcode(barcode: string): BoletoInfo {
  const bankCode = barcode.substring(0, 3);
  const dueFactor = parseInt(barcode.substring(5, 9), 10);
  const amountCents = parseInt(barcode.substring(9, 19), 10);
  
  return {
    amount: amountCents / 100,
    dueDate: dueDateFromFactor(dueFactor),
    isConvenio: false,
    bankCode,
  };
}

/**
 * Parse convênio/utility barcode (44 digits starting with 8)
 */
function parseConvenioBarcode(barcode: string): BoletoInfo {
  // For convênio, value identifier is at position [2]:
  // 6 or 7 = value in reais (with verification modulo 10 or 11)
  // 8 or 9 = value in reais (with verification modulo 10 or 11)
  const valueId = barcode[2];
  let amountCents: number;
  
  if (['6', '7', '8', '9'].includes(valueId)) {
    amountCents = parseInt(barcode.substring(4, 15), 10);
  } else {
    amountCents = 0;
  }
  
  return {
    amount: amountCents / 100,
    dueDate: null, // Convênio boletos don't use the same due date system
    isConvenio: true,
    bankCode: null,
  };
}

/**
 * Parse convênio linha digitável (48 digits)
 */
function parseConvenioLinhaDigitavel(ld: string): BoletoInfo {
  // Convênio LD has 48 digits with check digits embedded
  // Remove check digits at positions 11, 23, 35, 47 to get 44-digit barcode
  const barcode = 
    ld.substring(0, 11) +
    ld.substring(12, 23) +
    ld.substring(24, 35) +
    ld.substring(36, 47);
  
  return parseConvenioBarcode(barcode);
}

/**
 * Main function: parse any boleto code (barcode or linha digitável)
 */
export function parseBoleto(code: string): BoletoInfo | null {
  const clean = cleanCode(code);
  
  if (!/^\d+$/.test(clean)) return null;
  
  const len = clean.length;
  
  // Convênio linha digitável (48 digits, starts with 8)
  if (len === 48 && clean[0] === '8') {
    return parseConvenioLinhaDigitavel(clean);
  }
  
  // Bank boleto linha digitável (47 digits)
  if (len === 47) {
    const barcode = linhaDigitavelToBarcode(clean);
    return parseBankBarcode(barcode);
  }
  
  // Barcode (44 digits)
  if (len === 44) {
    if (clean[0] === '8') {
      return parseConvenioBarcode(clean);
    }
    return parseBankBarcode(clean);
  }
  
  return null;
}
